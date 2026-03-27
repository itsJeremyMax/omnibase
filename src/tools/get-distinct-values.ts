import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";
import { getDialect } from "../sql-dialect.js";

export async function handleGetDistinctValues(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; table: string; column: string; limit?: number },
) {
  const connConfig = getConnection(config, args.connection);

  // Validate table and column against schema
  const schema = await cm.getSchema(connConfig);
  const tableInfo = schema.tables.find((t) => t.name.toLowerCase() === args.table.toLowerCase());
  if (!tableInfo) {
    throw new OmnibaseError(
      `Table '${args.table}' not found in connection '${args.connection}'`,
      "TABLE_NOT_FOUND",
    );
  }

  const colInfo = tableInfo.columns.find((c) => c.name.toLowerCase() === args.column.toLowerCase());
  if (!colInfo) {
    throw new OmnibaseError(
      `Column '${args.column}' not found in table '${args.table}'`,
      "COLUMN_NOT_FOUND",
    );
  }

  if (args.limit !== undefined && args.limit < 0) {
    throw new OmnibaseError("limit must be non-negative", "INVALID_PARAMS");
  }
  const limit = args.limit ?? 50;
  const dialect = getDialect(connConfig);
  const query =
    dialect === "mssql"
      ? `SELECT TOP ${limit} ${colInfo.name} AS value, COUNT(*) AS count FROM ${tableInfo.name} GROUP BY ${colInfo.name} ORDER BY count DESC`
      : `SELECT ${colInfo.name} AS value, COUNT(*) AS count FROM ${tableInfo.name} GROUP BY ${colInfo.name} ORDER BY count DESC LIMIT ${limit}`;

  const result = await cm.execute(connConfig, query);

  const values = result.rows.map((row) => ({
    value: row[0],
    count: Number(row[1]),
  }));

  const totalDistinct = values.length;
  const hasMore = result.hasMore || values.length >= limit;

  return {
    table: tableInfo.name,
    column: colInfo.name,
    column_type: colInfo.type,
    values,
    total_shown: totalDistinct,
    has_more: hasMore,
  };
}
