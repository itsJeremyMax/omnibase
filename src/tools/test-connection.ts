import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { getConnection } from "../config.js";

export async function handleTestConnection(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string },
) {
  const connConfig = getConnection(config, args.connection);

  const start = Date.now();
  try {
    await cm.ping(connConfig);
    const latencyMs = Date.now() - start;
    return {
      connection: connConfig.name,
      status: "ok",
      latency_ms: latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      connection: connConfig.name,
      status: "error",
      latency_ms: latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
