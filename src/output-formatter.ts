import type {
  QueryResult,
  FormattedQueryResult,
  SchemaInfo,
  TableInfo,
  TableSummary,
} from "./types.js";

const DEFAULT_MAX_VALUE_LENGTH = 500;
const MAX_SEARCH_RESULTS = 20;

export function formatQueryResult(
  result: QueryResult,
  maxRows: number,
  maxValueLength?: number,
): FormattedQueryResult {
  const limit = maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH;
  const rows = result.rows.map((row) => row.map((value) => truncateValue(value, limit)));

  return {
    columns: result.columns,
    rows,
    row_count: result.rowCount,
    truncated: result.hasMore,
    ...(result.affectedRows != null ? { affected_rows: result.affectedRows } : {}),
    ...(result.lastInsertId != null ? { last_insert_id: result.lastInsertId } : {}),
  };
}

export function formatSchemaResult(schema: SchemaInfo, detailed: boolean): { tables: unknown[] } {
  if (detailed) {
    // Convert to snake_case for consistent agent-facing output
    return {
      tables: schema.tables.map((t) => ({
        name: t.name,
        schema: t.schema,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          default_value: c.defaultValue,
          is_primary_key: c.isPrimaryKey,
          comment: c.comment,
        })),
        primary_key: t.primaryKey,
        indexes: t.indexes.map((i) => ({
          name: i.name,
          columns: i.columns,
          unique: i.unique,
        })),
        foreign_keys: (t.foreignKeys ?? []).map((fk) => ({
          column: fk.column,
          references_table: fk.referencesTable,
          references_column: fk.referencesColumn,
        })),
        row_count_estimate: t.rowCountEstimate,
        comment: t.comment,
      })),
    };
  }

  // Summary mode
  return {
    tables: schema.tables.map((t) => ({
      name: t.name,
      schema: t.schema,
      column_count: t.columns.length,
      primary_key: t.primaryKey,
      row_count_estimate: t.rowCountEstimate,
    })),
  };
}

export interface SearchResult {
  tableName: string;
  columnName?: string;
  columnType?: string;
  matchType:
    | "table_exact"
    | "table_prefix"
    | "table_contains"
    | "column_exact"
    | "column_prefix"
    | "column_contains";
}

export function formatSearchResults(tables: TableInfo[], query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const table of tables) {
    const tName = table.name.toLowerCase();

    // Table name matches
    if (tName === q) {
      results.push({ tableName: table.name, matchType: "table_exact" });
    } else if (tName.startsWith(q)) {
      results.push({ tableName: table.name, matchType: "table_prefix" });
    } else if (tName.includes(q)) {
      results.push({ tableName: table.name, matchType: "table_contains" });
    }

    // Column name and comment matches
    for (const col of table.columns) {
      const cName = col.name.toLowerCase();
      const cComment = col.comment?.toLowerCase() ?? "";

      if (cName === q) {
        results.push({
          tableName: table.name,
          columnName: col.name,
          columnType: col.type,
          matchType: "column_exact",
        });
      } else if (cName.startsWith(q)) {
        results.push({
          tableName: table.name,
          columnName: col.name,
          columnType: col.type,
          matchType: "column_prefix",
        });
      } else if (cName.includes(q) || cComment.includes(q)) {
        results.push({
          tableName: table.name,
          columnName: col.name,
          columnType: col.type,
          matchType: "column_contains",
        });
      }
    }
  }

  // Sort by relevance: exact > prefix > contains, tables before columns
  const priority: Record<string, number> = {
    table_exact: 0,
    column_exact: 1,
    table_prefix: 2,
    column_prefix: 3,
    table_contains: 4,
    column_contains: 5,
  };

  results.sort((a, b) => priority[a.matchType] - priority[b.matchType]);

  return results.slice(0, MAX_SEARCH_RESULTS);
}

function truncateValue(value: unknown, maxLength: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.length > maxLength) {
    return value.slice(0, maxLength) + "...[truncated]";
  }
  return value;
}
