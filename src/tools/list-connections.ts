// src/tools/list-connections.ts
import type { OmnibaseConfig, ConnectionInfo } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";

export function handleListConnections(
  config: OmnibaseConfig,
  cm: ConnectionManager,
): ConnectionInfo[] {
  return Object.values(config.connections).map((conn) => ({
    name: conn.name,
    databaseType: conn.dsn.split(":")[0],
    permissionLevel: conn.permission,
    status: cm.getStatus(conn.name),
  }));
}
