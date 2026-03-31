import type { SchemaInfo, TableInfo } from "./types.js";

const MAX_HINT_LENGTH = 800;
const MAX_COLS_PER_TABLE = 12;
const MAX_TABLES = 20;

export type ToolHandle = { update: (updates: { description?: string }) => void };

interface HintToolEntry {
  handle: ToolHandle;
  baseDescription: string;
}

export class SchemaHintManager {
  private tools: HintToolEntry[] = [];
  private schemasByConnection = new Map<string, SchemaInfo>();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  registerTool(handle: ToolHandle, baseDescription: string): void {
    this.tools.push({ handle, baseDescription });
  }

  updateHints(connectionName: string, schema: SchemaInfo): void {
    if (!this.enabled) return;
    this.schemasByConnection.set(connectionName, schema);
    const hint = this.buildHint();
    for (const { handle, baseDescription } of this.tools) {
      handle.update({ description: hint ? `${baseDescription}\n\n${hint}` : baseDescription });
    }
  }

  buildHint(): string {
    if (this.schemasByConnection.size === 0) return "";
    const parts: string[] = [];
    for (const [connName, schema] of this.schemasByConnection) {
      const connLabel = this.schemasByConnection.size > 1 ? `${connName}: ` : "";
      parts.push(connLabel + formatTables(schema.tables));
    }
    const joined = `Available tables: ${parts.join(" | ")}`;
    if (joined.length <= MAX_HINT_LENGTH) return joined;
    return truncateHint(this.schemasByConnection, MAX_HINT_LENGTH);
  }
}

export function formatTables(tables: TableInfo[]): string {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const visible = sorted.slice(0, MAX_TABLES);
  const formatted = visible.map((t) => {
    const cols = t.columns.slice(0, MAX_COLS_PER_TABLE).map((c) => c.name);
    const suffix = t.columns.length > MAX_COLS_PER_TABLE ? ", ..." : "";
    return `${t.name} (${cols.join(", ")}${suffix})`;
  });
  if (sorted.length > MAX_TABLES) {
    formatted.push(`+${sorted.length - MAX_TABLES} more tables`);
  }
  return formatted.join(", ");
}

function truncateHint(schemasByConnection: Map<string, SchemaInfo>, maxLength: number): string {
  for (let maxCols = MAX_COLS_PER_TABLE - 1; maxCols >= 4; maxCols--) {
    const parts: string[] = [];
    for (const [connName, schema] of schemasByConnection) {
      const connLabel = schemasByConnection.size > 1 ? `${connName}: ` : "";
      const sorted = [...schema.tables].sort((a, b) => a.name.localeCompare(b.name));
      const visible = sorted.slice(0, MAX_TABLES);
      const formatted = visible.map((t) => {
        const cols = t.columns.slice(0, maxCols).map((c) => c.name);
        const suffix = t.columns.length > maxCols ? ", ..." : "";
        return `${t.name} (${cols.join(", ")}${suffix})`;
      });
      if (sorted.length > MAX_TABLES) {
        formatted.push(`+${sorted.length - MAX_TABLES} more tables`);
      }
      parts.push(connLabel + formatted.join(", "));
    }
    const candidate = `Available tables: ${parts.join(" | ")}`;
    if (candidate.length <= maxLength) return candidate;
  }

  // Last resort: table names only
  const parts: string[] = [];
  for (const [connName, schema] of schemasByConnection) {
    const connLabel = schemasByConnection.size > 1 ? `${connName}: ` : "";
    const names = schema.tables
      .map((t) => t.name)
      .sort()
      .slice(0, MAX_TABLES);
    const overflow =
      schema.tables.length > MAX_TABLES ? ` (+${schema.tables.length - MAX_TABLES} more)` : "";
    parts.push(connLabel + names.join(", ") + overflow);
  }
  const fallback = `Available tables: ${parts.join(" | ")}`;
  return fallback.slice(0, maxLength - 3) + "...";
}
