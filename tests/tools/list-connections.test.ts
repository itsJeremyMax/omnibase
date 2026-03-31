// tests/tools/list-connections.test.ts
import { describe, it, expect, vi } from "vitest";
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

  function makeConnectionManager() {
    const backend = {
      connect: vi.fn().mockResolvedValue({ driver: "" }),
      execute: vi.fn(),
      getSchema: vi.fn(),
      explainQuery: vi.fn(),
      validateQuery: vi.fn(),
      ping: vi.fn(),
      disconnect: vi.fn(),
    };
    return { cm: new ConnectionManager(backend), backend };
  }

  it("returns all connections with status", () => {
    const { cm } = makeConnectionManager();
    const result = handleListConnections(config, cm);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("local");
    expect(result[0].permissionLevel).toBe("admin");
    expect(result[0].status).toBe("available");
  });

  it("uses driver from sidecar when connected", async () => {
    const { cm, backend } = makeConnectionManager();
    // Simulate connecting with a specific driver
    (backend.connect as ReturnType<typeof vi.fn>).mockResolvedValue({ driver: "postgres" });
    await cm.ensureConnected(config.connections.prod);

    const result = handleListConnections(config, cm);
    const prod = result.find((r) => r.name === "prod")!;
    expect(prod.databaseType).toBe("postgres");
  });

  it("falls back to DSN scheme for unconnected databases", () => {
    const { cm } = makeConnectionManager();
    const result = handleListConnections(config, cm);
    const prod = result.find((r) => r.name === "prod")!;
    // Not connected yet, so falls back to DSN prefix
    expect(prod.databaseType).toBe("pg");
  });

  it("passes through unknown schemes unchanged", () => {
    const { cm } = makeConnectionManager();
    const customConfig: OmnibaseConfig = {
      connections: {
        custom: {
          name: "custom",
          dsn: "cockroach://host/db",
          permission: "read-only",
          timeout: 5000,
          maxRows: 100,
        },
      },
      defaults: { permission: "read-only", timeout: 30000, maxRows: 500 },
    };
    const result = handleListConnections(customConfig, cm);
    expect(result[0].databaseType).toBe("cockroach");
  });
});
