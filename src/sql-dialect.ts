import type { ConnectionConfig } from "./types.js";

type Dialect = "mssql" | "standard";

/**
 * Detect the SQL dialect from a connection's DSN.
 * Most databases use standard SQL (LIMIT, EXPLAIN). SQL Server is the main exception.
 */
export function getDialect(config: ConnectionConfig): Dialect {
  const dsn = config.dsn.toLowerCase();
  if (
    dsn.startsWith("mssql:") ||
    dsn.startsWith("sqlserver:") ||
    dsn.startsWith("ms:") ||
    dsn.startsWith("azuresql:")
  ) {
    return "mssql";
  }
  return "standard";
}

/**
 * Build a SELECT with row limit appropriate for the dialect.
 * Standard: SELECT ... FROM table LIMIT n
 * MSSQL:    SELECT TOP n ... FROM table
 */
export function selectWithLimit(
  columns: string,
  table: string,
  limit: number,
  dialect: Dialect,
): string {
  if (dialect === "mssql") {
    return `SELECT TOP ${limit} ${columns} FROM ${table}`;
  }
  return `SELECT ${columns} FROM ${table} LIMIT ${limit}`;
}

/**
 * Build a subquery with a row limit.
 * Standard: (SELECT * FROM table LIMIT n)
 * MSSQL:    (SELECT TOP n * FROM table)
 */
export function subqueryWithLimit(table: string, limit: number, dialect: Dialect): string {
  if (dialect === "mssql") {
    return `(SELECT TOP ${limit} * FROM ${table})`;
  }
  return `(SELECT * FROM ${table} LIMIT ${limit})`;
}
