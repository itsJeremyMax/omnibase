import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SidecarClient } from "../src/sidecar-client.js";
import { existsSync } from "fs";
import { resolve } from "path";

const SIDECAR_PATH = resolve(__dirname, "../sidecar/omnibase-sidecar");

// Skip if sidecar binary not built
const canRun = existsSync(SIDECAR_PATH);

describe.skipIf(!canRun)("SidecarClient", () => {
  let client: SidecarClient;

  beforeAll(async () => {
    client = new SidecarClient(SIDECAR_PATH);
    await client.start();
  });

  afterAll(async () => {
    await client.stop();
  });

  it("connects to SQLite in-memory", async () => {
    await client.connect("test", "sqlite::memory:");
    // If no error, connect succeeded
  });

  it("executes a query", async () => {
    await client.connect("exec-test", "sqlite::memory:");

    // Create table
    await client.execute("exec-test", "CREATE TABLE t (id INTEGER, name TEXT)");
    await client.execute("exec-test", "INSERT INTO t VALUES (1, 'alice'), (2, 'bob')");

    const result = await client.execute("exec-test", "SELECT * FROM t ORDER BY id");
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toEqual([1, "alice"]);
  });

  it("executes parameterized queries", async () => {
    await client.connect("param-test", "sqlite::memory:");
    await client.execute("param-test", "CREATE TABLE t (id INTEGER, name TEXT)");
    await client.execute("param-test", "INSERT INTO t VALUES (1, 'alice'), (2, 'bob')");

    const result = await client.execute("param-test", "SELECT name FROM t WHERE id = ?", [2]);
    expect(result.rows[0][0]).toBe("bob");
  });

  it("respects max_rows", async () => {
    await client.connect("limit-test", "sqlite::memory:");
    await client.execute("limit-test", "CREATE TABLE t (id INTEGER)");
    await client.execute("limit-test", "INSERT INTO t VALUES (1), (2), (3), (4), (5)");

    const result = await client.execute("limit-test", "SELECT * FROM t", undefined, { maxRows: 3 });
    expect(result.rowCount).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it("gets schema", async () => {
    await client.connect("schema-test", "sqlite::memory:");
    await client.execute(
      "schema-test",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    );

    const schema = await client.getSchema("schema-test");
    expect(schema.tables.length).toBe(1);
    expect(schema.tables[0].name).toBe("users");
    expect(schema.tables[0].columns.length).toBe(2);
  });

  it("pings a connection", async () => {
    await client.connect("ping-test", "sqlite::memory:");
    await client.ping("ping-test");
  });

  it("disconnects", async () => {
    await client.connect("dc-test", "sqlite::memory:");
    await client.disconnect("dc-test");

    // Ping should now fail
    await expect(client.ping("dc-test")).rejects.toThrow();
  });

  it("returns error for unknown connection", async () => {
    await expect(client.ping("nonexistent")).rejects.toThrow();
  });
});
