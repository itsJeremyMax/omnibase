import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { getConnection } from "../config.js";

export async function handleExplainQuery(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; query: string; analyze?: boolean },
) {
  const connConfig = getConnection(config, args.connection);

  // The sidecar handles dialect-specific explain:
  // - SQLite: EXPLAIN QUERY PLAN
  // - PostgreSQL/MySQL: EXPLAIN (or EXPLAIN ANALYZE when analyze=true)
  // - SQL Server: SET SHOWPLAN_TEXT ON + query + OFF (or SET STATISTICS PROFILE ON when analyze=true)
  const result = await cm.explainQuery(connConfig, args.query, args.analyze);

  const summary = summarizeExplainOutput(result.columns, result.rows);

  return {
    summary,
    plan: result.rows,
    columns: result.columns,
  };
}

/**
 * Post-process EXPLAIN output into a human-readable summary.
 * Auto-detects the output format based on column names and adapts accordingly.
 */
function summarizeExplainOutput(columns: string[], rows: unknown[][]): string[] {
  // EXPLAIN QUERY PLAN format (detail column): SQLite
  const detailIdx = columns.findIndex((c) => c.toLowerCase() === "detail");
  if (detailIdx >= 0) {
    return rows.map((r) => String(r[detailIdx]));
  }

  // Bytecode format (opcode column): SQLite bare EXPLAIN
  const opcodeIdx = columns.findIndex((c) => c.toLowerCase() === "opcode");
  if (opcodeIdx >= 0) {
    return summarizeBytecodeFormat(columns, rows, opcodeIdx);
  }

  // Text plan format (single "query plan" column): PostgreSQL
  if (columns.length === 1 && columns[0].toLowerCase().includes("query plan")) {
    return rows.map((r) => String(r[0]));
  }

  // SQL Server SHOWPLAN_TEXT (single "StmtText" column)
  const stmtTextIdx = columns.findIndex((c) => c.toLowerCase() === "stmttext");
  if (stmtTextIdx >= 0) {
    return rows.map((r) => String(r[stmtTextIdx]));
  }

  // Tabular format (MySQL EXPLAIN, other databases): return rows as readable strings
  if (rows.length > 0) {
    return rows.map((r) => r.join(" | "));
  }

  return ["No query plan available"];
}

function summarizeBytecodeFormat(
  columns: string[],
  rows: unknown[][],
  opcodeIdx: number,
): string[] {
  const summary: string[] = [];
  const tables = new Set<string>();
  const indexes = new Set<string>();
  let hasSort = false;
  let hasAgg = false;

  const commentIdx = columns.findIndex((c) => c.toLowerCase() === "comment");
  const p4Idx = columns.findIndex((c) => c.toLowerCase() === "p4");

  for (const row of rows) {
    const opcode = String(row[opcodeIdx]).toLowerCase();
    const comment = commentIdx >= 0 ? String(row[commentIdx] ?? "") : "";
    const p4 = p4Idx >= 0 ? String(row[p4Idx] ?? "") : "";

    if (opcode === "openread" || opcode === "openwrite") {
      const tableName = p4 || comment;
      if (tableName) tables.add(tableName);
    }

    if (opcode === "openread" && (p4 || comment)) {
      const name = p4 || comment;
      if (name.startsWith("idx_") || name.includes("autoindex") || name.includes("index")) {
        indexes.add(name);
      }
    }

    if (opcode === "sorteropen" || opcode === "sorterinsert" || opcode === "sort") {
      hasSort = true;
    }

    if (
      opcode === "aggregatestep" ||
      opcode === "aggregatefinal" ||
      opcode === "aggstep" ||
      opcode === "aggfinal"
    ) {
      hasAgg = true;
    }
  }

  if (tables.size > 0) {
    const scans = Array.from(tables).map((t) => {
      const usesIndex = Array.from(indexes).some(
        (idx) => idx.includes(t.toLowerCase()) || idx.includes(t),
      );
      return usesIndex ? `INDEX LOOKUP ${t}` : `SCAN ${t}`;
    });
    summary.push(...scans);
  }

  if (indexes.size > 0) {
    summary.push(`Using indexes: ${Array.from(indexes).join(", ")}`);
  }

  if (hasSort) summary.push("SORT");
  if (hasAgg) summary.push("AGGREGATE");

  if (summary.length === 0) {
    summary.push("Simple query (no table scans detected)");
  }

  return summary;
}
