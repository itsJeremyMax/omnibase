import type { QueryResult } from "./types.js";
import { OmnibaseError } from "./types.js";

/**
 * Extract {step_name.column} references from SQL.
 * Only matches patterns with a dot (step.col), so plain {param} placeholders are ignored.
 */
export function extractComposeReferences(sql: string): Array<{ step: string; column: string }> {
  const refs: Array<{ step: string; column: string }> = [];
  const seen = new Set<string>();
  const pattern = /\{([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const key = `${match[1]}.${match[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ step: match[1]!, column: match[2]! });
    }
  }
  return refs;
}

/**
 * Replace {step.col} references in SQL with comma-separated values from context.
 * Numbers are inlined as-is. Strings are single-quoted with ' escaped to ''.
 * Throws on missing step, missing column, empty result set, or unsupported types.
 */
export function expandComposeReferences(sql: string, context: Map<string, QueryResult>): string {
  return sql.replace(
    /\{([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
    (_match, stepName: string, columnName: string) => {
      const result = context.get(stepName);
      if (!result) {
        throw new OmnibaseError(
          `Compose reference error: step '${stepName}' not found in context`,
          "COMPOSE_ERROR",
        );
      }

      const colIndex = result.columns.indexOf(columnName);
      if (colIndex === -1) {
        throw new OmnibaseError(
          `Compose reference error: column '${columnName}' not found in step '${stepName}' (available: ${result.columns.join(", ")})`,
          "COMPOSE_ERROR",
        );
      }

      if (result.rows.length === 0) {
        throw new OmnibaseError(
          `Compose reference error: step '${stepName}' returned no rows`,
          "COMPOSE_ERROR",
        );
      }

      const values = result.rows.map((row) => {
        const value = row[colIndex];
        if (typeof value === "number") {
          return String(value);
        }
        if (typeof value === "string") {
          return `'${value.replace(/'/g, "''")}'`;
        }
        throw new OmnibaseError(
          `Compose reference error: unsupported type '${typeof value}' for {${stepName}.${columnName}} (only string and number are supported)`,
          "COMPOSE_ERROR",
        );
      });

      return values.join(", ");
    },
  );
}
