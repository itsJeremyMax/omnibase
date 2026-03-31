import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import type { AuditConfig } from "./types.js";

export interface AuditEntry {
  tool: string;
  connection: string;
  sql: string;
  params: unknown[];
  durationMs: number;
  rows: number;
  status: "ok" | "error";
  error?: string;
}

export class AuditLogger {
  constructor(private config: AuditConfig) {}

  async log(entry: AuditEntry): Promise<void> {
    if (!this.config.enabled) return;

    const ts = new Date().toISOString();

    try {
      await mkdir(dirname(this.config.path), { recursive: true });

      let line: string;
      if (this.config.format === "text") {
        const errorPart = entry.error ? ` error="${entry.error}"` : "";
        line =
          `[${ts}] ${entry.status.toUpperCase()} tool=${entry.tool} ` +
          `connection=${entry.connection} duration=${entry.durationMs}ms ` +
          `rows=${entry.rows}${errorPart} sql=${entry.sql}\n`;
      } else {
        const record: Record<string, unknown> = {
          ts,
          tool: entry.tool,
          connection: entry.connection,
          sql: entry.sql,
          params: entry.params,
          duration_ms: entry.durationMs,
          rows: entry.rows,
          status: entry.status,
        };
        if (entry.error !== undefined) record.error = entry.error;
        line = JSON.stringify(record) + "\n";
      }

      await appendFile(this.config.path, line, "utf-8");

      // Prune if max_entries is set
      if (this.config.maxEntries > 0) {
        await this.pruneIfNeeded();
      }
    } catch {
      // Never crash the server due to audit failures
    }
  }

  private async pruneIfNeeded(): Promise<void> {
    try {
      const content = await readFile(this.config.path, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length > this.config.maxEntries) {
        // Keep only the most recent maxEntries lines
        const pruned = lines.slice(lines.length - this.config.maxEntries);
        await writeFile(this.config.path, pruned.join("\n") + "\n", "utf-8");
      }
    } catch {
      // Silently ignore prune failures
    }
  }

  /**
   * Read recent audit entries (most recent first).
   * Used by the query_history MCP tool.
   */
  async readEntries(options?: {
    limit?: number;
    offset?: number;
    connection?: string;
    status?: "ok" | "error";
  }): Promise<Record<string, unknown>[]> {
    if (!this.config.enabled || this.config.format !== "jsonl") return [];

    try {
      const content = await readFile(this.config.path, "utf-8");
      let entries = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((e): e is Record<string, unknown> => e !== null)
        .reverse(); // Most recent first

      // Apply filters
      if (options?.connection) {
        entries = entries.filter((e) => e.connection === options.connection);
      }
      if (options?.status) {
        entries = entries.filter((e) => e.status === options.status);
      }

      // Apply pagination
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      return entries.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }
}
