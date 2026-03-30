import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { getConnection } from "../config.js";

export async function handleListTables(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; exact_counts?: boolean },
) {
  const connConfig = getConnection(config, args.connection);
  const exactCounts = args.exact_counts ?? true;

  const schema = await cm.getSchema(connConfig, { exactCounts });

  return schema.tables.map((t) => ({
    name: t.name,
    schema: t.schema,
    ...(t.exactCount
      ? { row_count: t.rowCountEstimate }
      : { row_count_estimate: t.rowCountEstimate }),
  }));
}
