import { Parser } from "node-sql-parser";
import { classifyQuery, isMultiStatement } from "../query-analyzer.js";
import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";

const parser = new Parser();

export async function handleValidateQuery(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; query: string },
) {
  const connConfig = getConnection(config, args.connection);

  if (!args.query || !args.query.trim()) {
    throw new OmnibaseError("Query cannot be empty", "INVALID_QUERY");
  }

  const result: {
    syntax_valid: boolean;
    schema_valid: boolean | null;
    category: string | null;
    multi_statement: boolean;
    would_be_allowed: boolean;
    estimated_rows_affected?: number;
    errors: string[];
    warnings: string[];
  } = {
    syntax_valid: true,
    schema_valid: null, // null until we can check
    category: null,
    multi_statement: false,
    would_be_allowed: true,
    errors: [],
    warnings: [],
  };

  // Check multi-statement
  result.multi_statement = isMultiStatement(args.query);
  if (result.multi_statement) {
    result.errors.push("Multi-statement queries are not allowed");
    result.would_be_allowed = false;
  }

  // Try parsing for syntax validation first.
  // Replace ? placeholders with $1, $2, etc. (Postgres-style) since the parser
  // doesn't recognize ? as valid syntax.
  let parseable = args.query;
  let paramIdx = 0;
  parseable = parseable.replace(/\?/g, () => `$${++paramIdx}`);

  let ast: unknown = null;
  let parserFailed = false;
  try {
    ast = parser.astify(parseable, { database: "postgresql" });
  } catch {
    parserFailed = true;
  }

  // If the JS parser rejected it, fall back to the database's own parser via PREPARE.
  // This catches valid database-specific syntax (INSERT OR REPLACE, DELETE ... USING, etc.)
  if (parserFailed) {
    try {
      const dbResult = await cm.validateQuery(connConfig, args.query);
      if (dbResult.valid) {
        // Database says it's valid — the JS parser was wrong
        result.syntax_valid = true;
        result.schema_valid = true; // PREPARE checks schema too
      } else {
        result.syntax_valid = false;
        result.errors.push(`Syntax error: ${dbResult.error}`);
      }
    } catch {
      // Can't reach the database — report the parser's rejection
      result.syntax_valid = false;
      result.errors.push(
        "Query could not be validated — parser rejected it and database is unavailable",
      );
    }
  }

  // Classify and check permissions if syntax is valid
  if (result.syntax_valid) {
    result.category = classifyQuery(args.query);

    const permissionAllows: Record<string, Set<string>> = {
      "read-only": new Set(["read"]),
      "read-write": new Set(["read", "write"]),
      admin: new Set(["read", "write", "ddl"]),
    };
    const allowed = permissionAllows[connConfig.permission];
    if (allowed && !allowed.has(result.category)) {
      result.would_be_allowed = false;
      result.errors.push(
        `Connection '${connConfig.name}' is ${connConfig.permission}, ${result.category} queries are not allowed`,
      );
    }
  } else {
    result.would_be_allowed = false;
  }

  // Validate table/column references against the schema cache (only if we have an AST)
  if (result.syntax_valid && ast) {
    await validateSchemaReferences(cm, connConfig, ast, result);
  }

  // Estimate affected rows and warn about dangerous patterns for write queries
  if (
    result.syntax_valid &&
    !result.multi_statement &&
    result.category &&
    (result.category === "write" || result.category === "ddl")
  ) {
    const estimate = await estimateAffectedRows(cm, connConfig, args.query, ast);
    if (estimate !== null) {
      result.estimated_rows_affected = estimate;
    }

    // Warn about DELETE/UPDATE without WHERE clause
    const upper = args.query.trim().toUpperCase();
    if ((upper.startsWith("DELETE") || upper.startsWith("UPDATE")) && !upper.includes("WHERE")) {
      result.warnings.push("No WHERE clause — this affects ALL rows in the table");
    }
  }

  return result;
}

/**
 * Validate table and column references in the AST against the actual schema.
 */
