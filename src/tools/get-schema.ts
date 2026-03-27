// src/tools/get-schema.ts
import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { formatSchemaResult } from "../output-formatter.js";
import { getConnection } from "../config.js";

export async function handleGetSchema(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; tables?: string[]; force_refresh?: boolean },
) {
  const connConfig = getConnection(config, args.connection);

  const schema = await cm.getSchema(connConfig, args.force_refresh);

  let filtered = schema;
  const warnings: string[] = [];

  if (args.tables && args.tables.length > 0) {
    const tableSet = new Set(args.tables.map((t) => t.toLowerCase()));
    filtered = {
      tables: schema.tables.filter((t) => tableSet.has(t.name.toLowerCase())),
    };

    // Warn about requested tables that weren't found
    const foundNames = new Set(filtered.tables.map((t) => t.name.toLowerCase()));
    for (const requested of args.tables) {
      if (!foundNames.has(requested.toLowerCase())) {
        warnings.push(`Table '${requested}' not found`);
      }
    }
  }

  const detailed = !!args.tables && args.tables.length > 0;
  const result = formatSchemaResult(filtered, detailed);

  if (warnings.length > 0) {
    return { ...result, warnings };
  }
  return result;
}
