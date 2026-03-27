import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";
import { getDialect, subqueryWithLimit } from "../sql-dialect.js";

interface ColumnStats {
  name: string;
  type: string;
  total_rows: number;
  null_count: number;
  null_percentage: number;
  distinct_count: number;
  min: unknown;
  max: unknown;
}

export async function handleGetTableStats(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; table: string; sample_size?: number },
) {
  const connConfig = getConnection(config, args.connection);

  // Validate table name against schema
  const schema = await cm.getSchema(connConfig);
  const tableInfo = schema.tables.find((t) => t.name.toLowerCase() === args.table.toLowerCase());
  if (!tableInfo) {
    throw new OmnibaseError(
      `Table '${args.table}' not found in connection '${args.connection}'`,
      "TABLE_NOT_FOUND",
    );
  }

  if (args.sample_size !== undefined && args.sample_size < 1) {
    throw new OmnibaseError("sample_size must be at least 1", "INVALID_PARAMS");
  }
  const sampleSize = args.sample_size ?? 10000;
  const tableName = tableInfo.name;

  // Build a single query that computes stats for all columns at once.
  // Uses a sample via LIMIT to avoid full table scans on large tables.
  const statExprs = tableInfo.columns.map((col) => {
    const q = col.name;
    return [
      `COUNT(*) AS _total`,
      `SUM(CASE WHEN ${q} IS NULL THEN 1 ELSE 0 END) AS _null_${col.name}`,
      `COUNT(DISTINCT ${q}) AS _distinct_${col.name}`,
      `MIN(${q}) AS _min_${col.name}`,
      `MAX(${q}) AS _max_${col.name}`,
    ];
  });

  // Flatten and deduplicate COUNT(*)
  const allExprs = new Set<string>();
  for (const exprs of statExprs) {
    for (const expr of exprs) {
      allExprs.add(expr);
    }
  }

  const dialect = getDialect(connConfig);
  const subquery = subqueryWithLimit(tableName, sampleSize, dialect);
  const query = `SELECT ${Array.from(allExprs).join(", ")} FROM ${subquery} AS _sample`;

  // Try with subquery alias first (standard SQL), fall back without alias
  // (some databases don't require/support aliased subqueries)
  let result;
  try {
    result = await cm.execute(connConfig, query);
  } catch {
    const fallbackQuery = `SELECT ${Array.from(allExprs).join(", ")} FROM ${subquery}`;
    result = await cm.execute(connConfig, fallbackQuery);
  }

  if (result.rows.length === 0) {
    return { table: tableName, sample_size: sampleSize, columns: [] };
  }

  const row = result.rows[0];
  const colMap = new Map<string, number>();
  result.columns.forEach((name, idx) => colMap.set(name, idx));

  const getValue = (key: string): unknown => {
    const idx = colMap.get(key);
    return idx !== undefined ? row[idx] : null;
  };

  const totalRows = Number(getValue("_total")) || 0;

  const columnStats: ColumnStats[] = tableInfo.columns.map((col) => {
    const nullCount = Number(getValue(`_null_${col.name}`)) || 0;
    const distinctCount = Number(getValue(`_distinct_${col.name}`)) || 0;

    return {
      name: col.name,
      type: col.type,
      total_rows: totalRows,
      null_count: nullCount,
      null_percentage: totalRows > 0 ? Math.round((nullCount / totalRows) * 10000) / 100 : 0,
      distinct_count: distinctCount,
      min: getValue(`_min_${col.name}`),
      max: getValue(`_max_${col.name}`),
    };
  });

  return {
    table: tableName,
    sample_size: Math.min(sampleSize, totalRows),
    sampled: totalRows >= sampleSize,
    columns: columnStats,
  };
}
