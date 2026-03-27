import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { getConnection } from "../config.js";

export async function handleListTables(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string },
) {
  const connConfig = getConnection(config, args.connection);

  const schema = await cm.getSchema(connConfig);

  return schema.tables.map((t) => ({
    name: t.name,
    schema: t.schema,
    row_count: t.rowCountEstimate,
  }));
}
