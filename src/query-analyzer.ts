import { Parser } from "node-sql-parser";
import { QueryCategory } from "./types.js";

const parser = new Parser();

const DDL_TYPES = new Set(["create", "alter", "drop", "truncate"]);

const WRITE_TYPES = new Set(["insert", "update", "delete", "replace", "merge"]);

const READ_TYPES = new Set(["select", "show", "desc", "describe"]);

export function classifyQuery(sql: string): QueryCategory {
  const trimmed = sql.trim();

  // EXPLAIN is always read, regardless of the inner query
  if (/^\s*(explain)\s/i.test(trimmed)) {
    return "read";
  }

  // Check for writable CTEs: WITH x AS (UPDATE/DELETE/INSERT ...) SELECT ...
  // These look like SELECTs but modify data — must be classified as "write".
  if (hasWritableCte(trimmed)) {
    return "write";
  }

  try {
    // Use PostgreSQL dialect as the most permissive parser. Falls back to
    // keyword detection for syntax it can't parse.
    const ast = parser.astify(trimmed, { database: "postgresql" });
    const stmts = Array.isArray(ast) ? ast : [ast];
    const stmt = stmts[0];

    if (!stmt || typeof stmt.type !== "string") {
      return "write"; // fail safe
    }

    const type = stmt.type.toLowerCase();

    if (DDL_TYPES.has(type)) return "ddl";
    if (WRITE_TYPES.has(type)) return "write";
    if (READ_TYPES.has(type)) return "read";

    return "write"; // fail safe
  } catch {
    // Parser failed — fall back to keyword detection
    return classifyByKeyword(trimmed);
  }
}

/**
 * Detect writable CTEs: WITH x AS (UPDATE/DELETE/INSERT ... RETURNING ...) SELECT ...
 * The outer statement is SELECT but the CTE modifies data.
 */
function hasWritableCte(sql: string): boolean {
  const upper = sql.toUpperCase();
  if (!upper.startsWith("WITH")) return false;
  // Look for write keywords inside parentheses after AS
  const writeInCte = /\bAS\s*\(\s*(UPDATE|DELETE|INSERT)\b/i;
  return writeInCte.test(sql);
}

function classifyByKeyword(sql: string): QueryCategory {
  // Strip leading comments
  const stripped = sql.replace(/^\s*(--[^\n]*\n|\s)*/g, "").trim();
  const firstWord = stripped.split(/\s+/)[0]?.toLowerCase() ?? "";

  if (firstWord === "select" || firstWord === "show") return "read";
  if (firstWord === "with") {
    // Check for writable CTE
    return hasWritableCte(stripped) ? "write" : "read";
  }
  if (DDL_TYPES.has(firstWord)) return "ddl";
  if (WRITE_TYPES.has(firstWord)) return "write";

  return "write"; // fail safe
}

export function isMultiStatement(sql: string): boolean {
  // Use the parser to detect multiple statements. The parser handles
  // semicolons inside strings, double-quoted identifiers, and dollar-quoting
  // correctly — which a hand-rolled scanner cannot.
  try {
    const ast = parser.astify(sql, { database: "postgresql" });
    const stmts = Array.isArray(ast) ? ast : [ast];
    return stmts.length > 1;
  } catch {
    // Parser failed — fall back to conservative semicolon counting.
    // Tracks single-quoted and double-quoted strings.
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let semicolonCount = 0;

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const prev = i > 0 ? sql[i - 1] : "";

      if (char === "'" && !inDoubleQuote && prev !== "\\") {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote && prev !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === ";" && !inSingleQuote && !inDoubleQuote) {
        semicolonCount++;
      }
    }

    // A trailing semicolon doesn't count as multi-statement
    const trimmed = sql.trimEnd();
    if (trimmed.endsWith(";") && semicolonCount === 1) {
      return false;
    }

    return semicolonCount > 1;
  }
}
