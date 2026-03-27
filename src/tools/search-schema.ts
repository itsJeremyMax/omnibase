// src/tools/search-schema.ts
import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { formatSearchResults } from "../output-formatter.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";

export async function handleSearchSchema(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; query: string },
) {
  const connConfig = getConnection(config, args.connection);

  if (!args.query || !args.query.trim()) {
    throw new OmnibaseError("Search query cannot be empty", "INVALID_QUERY");
  }

  const schema = await cm.getSchema(connConfig);
  return formatSearchResults(schema.tables, args.query);
}
