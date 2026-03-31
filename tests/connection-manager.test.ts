import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionManager } from "../src/connection-manager.js";
import type { DatabaseBackend, ConnectionConfig, SchemaInfo, QueryResult } from "../src/types.js";

function createMockBackend(): DatabaseBackend {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      hasMore: false,
    } satisfies QueryResult),
    getSchema: vi.fn().mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          columns: [
            {
              name: "id",
              type: "INT",
              nullable: false,
              defaultValue: null,
              isPrimaryKey: true,
              comment: null,
            },
          ],
          primaryKey: ["id"],
          indexes: [],
          foreignKeys: [],
          rowCountEstimate: 100,
          exactCount: false,
          comment: null,
        },
      ],
    } satisfies SchemaInfo),
    ping: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

const testConfig: ConnectionConfig = {
  name: "test",
  dsn: "sqlite::memory:",
  permission: "read-only",
  timeout: 5000,
  maxRows: 100,
};

describe("ConnectionManager", () => {
  let backend: DatabaseBackend;
  let manager: ConnectionManager;

  beforeEach(() => {
    backend = createMockBackend();
    manager = new ConnectionManager(backend);
  });

  it("connects lazily on first operation", async () => {
    await manager.ensureConnected(testConfig);
    expect(backend.connect).toHaveBeenCalledWith("test", "sqlite::memory:");
  });

  it("does not reconnect if already connected", async () => {
    await manager.ensureConnected(testConfig);
    await manager.ensureConnected(testConfig);
    expect(backend.connect).toHaveBeenCalledTimes(1);
  });

  it("caches schema on first getSchema call", async () => {
    await manager.ensureConnected(testConfig);
    const schema1 = await manager.getSchema(testConfig);
    const schema2 = await manager.getSchema(testConfig);

    expect(backend.getSchema).toHaveBeenCalledTimes(1);
    expect(schema1).toEqual(schema2);
  });

  it("invalidates schema cache on force refresh", async () => {
    await manager.ensureConnected(testConfig);
    await manager.getSchema(testConfig);
    await manager.getSchema(testConfig, { forceRefresh: true });

    expect(backend.getSchema).toHaveBeenCalledTimes(2);
  });

  it("invalidates schema cache on DDL", async () => {
    await manager.ensureConnected(testConfig);
    await manager.getSchema(testConfig);

    manager.invalidateSchemaCache("test");

    await manager.getSchema(testConfig);
    expect(backend.getSchema).toHaveBeenCalledTimes(2);
  });

  it("tracks connection status", () => {
    expect(manager.getStatus("test")).toBe("available");
  });

  it("tracks connected status after connect", async () => {
    await manager.ensureConnected(testConfig);
    expect(manager.getStatus("test")).toBe("connected");
  });

  describe("acquireTransactionLock", () => {
    it("acquires and releases a lock", async () => {
      const release = await manager.acquireTransactionLock("test");
      expect(typeof release).toBe("function");
      release();
    });

    it("serializes concurrent lock acquisitions", async () => {
      const order: string[] = [];

      const release1 = await manager.acquireTransactionLock("test");
      order.push("acquired-1");

      // Second acquisition should wait
      const lock2Promise = manager.acquireTransactionLock("test").then((release) => {
        order.push("acquired-2");
        return release;
      });

      // Give the event loop a chance to process
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual(["acquired-1"]); // lock2 should still be waiting

      release1();
      order.push("released-1");

      const release2 = await lock2Promise;
      release2();
      order.push("released-2");

      expect(order).toEqual(["acquired-1", "released-1", "acquired-2", "released-2"]);
    });

    it("allows locks on different connections concurrently", async () => {
      const release1 = await manager.acquireTransactionLock("conn-a");
      const release2 = await manager.acquireTransactionLock("conn-b");

      // Both acquired without blocking
      release1();
      release2();
    });

    it("releases lock even if work throws", async () => {
      const release1 = await manager.acquireTransactionLock("test");
      release1(); // simulate finally block

      // Should be able to acquire again immediately
      const release2 = await manager.acquireTransactionLock("test");
      release2();
    });
  });

  it("applies schema filter when fetching", async () => {
    const configWithFilter: ConnectionConfig = {
      ...testConfig,
      schemaFilter: { schemas: ["public"], tables: ["users"] },
    };
    await manager.ensureConnected(configWithFilter);
    await manager.getSchema(configWithFilter);

    expect(backend.getSchema).toHaveBeenCalledWith("test", {
      schemas: ["public"],
      tables: ["users"],
    });
  });
});