async function validateSchemaReferences(
  cm: ConnectionManager,
  connConfig: {
    name: string;
    dsn: string;
    permission: "read-only" | "read-write" | "admin";
    timeout: number;
    maxRows: number;
    schemaFilter?: { schemas?: string[]; tables?: string[] };
    allowAllPragmas?: boolean;
  },
  ast: unknown,
  result: { schema_valid: boolean | null; warnings: string[] },
): Promise<void> {
  try {
    const schema = await cm.getSchema(connConfig);
    const knownTables = new Map<string, Set<string>>();
    for (const table of schema.tables) {
      const colNames = new Set(table.columns.map((c) => c.name.toLowerCase()));
      knownTables.set(table.name.toLowerCase(), colNames);
    }

    const tableRefs = extractTableRefs(ast);
    const aliasMap = extractAliasMap(ast);
    const cteNames = extractCteNames(ast);
    const columnRefs = extractColumnRefs(ast);
    const insertColumns = extractInsertColumns(ast);

    result.schema_valid = true;

    // Check table references (skip CTE names — they're defined in the query itself)
    for (const tableName of tableRefs) {
      if (cteNames.has(tableName.toLowerCase())) continue;
      if (!knownTables.has(tableName.toLowerCase())) {
        result.schema_valid = false;
        result.warnings.push(`Table '${tableName}' does not exist`);
      }
    }

    // Check INSERT column list against the target table
    if (insertColumns.length > 0) {
      const insertTable = extractInsertTable(ast);
      if (insertTable) {
        const cols = knownTables.get(insertTable.toLowerCase());
        if (cols) {
          for (const colName of insertColumns) {
            if (!cols.has(colName.toLowerCase())) {
              result.schema_valid = false;
              result.warnings.push(`Column '${colName}' does not exist in table '${insertTable}'`);
            }
          }
        }
      }
    }

    // Check column references — resolve aliases to real table names first
    const resolvedTables = tableRefs.filter(
      (t) => knownTables.has(t.toLowerCase()) || cteNames.has(t.toLowerCase()),
    );
    for (const colRef of columnRefs) {
      const refTable = colRef.table
        ? (aliasMap.get(colRef.table.toLowerCase()) ?? colRef.table)
        : null;

      // Skip validation for CTE-sourced columns (we can't resolve their projected columns)
      if (refTable && cteNames.has(refTable.toLowerCase())) continue;

      if (refTable) {
        const cols = knownTables.get(refTable.toLowerCase());
        if (cols && !cols.has(colRef.column.toLowerCase())) {
          result.schema_valid = false;
          result.warnings.push(
            `Column '${colRef.table}.${colRef.column}' does not exist on table '${refTable}'`,
          );
        }
      } else if (resolvedTables.length === 1 && !cteNames.has(resolvedTables[0].toLowerCase())) {
        const cols = knownTables.get(resolvedTables[0].toLowerCase());
        if (cols && !cols.has(colRef.column.toLowerCase())) {
          result.schema_valid = false;
          result.warnings.push(
            `Column '${colRef.column}' does not exist in table '${resolvedTables[0]}'`,
          );
        }
      }
    }
  } catch {
    // Schema not available — can't validate, leave as null
    result.schema_valid = null;
  }
}

/**
 * Extract table names referenced in the AST.
 */
function extractTableRefs(ast: unknown): string[] {
  const tables: string[] = [];
  walkAst(ast, (node) => {
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // node-sql-parser uses {type: "table", table: "name"} for table refs
      if (obj.table && typeof obj.table === "string" && obj.type !== "column_ref") {
        tables.push(obj.table);
      }
      // FROM clause: [{table: "name", ...}]
      if (obj.from && Array.isArray(obj.from)) {
        for (const item of obj.from) {
          if (item && typeof item === "object" && typeof item.table === "string") {
            tables.push(item.table);
          }
        }
      }
    }
  });
  return [...new Set(tables)];
}

/**
 * Extract CTE names (WITH x AS ...) so we don't flag them as missing tables.
 */
function extractCteNames(ast: unknown): Set<string> {
  const names = new Set<string>();
  const stmts = Array.isArray(ast) ? ast : [ast];
  for (const stmt of stmts) {
    if (stmt && typeof stmt === "object") {
      const obj = stmt as Record<string, unknown>;
      if (obj.with && Array.isArray(obj.with)) {
        for (const cte of obj.with) {
          if (cte && typeof cte === "object" && typeof cte.name === "string") {
            names.add(cte.name.toLowerCase());
          } else if (cte && typeof cte === "object" && cte.name && typeof cte.name === "object") {
            const nameObj = cte.name as Record<string, unknown>;
            if (typeof nameObj.value === "string") {
              names.add(nameObj.value.toLowerCase());
            }
          }
        }
      }
    }
  }
  return names;
}

/**
 * Extract column names from INSERT INTO table (col1, col2, ...) syntax.
 */
function extractInsertColumns(ast: unknown): string[] {
  const stmts = Array.isArray(ast) ? ast : [ast];
  const stmt = stmts[0] as Record<string, unknown> | null;
  if (!stmt || stmt.type !== "insert") return [];
  if (!stmt.columns || !Array.isArray(stmt.columns)) return [];
  return (stmt.columns as Record<string, unknown>[])
    .map((c) => (typeof c.value === "string" ? c.value : typeof c === "string" ? c : null))
    .filter((c): c is string => c !== null);
}

/**
 * Extract the target table name from an INSERT statement.
 */
function extractInsertTable(ast: unknown): string | null {
  const stmts = Array.isArray(ast) ? ast : [ast];
  const stmt = stmts[0] as Record<string, unknown> | null;
  if (!stmt || stmt.type !== "insert") return null;
  if (stmt.table && Array.isArray(stmt.table)) {
    const first = (stmt.table as Record<string, unknown>[])[0];
    if (first && typeof first.table === "string") return first.table;
  }
  return null;
}

