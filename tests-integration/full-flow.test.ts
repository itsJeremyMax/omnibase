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
import { handleTestConnection } from "../src/tools/test-connection.js";
import { handleListTables } from "../src/tools/list-tables.js";
import { handleGetRelationships } from "../src/tools/get-relationships.js";
import { handleGetIndexes } from "../src/tools/get-indexes.js";
import { handleValidateQuery } from "../src/tools/validate-query.js";
import { handleGetTableStats } from "../src/tools/get-table-stats.js";
import { handleGetDistinctValues } from "../src/tools/get-distinct-values.js";
import { executeCustomToolForTest, validateCustomTools } from "../src/custom-tools.js";
import { AuditLogger } from "../src/audit-logger.js";
import { resolve, join } from "path";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";

const SIDECAR_PATH = resolve(__dirname, "../sidecar/bin/omnibase-sidecar");
const DRIVERS_PATH = resolve(__dirname, "../sidecar/bin");
const canRun = existsSync(SIDECAR_PATH);

describe.skipIf(!canRun)("Full flow integration", () => {
  let sidecar: SidecarClient;
  let cm: ConnectionManager;
  let originalDriversPath: string | undefined;
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
    originalDriversPath = process.env.OMNIBASE_DRIVERS_PATH;
    process.env.OMNIBASE_DRIVERS_PATH = DRIVERS_PATH;
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
      "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT, status TEXT DEFAULT 'draft')",
    );
    await cm.execute(config.connections.test, "CREATE INDEX idx_posts_user_id ON posts(user_id)");
    await cm.execute(
      config.connections.test,
      "INSERT INTO posts VALUES (1, 1, 'First Post', 'published')",
    );
    await cm.execute(
      config.connections.test,
      "INSERT INTO posts VALUES (2, 1, 'Second Post', 'draft')",
    );
    await cm.execute(
      config.connections.test,
      "INSERT INTO posts VALUES (3, 2, 'Hello World', 'published')",
    );
  });

  afterAll(async () => {
    await sidecar.stop();
    if (originalDriversPath === undefined) {
      delete process.env.OMNIBASE_DRIVERS_PATH;
    } else {
      process.env.OMNIBASE_DRIVERS_PATH = originalDriversPath;
    }
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

  // --- test_connection ---

  it("test_connection returns ok for valid connection", async () => {
    const result = await handleTestConnection(config, cm, { connection: "test" });
    expect(result.status).toBe("ok");
    expect(result.connection).toBe("test");
    expect(typeof result.latency_ms).toBe("number");
  });

  it("test_connection returns error for unknown connection", async () => {
    await expect(handleTestConnection(config, cm, { connection: "nonexistent" })).rejects.toThrow(
      "Unknown connection",
    );
  });

  // --- list_tables ---

  it("list_tables returns tables with row counts", async () => {
    const result = await handleListTables(config, cm, { connection: "test" });
    const names = result.map((t: { name: string }) => t.name.toLowerCase());
    expect(names).toContain("users");
    expect(names).toContain("posts");
    const usersTable = result.find((t: { name: string }) => t.name.toLowerCase() === "users");
    expect(usersTable.row_count).toBe(2);
  });

  // --- get_relationships ---

  it("get_relationships finds foreign keys", async () => {
    const result = await handleGetRelationships(config, cm, { connection: "test" });
    expect(result.relationships.length).toBeGreaterThanOrEqual(1);
    const fk = result.relationships.find(
      (r: { from_table: string }) => r.from_table.toLowerCase() === "posts",
    );
    expect(fk).toBeDefined();
    expect(fk!.to_table.toLowerCase()).toBe("users");
  });

  it("get_relationships filters by table", async () => {
    const result = await handleGetRelationships(config, cm, {
      connection: "test",
      table: "posts",
    });
    expect(result.relationships.length).toBeGreaterThanOrEqual(1);
    for (const r of result.relationships) {
      const involves =
        r.from_table.toLowerCase() === "posts" || r.to_table.toLowerCase() === "posts";
      expect(involves).toBe(true);
    }
  });

  // --- get_indexes ---

  it("get_indexes finds indexes on posts", async () => {
    const result = await handleGetIndexes(config, cm, { connection: "test", table: "posts" });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const idx = result.find((i: { name: string }) => i.name.toLowerCase().includes("user_id"));
    expect(idx).toBeDefined();
  });

  // --- validate_query ---

  it("validate_query accepts valid SELECT", async () => {
    const result = await handleValidateQuery(config, cm, {
      connection: "test",
      query: "SELECT * FROM users",
    });
    expect(result.syntax_valid).toBe(true);
    expect(result.category).toBe("read");
    expect(result.would_be_allowed).toBe(true);
  });

  it("validate_query rejects write on read-only connection", async () => {
    const result = await handleValidateQuery(config, cm, {
      connection: "readonly",
      query: "INSERT INTO users VALUES (99, 'Test', 'test@test.com')",
    });
    expect(result.category).toBe("write");
    expect(result.would_be_allowed).toBe(false);
  });

  // --- get_table_stats ---

  it("get_table_stats returns column statistics", async () => {
    const result = await handleGetTableStats(config, cm, {
      connection: "test",
      table: "users",
    });
    expect(result.table.toLowerCase()).toBe("users");
    expect(result.columns.length).toBeGreaterThanOrEqual(3);
    const nameCol = result.columns.find((c: { name: string }) => c.name.toLowerCase() === "name");
    expect(nameCol).toBeDefined();
    expect(nameCol!.distinct_count).toBe(2);
    expect(nameCol!.null_count).toBe(0);
  });

  // --- get_distinct_values ---

  it("get_distinct_values returns values with counts", async () => {
    const result = await handleGetDistinctValues(config, cm, {
      connection: "test",
      table: "posts",
      column: "status",
    });
    expect(result.values.length).toBeGreaterThanOrEqual(2);
    const statuses = result.values.map((v: { value: unknown }) => v.value);
    expect(statuses).toContain("published");
    expect(statuses).toContain("draft");
  });

  // --- get_sample with WHERE and ORDER BY ---

  it("get_sample supports where and order_by", async () => {
    const result = await handleGetSample(config, cm, {
      connection: "test",
      table: "posts",
      where: "status = 'published'",
      order_by: "id ASC",
    });
    expect(result.row_count).toBe(2);
  });

  // --- Custom tools against real database ---

  it("executes a single-SQL custom tool", async () => {
    const toolConfig = parseConfig(`
connections:
  test:
    dsn: "sqlite::memory:"
    permission: admin
    timeout: 5000
    max_rows: 100
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
tools:
  get_published:
    connection: test
    description: "Get published posts"
    sql: "SELECT title FROM posts WHERE status = 'published' ORDER BY id"
`);
    validateCustomTools(toolConfig);

    // Reuse the existing CM since it already has the test connection with data
    const result = await executeCustomToolForTest(
      toolConfig,
      cm,
      "get_published",
      toolConfig.tools!.get_published,
      {},
    );
    expect(result.row_count).toBe(2);
  });

  it("executes a parameterized custom tool", async () => {
    const toolConfig = parseConfig(`
connections:
  test:
    dsn: "sqlite::memory:"
    permission: admin
    timeout: 5000
    max_rows: 100
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
tools:
  find_user:
    connection: test
    description: "Find user by name"
    sql: "SELECT id, email FROM users WHERE name = {name}"
    parameters:
      name:
        type: string
        description: "User name to search for"
`);
    validateCustomTools(toolConfig);

    const result = await executeCustomToolForTest(
      toolConfig,
      cm,
      "find_user",
      toolConfig.tools!.find_user,
      { name: "Alice" },
    );
    expect(result.row_count).toBe(1);
  });

  it("executes a multi-step custom tool with temp tables", async () => {
    const toolConfig = parseConfig(`
connections:
  test:
    dsn: "sqlite::memory:"
    permission: admin
    timeout: 5000
    max_rows: 100
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
tools:
  user_post_summary:
    connection: test
    description: "User post count summary"
    steps:
      - sql: "CREATE TEMP TABLE user_counts AS SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id"
      - sql: "SELECT u.name, uc.cnt FROM users u JOIN user_counts uc ON u.id = uc.user_id ORDER BY uc.cnt DESC"
        return: true
`);
    validateCustomTools(toolConfig);

    const result = await executeCustomToolForTest(
      toolConfig,
      cm,
      "user_post_summary",
      toolConfig.tools!.user_post_summary,
      {},
    );
    expect(result.row_count).toBe(2);

    // Run it again to verify temp table cleanup (should not throw "already exists")
    const result2 = await executeCustomToolForTest(
      toolConfig,
      cm,
      "user_post_summary",
      toolConfig.tools!.user_post_summary,
      {},
    );
    expect(result2.row_count).toBe(2);
  });

  // --- Audit logger integration ---

  it("audit logger writes and reads entries", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "omnibase-audit-int-"));
    const logPath = join(tmpDir, "audit.log");
    const auditLogger = new AuditLogger({
      enabled: true,
      path: logPath,
      format: "jsonl",
      maxEntries: 10000,
    });

    // Execute a query with audit logging
    await handleExecuteSql(
      config,
      cm,
      { connection: "test", query: "SELECT name FROM users ORDER BY id" },
      auditLogger,
    );

    // Wait for the fire-and-forget audit log write to flush
    await new Promise((r) => setTimeout(r, 100));

    // Read back entries
    const entries = await auditLogger.readEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].tool).toBe("execute_sql");
    expect(entries[0].connection).toBe("test");
    expect(entries[0].status).toBe("ok");
    expect(entries[0].rows).toBe(2);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
