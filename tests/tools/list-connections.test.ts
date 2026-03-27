// tests/tools/list-connections.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleListConnections } from "../../src/tools/list-connections.js";
import { ConnectionManager } from "../../src/connection-manager.js";
import type { OmnibaseConfig } from "../../src/types.js";

describe("handleListConnections", () => {
  const config: OmnibaseConfig = {
    connections: {
      local: {
        name: "local",
        dsn: "sqlite::memory:",
        permission: "admin",
        timeout: 5000,
        maxRows: 100,
      },
      prod: {
        name: "prod",
        dsn: "pg://host/db",
        permission: "read-only",
        timeout: 30000,
        maxRows: 500,
      },
    },
    defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
  };

  it("returns all connections with status", () => {
    const backend = {
      connect: vi.fn(),
      execute: vi.fn(),
      getSchema: vi.fn(),
      ping: vi.fn(),
      disconnect: vi.fn(),
    };
    const cm = new ConnectionManager(backend);

    const result = handleListConnections(config, cm);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("local");
    expect(result[0].permissionLevel).toBe("admin");
    expect(result[0].status).toBe("available");
  });
});
