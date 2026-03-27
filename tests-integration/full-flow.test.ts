// tests-integration/full-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SidecarClient } from "../src/sidecar-client.js";
import { ConnectionManager } from "../src/connection-manager.js";
import { parseConfig } from "../src/config.js";
import { handleListConnections } from "../src/tools/list-connections.js";
import { handleGetSchema } from "../src/tools/get-schema.js";
import { handleExecuteSql } from "../src/tools/execute-sql.js";
import { handleGetSample } from "../src/tools/get-sample.js";
import { handleSearchSchema } from "../src/tools/search-schema.js";
import { handleExplainQuery } from "../src/tools/explain-query.js";
import { resolve } from "path";
import { existsSync } from "fs";

const SIDECAR_PATH = resolve(__dirname, "../sidecar/omnibase-sidecar");
const canRun = existsSync(SIDECAR_PATH);

describe.skipIf(!canRun)("Full flow integration", () => {
  let sidecar: SidecarClient;
  let cm: ConnectionManager;
  const config = parseConfig(`
connections:
  test:
    dsn: "sqlite::memory:"
    permission: admin
    timeout: 5000
    max_rows: 100
  readonly:
    dsn: "sqlite::memory:"
    permission: read-only
    timeout: 5000
    max_rows: 100
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`);

  beforeAll(async () => {
    sidecar = new SidecarClient(SIDECAR_PATH);
    await sidecar.start();
    cm = new ConnectionManager(sidecar);

    // Set up test data
    await cm.execute(
      config.connections.test,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
    );
    await cm.execute(
      config.connections.test,
      "INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')",
    );
    await cm.execute(
      config.connections.test,
      "INSERT INTO users VALUES (2, 'Bob', 'bob@example.com')",
    );
    await cm.execute(
      config.connections.test,
      "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)",
    );
  });

  afterAll(async () => {
    await sidecar.stop();
  });

  it("list_connections shows all connections", () => {
    const result = handleListConnections(config, cm);
    expect(result).toHaveLength(2);
    const names = result.map((c) => c.name);
    expect(names).toContain("test");
    expect(names).toContain("readonly");
  });

  it("get_schema returns summary mode", async () => {
    const result = await handleGetSchema(config, cm, { connection: "test" });
    expect(result.tables.length).toBe(2);
    // Summary mode
    expect(result.tables[0]).toHaveProperty("column_count");
  });

  it("get_schema returns detailed mode for specific tables", async () => {
    const result = await handleGetSchema(config, cm, {
      connection: "test",
      tables: ["users"],
    });
    expect(result.tables.length).toBe(1);
    expect(result.tables[0]).toHaveProperty("columns");
  });

  it("execute_sql runs a SELECT", async () => {
    const result = await handleExecuteSql(config, cm, {
      connection: "test",
      query: "SELECT name FROM users ORDER BY id",
    });
    expect(result.row_count).toBe(2);
    expect(result.rows[0][0]).toBe("Alice");
  });

  it("execute_sql supports parameterized queries", async () => {
    const result = await handleExecuteSql(config, cm, {
      connection: "test",
      query: "SELECT name FROM users WHERE id = ?",
      params: [2],
    });
    expect(result.row_count).toBe(1);
    expect(result.rows[0][0]).toBe("Bob");
  });

  it("execute_sql rejects writes on read-only connection", async () => {
    // Permission enforcement happens in the MCP server (before reaching sidecar),
    // so we don't need a table to exist — the INSERT is rejected before execution.
    await expect(
      handleExecuteSql(config, cm, {
        connection: "readonly",
        query: "INSERT INTO t VALUES (1)",
      }),
    ).rejects.toThrow("read-only");
  });

  it("execute_sql rejects multi-statement queries", async () => {
    await expect(
      handleExecuteSql(config, cm, {
        connection: "test",
        query: "SELECT 1; DROP TABLE users",
      }),
    ).rejects.toThrow("Multi-statement");
  });

  it("get_sample returns rows from a table", async () => {
    const result = await handleGetSample(config, cm, {
      connection: "test",
      table: "users",
      limit: 1,
    });
    expect(result.row_count).toBe(1);
  });

  it("get_sample rejects unknown tables", async () => {
    await expect(
      handleGetSample(config, cm, {
        connection: "test",
        table: "nonexistent",
      }),
    ).rejects.toThrow("not found");
  });

  it("search_schema finds tables by name", async () => {
    const result = await handleSearchSchema(config, cm, {
      connection: "test",
      query: "users",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].tableName).toBe("users");
  });

  it("search_schema finds columns by name", async () => {
    const result = await handleSearchSchema(config, cm, {
      connection: "test",
      query: "email",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].columnName).toBe("email");
  });

  it("explain_query returns a plan", async () => {
    const result = await handleExplainQuery(config, cm, {
      connection: "test",
      query: "SELECT * FROM users",
    });
    expect(result).toHaveProperty("plan");
    expect(result.plan.length).toBeGreaterThan(0);
  });
});