/**
 * Extract alias-to-table mappings from FROM clauses.
 * e.g., "FROM tasks t" produces Map { "t" => "tasks" }
 */
function extractAliasMap(ast: unknown): Map<string, string> {
  const aliases = new Map<string, string>();
  walkAst(ast, (node) => {
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (obj.from && Array.isArray(obj.from)) {
        for (const item of obj.from) {
          if (
            item &&
            typeof item === "object" &&
            typeof item.table === "string" &&
            typeof item.as === "string"
          ) {
            aliases.set(item.as.toLowerCase(), item.table);
          }
        }
      }
    }
  });
  return aliases;
}

/**
 * Extract column references from the AST.
 */
function extractColumnRefs(ast: unknown): { table: string | null; column: string }[] {
  const columns: { table: string | null; column: string }[] = [];
  walkAst(ast, (node) => {
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (obj.type === "column_ref") {
        const table = typeof obj.table === "string" ? obj.table : null;
        // column can be a string or {expr: {type: "default", value: "name"}}
        let colName: string | null = null;
        if (typeof obj.column === "string") {
          colName = obj.column;
        } else if (obj.column && typeof obj.column === "object") {
          const colObj = obj.column as Record<string, unknown>;
          if (colObj.expr && typeof colObj.expr === "object") {
            const expr = colObj.expr as Record<string, unknown>;
            if (typeof expr.value === "string") {
              colName = expr.value;
            }
          }
        }
        if (colName && colName !== "*") {
          columns.push({ table, column: colName });
        }
      }
    }
  });
  return columns;
}

/**
 * Walk all nodes in the AST tree.
 */
function walkAst(node: unknown, visitor: (node: unknown) => void): void {
  if (node === null || node === undefined) return;
  visitor(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, visitor);
    }
  } else if (typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      walkAst(value, visitor);
    }
  }
}

/**
 * Estimate how many rows a write query would affect by rewriting it as a COUNT(*).
 * Returns null if the estimate can't be computed.
 */
async function estimateAffectedRows(
  cm: ConnectionManager,
  connConfig: {
    name: string;
    dsn: string;
    permission: "read-only" | "read-write" | "admin";
    timeout: number;
    maxRows: number;
  },
  originalQuery: string,
  ast: unknown,
): Promise<number | null> {
  try {
    const countQuery = buildCountQuery(originalQuery, ast);
    if (!countQuery) return null;

    const result = await cm.execute(connConfig, countQuery);
    if (result.rows.length > 0 && result.rows[0].length > 0) {
      return Number(result.rows[0][0]) || 0;
    }
    return null;
  } catch {
    return null;
  }
}

function buildCountQuery(originalQuery: string, ast: unknown): string | null {
  const stmts = Array.isArray(ast) ? ast : [ast];
  const stmt = stmts[0] as Record<string, unknown> | null;

  if (!stmt || typeof stmt.type !== "string") {
    return buildCountQueryFromRegex(originalQuery);
  }

  const type = (stmt.type as string).toLowerCase();

  if (type === "update" || type === "delete") {
    return buildCountQueryFromRegex(originalQuery);
  }

  if (type === "insert") {
    const selectMatch = originalQuery.match(/\bINSERT\b.*?\bSELECT\b(.+)/is);
    if (selectMatch) {
      return `SELECT COUNT(*) FROM (SELECT ${selectMatch[1]})`;
    }
    return null;
  }

  return null;
}

function buildCountQueryFromRegex(sql: string): string | null {
  const updateMatch = sql.match(/^\s*UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+.+?\s+WHERE\s+(.+)$/is);
  if (updateMatch) {
    const table = updateMatch[1] || updateMatch[2];
    const where = updateMatch[3];
    return `SELECT COUNT(*) FROM ${table} WHERE ${where}`;
  }

  const updateNoWhereMatch = sql.match(/^\s*UPDATE\s+(?:"([^"]+)"|(\w+))\s+SET\s+/is);
  if (updateNoWhereMatch) {
    const table = updateNoWhereMatch[1] || updateNoWhereMatch[2];
    return `SELECT COUNT(*) FROM ${table}`;
  }

  const deleteMatch = sql.match(/^\s*DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))\s+WHERE\s+(.+)$/is);
  if (deleteMatch) {
    const table = deleteMatch[1] || deleteMatch[2];
    const where = deleteMatch[3];
    return `SELECT COUNT(*) FROM ${table} WHERE ${where}`;
  }

  const deleteNoWhereMatch = sql.match(/^\s*DELETE\s+FROM\s+(?:"([^"]+)"|(\w+))\s*$/is);
  if (deleteNoWhereMatch) {
    const table = deleteNoWhereMatch[1] || deleteNoWhereMatch[2];
    return `SELECT COUNT(*) FROM ${table}`;
  }

  return null;
}
