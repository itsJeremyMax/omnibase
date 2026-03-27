// src/tools/get-sample.ts
import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { formatQueryResult } from "../output-formatter.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";
import { getDialect, selectWithLimit } from "../sql-dialect.js";

export async function handleGetSample(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; table: string; limit?: number },
) {
  const connConfig = getConnection(config, args.connection);

  // Validate table name against schema to prevent injection
  const schema = await cm.getSchema(connConfig);
  const validTable = schema.tables.find((t) => t.name.toLowerCase() === args.table.toLowerCase());
  if (!validTable) {
    throw new OmnibaseError(
      `Table '${args.table}' not found in connection '${args.connection}'`,
      "TABLE_NOT_FOUND",
    );
  }

  if (args.limit !== undefined && args.limit < 0) {
    throw new OmnibaseError("limit must be non-negative", "INVALID_PARAMS");
  }
  const limit = args.limit ?? 10;
  const dialect = getDialect(connConfig);
  const query = selectWithLimit("*", validTable.name, limit, dialect);
  const result = await cm.execute(connConfig, query);
  return formatQueryResult(result, limit, connConfig.maxValueLength);
}
