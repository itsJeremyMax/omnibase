// src/tools/execute-sql.ts
import type { OmnibaseConfig, ConnectionConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import type { AuditLogger } from "../audit-logger.js";
import { classifyQuery, isMultiStatement } from "../query-analyzer.js";
import { enforcePermission } from "../permission-enforcer.js";
import { formatQueryResult } from "../output-formatter.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";

// Dangerous functions that provide filesystem, OS, or credential access.
// Covers PostgreSQL, MySQL, SQL Server, Oracle. Blocked regardless of permission level.
const DANGEROUS_FUNCTIONS = [
  // PostgreSQL — filesystem/OS access
  "PG_READ_FILE",
  "PG_READ_BINARY_FILE",
  "PG_LS_DIR",
  "LO_IMPORT",
  "LO_EXPORT",
  "PG_EXECUTE_SERVER_PROGRAM",
  // PostgreSQL — server administration / DoS vectors
  "PG_TERMINATE_BACKEND",
  "PG_CANCEL_BACKEND",
  "PG_RELOAD_CONF",
  "SET_CONFIG",
  // MySQL — filesystem access
  "LOAD_FILE",
  // SQL Server — OS command execution, external data access
  "XP_CMDSHELL",
  "XP_DIRTREE",
  "XP_FILEEXIST",
  "XP_SUBDIRS",
  "OPENROWSET",
  "OPENDATASOURCE",
  "OPENQUERY",
  // Oracle — filesystem/OS access
  "UTL_FILE.FOPEN",
  "UTL_FILE.GET_LINE",
  "UTL_FILE.PUT_LINE",
  "DBMS_SCHEDULER.CREATE_JOB",
];

// System catalog tables that expose sensitive credential data.
// Matched with optional schema prefix (e.g., pg_catalog.pg_shadow).
const SENSITIVE_TABLES = [
  // PostgreSQL
  "PG_SHADOW",
  "PG_AUTHID",
  // MySQL
  "MYSQL.USER",
  // SQL Server
  "SYS.SQL_LOGINS",
  "SYS.SYSLOGINS",
  // Oracle
  "DBA_USERS",
  "SYS.USER$",
];

// Blocked first-word statements across all databases.
const BLOCKED_STATEMENTS = new Set([
  "ATTACH",
  "DETACH", // Filesystem access (SQLite)
  "BEGIN",
  "COMMIT",
  "ROLLBACK", // Transaction control
  "SAVEPOINT",
  "RELEASE",
  "GRANT",
  "REVOKE", // Permission changes
  "COPY", // Filesystem I/O (Postgres COPY TO/FROM file)
  "LOAD", // Extension/module loading, LOAD DATA INFILE (MySQL)
  "BULK", // BULK INSERT from file (SQL Server)
]);

// Read-only PRAGMAs that are safe to execute (SQLite).
const SAFE_PRAGMAS = new Set([
  "TABLE_INFO",
  "TABLE_LIST",
  "TABLE_XINFO",
  "INDEX_LIST",
  "INDEX_INFO",
  "INDEX_XINFO",
  "FOREIGN_KEY_LIST",
  "FOREIGN_KEY_CHECK",
  "INTEGRITY_CHECK",
  "QUICK_CHECK",
  "COMPILE_OPTIONS",
  "DATABASE_LIST",
  "COLLATION_LIST",
  "ENCODING",
]);

/**
 * Check a SQL string against security rules (blocked statements, dangerous functions,
 * sensitive tables, outfile/dumpfile, unsafe pragmas). Throws OmnibaseError on violation.
 */
export function checkSqlSecurity(
  sql: string,
  connConfig: Pick<ConnectionConfig, "name" | "allowAllPragmas">,
): void {
  const normalized = sql.trim().toUpperCase();
  const firstWord = normalized.split(/\s+/)[0]!;

  // Block dangerous statement types
  if (BLOCKED_STATEMENTS.has(firstWord)) {
    throw new OmnibaseError(`${firstWord} statements are not allowed`, "FORBIDDEN_OPERATION");
  }

  // Block dangerous PRAGMAs (allow safe read-only ones, or all if configured)
  if (firstWord === "PRAGMA" && !connConfig.allowAllPragmas) {
    const pragmaName = normalized.replace(/^PRAGMA\s+/i, "").split(/\s*[=(]/)[0];
    if (!SAFE_PRAGMAS.has(pragmaName)) {
      throw new OmnibaseError(
        `PRAGMA ${pragmaName.toLowerCase()} is not allowed. Only read-only diagnostic PRAGMAs are permitted. Set allow_all_pragmas: true in the connection config to override.`,
        "FORBIDDEN_OPERATION",
      );
    }
  }

  // Block dangerous functions (filesystem access, credential exposure)
  for (const fn of DANGEROUS_FUNCTIONS) {
    if (normalized.includes(fn + "(") || normalized.includes(fn + " (")) {
      throw new OmnibaseError(
        `Function ${fn.toLowerCase()}() is not allowed — it provides dangerous server access`,
        "FORBIDDEN_OPERATION",
      );
    }
  }

  // Block queries against sensitive system catalog tables.
  for (const table of SENSITIVE_TABLES) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = table.includes(".")
      ? new RegExp(`(?:FROM|JOIN)\\s+${escaped}\\b`, "i")
      : new RegExp(`(?:FROM|JOIN)\\s+(?:\\w+\\.)?${escaped}\\b`, "i");
    if (pattern.test(normalized)) {
      throw new OmnibaseError(
        `Access to ${table.toLowerCase()} is not allowed — it contains sensitive credential data`,
        "FORBIDDEN_OPERATION",
      );
    }
  }

  // Block MySQL INTO OUTFILE/DUMPFILE (appears mid-query in SELECT ... INTO OUTFILE)
  if (normalized.includes("INTO OUTFILE") || normalized.includes("INTO DUMPFILE")) {
    throw new OmnibaseError(
      "INTO OUTFILE/DUMPFILE is not allowed — it writes to the server filesystem",
      "FORBIDDEN_OPERATION",
    );
  }
}

export async function handleExecuteSql(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; query: string; params?: unknown[] },
  auditLogger?: AuditLogger,
) {
  const startMs = Date.now();
  const connConfig = getConnection(config, args.connection);

  try {
    if (!args.query || !args.query.trim()) {
      throw new OmnibaseError("Query cannot be empty", "INVALID_QUERY");
    }

    if (isMultiStatement(args.query)) {
      throw new OmnibaseError(
        "Multi-statement queries are not allowed. Send one statement per request.",
        "MULTI_STATEMENT",
      );
    }

    checkSqlSecurity(args.query, connConfig);

    const category = classifyQuery(args.query);
    enforcePermission(connConfig.name, connConfig.permission, category);

    // Check read_only_tables — block writes to protected tables
    if (
      (category === "write" || category === "ddl") &&
      connConfig.readOnlyTables &&
      connConfig.readOnlyTables.length > 0
    ) {
      const protectedTables = new Set(connConfig.readOnlyTables.map((t) => t.toLowerCase()));
      const upper = args.query.trim().toUpperCase();
      for (const table of protectedTables) {
        const tableUpper = table.toUpperCase();
        if (
          upper.includes(`INTO ${tableUpper}`) ||
          upper.includes(`UPDATE ${tableUpper}`) ||
          upper.includes(`FROM ${tableUpper}`) ||
          upper.includes(`TABLE ${tableUpper}`) ||
          upper.includes(`INTO ${tableUpper} `) ||
          upper.includes(`UPDATE ${tableUpper} `) ||
          upper.includes(`FROM ${tableUpper} `)
        ) {
          throw new OmnibaseError(
            `Table '${table}' is read-only on this connection`,
            "TABLE_READ_ONLY",
          );
        }
      }
    }

    // Invalidate schema cache on any write
    if (category === "ddl" || category === "write") {
      cm.invalidateSchemaCache(connConfig.name);
    }

    const result = await cm.execute(connConfig, args.query, args.params);
    void auditLogger?.log({
      tool: "execute_sql",
      connection: connConfig.name,
      sql: args.query,
      params: args.params ?? [],
      durationMs: Date.now() - startMs,
      rows: result.rowCount,
      status: "ok",
    });
    return formatQueryResult(result, connConfig.maxRows, connConfig.maxValueLength);
  } catch (err) {
    void auditLogger?.log({
      tool: "execute_sql",
      connection: connConfig.name,
      sql: args.query,
      params: args.params ?? [],
      durationMs: Date.now() - startMs,
      rows: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
