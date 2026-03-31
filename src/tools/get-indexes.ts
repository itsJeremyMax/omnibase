import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";

interface IndexEntry {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
  partial: boolean;
  filter?: string;
}

export async function handleGetIndexes(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; table?: string },
) {
  const connConfig = getConnection(config, args.connection);

  const schema = await cm.getSchema(connConfig);

  // Validate table exists if specified
  if (args.table) {
    const tableExists = schema.tables.some(
      (t) => t.name.toLowerCase() === args.table!.toLowerCase(),
    );
    if (!tableExists) {
      throw new OmnibaseError(
        `Table '${args.table}' not found in connection '${args.connection}'`,
        "TABLE_NOT_FOUND",
      );
    }
  }

  const indexes: IndexEntry[] = [];
  for (const table of schema.tables) {
    if (args.table && table.name.toLowerCase() !== args.table.toLowerCase()) {
      continue;
    }
    for (const idx of table.indexes ?? []) {
      const entry: IndexEntry = {
        table: table.name,
        name: idx.name,
        columns: idx.columns,
        unique: idx.unique,
        type: idx.type || "unknown",
        partial: idx.filter != null,
      };
      if (idx.filter != null) {
        entry.filter = idx.filter;
      }
      indexes.push(entry);
    }
  }

  return indexes;
}
