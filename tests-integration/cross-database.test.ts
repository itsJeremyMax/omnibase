/**
 * Cross-database integration tests.
 *
 * Runs the same test suite against SQLite, PostgreSQL, and MySQL to verify
 * provider-agnostic behavior. Postgres/MySQL require Docker containers
 * (see docker-compose.yml). Tests skip gracefully if containers aren't running.
 *
 * Run:
 *   docker compose -f tests-integration/docker-compose.yml up -d
 *   pnpm exec vitest run --config vitest.integration.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SidecarClient } from "../src/sidecar-client.js";
import { ConnectionManager } from "../src/connection-manager.js";
import { parseConfig } from "../src/config.js";
import { handleGetSchema } from "../src/tools/get-schema.js";
import { handleExecuteSql } from "../src/tools/execute-sql.js";
import { handleGetSample } from "../src/tools/get-sample.js";
import { handleSearchSchema } from "../src/tools/search-schema.js";
import { handleListTables } from "../src/tools/list-tables.js";
import { handleGetRelationships } from "../src/tools/get-relationships.js";
import { handleGetIndexes } from "../src/tools/get-indexes.js";
import { handleGetDistinctValues } from "../src/tools/get-distinct-values.js";
import { handleGetTableStats } from "../src/tools/get-table-stats.js";
import { handleValidateQuery } from "../src/tools/validate-query.js";
import { resolve } from "path";
import { existsSync } from "fs";
import type { OmnibaseConfig } from "../src/types.js";
import net from "net";

const SIDECAR_PATH = resolve(__dirname, "../sidecar/omnibase-sidecar");
const canRun = existsSync(SIDECAR_PATH);

/** Check if a TCP port is reachable */
async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

interface DatabaseTestCase {
  name: string;
  connectionName: string;
  dsn: string;
  /** SQL to create the test tables — database-specific syntax */
  setupSQL: string[];
  /** Param placeholder style */
  paramPlaceholder: (n: number) => string;
  /** Whether this DB is always available (SQLite) or needs Docker */
  alwaysAvailable: boolean;
  port?: number;
}

const databases: DatabaseTestCase[] = [
  {
    name: "SQLite",
    connectionName: "sqlite-test",
    dsn: "sq::memory:",
    paramPlaceholder: (_n) => "?",
    alwaysAvailable: true,
    setupSQL: [
      `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, role TEXT DEFAULT 'user')`,
      `CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, status TEXT DEFAULT 'draft')`,
      `CREATE INDEX idx_posts_user_id ON posts(user_id)`,
      `INSERT INTO users (id, name, email, role) VALUES (1, 'Alice', 'alice@test.com', 'admin')`,
      `INSERT INTO users (id, name, email, role) VALUES (2, 'Bob', 'bob@test.com', 'user')`,
      `INSERT INTO users (id, name, email, role) VALUES (3, 'Charlie', 'charlie@test.com', 'user')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (1, 1, 'First Post', 'published')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (2, 1, 'Second Post', 'draft')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (3, 2, 'Hello World', 'published')`,
    ],
  },
  {
    name: "PostgreSQL",
    connectionName: "pg-test",
    dsn: "pg://omnibase:omnibase@localhost:15432/testdb?sslmode=disable",
    paramPlaceholder: (n) => `$${n}`,
    alwaysAvailable: false,
    port: 15432,
    setupSQL: [
      `DROP TABLE IF EXISTS posts`,
      `DROP TABLE IF EXISTS users`,
      `CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT, role TEXT DEFAULT 'user')`,
      `CREATE TABLE posts (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, status TEXT DEFAULT 'draft')`,
      `CREATE INDEX idx_posts_user_id ON posts(user_id)`,
      `INSERT INTO users (id, name, email, role) VALUES (1, 'Alice', 'alice@test.com', 'admin')`,
      `INSERT INTO users (id, name, email, role) VALUES (2, 'Bob', 'bob@test.com', 'user')`,
      `INSERT INTO users (id, name, email, role) VALUES (3, 'Charlie', 'charlie@test.com', 'user')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (1, 1, 'First Post', 'published')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (2, 1, 'Second Post', 'draft')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (3, 2, 'Hello World', 'published')`,
    ],
  },
  {
    name: "MySQL",
    connectionName: "mysql-test",
    dsn: "my://omnibase:omnibase@localhost:13306/testdb",
    paramPlaceholder: (_n) => "?",
    alwaysAvailable: false,
    port: 13306,
    setupSQL: [
      `DROP TABLE IF EXISTS posts`,
      `DROP TABLE IF EXISTS users`,
      `CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255), role VARCHAR(50) DEFAULT 'user')`,
      `CREATE TABLE posts (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, title VARCHAR(255) NOT NULL, status VARCHAR(50) DEFAULT 'draft', FOREIGN KEY (user_id) REFERENCES users(id))`,
      `CREATE INDEX idx_posts_user_id ON posts(user_id)`,
      `INSERT INTO users (id, name, email, role) VALUES (1, 'Alice', 'alice@test.com', 'admin')`,
      `INSERT INTO users (id, name, email, role) VALUES (2, 'Bob', 'bob@test.com', 'user')`,
      `INSERT INTO users (id, name, email, role) VALUES (3, 'Charlie', 'charlie@test.com', 'user')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (1, 1, 'First Post', 'published')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (2, 1, 'Second Post', 'draft')`,
      `INSERT INTO posts (id, user_id, title, status) VALUES (3, 2, 'Hello World', 'published')`,
    ],
  },
];

for (const db of databases) {
  describe.skipIf(!canRun)(`Cross-database: ${db.name}`, () => {
    let sidecar: SidecarClient;
    let cm: ConnectionManager;
    let config: OmnibaseConfig;
    let available = db.alwaysAvailable;

    beforeAll(async () => {
      // Check if Docker container is running for non-SQLite databases
      if (!db.alwaysAvailable && db.port) {
        available = await isPortOpen(db.port);
        if (!available) return;
      }

      sidecar = new SidecarClient(SIDECAR_PATH);
      await sidecar.start();
      cm = new ConnectionManager(sidecar);

      config = parseConfig(`
connections:
  ${db.connectionName}:
    dsn: "${db.dsn}"
    permission: admin
    timeout: 10000
    max_rows: 100
defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`);

      // Set up test data
      for (const sql of db.setupSQL) {
        await cm.execute(config.connections[db.connectionName], sql);
      }
    });

    afterAll(async () => {
      if (sidecar) await sidecar.stop();
    });

    // --- Schema tools ---

    it("list_tables returns tables with row counts", async () => {
      if (!available) return;
      const result = await handleListTables(config, cm, { connection: db.connectionName });
      const names = result.map((t: { name: string }) => t.name.toLowerCase());
      expect(names).toContain("users");
      expect(names).toContain("posts");
    });

    it("get_schema returns summary mode", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, { connection: db.connectionName });
      expect(result.tables.length).toBeGreaterThanOrEqual(2);
      expect(result.tables[0]).toHaveProperty("column_count");
      expect(result.tables[0]).not.toHaveProperty("columns");
    });

    it("get_schema returns detail mode for specific tables", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, {
        connection: db.connectionName,
        tables: ["users"],
      });
      expect(result.tables.length).toBe(1);
      expect(result.tables[0]).toHaveProperty("columns");
      const columns = (result.tables[0] as { columns: { name: string }[] }).columns;
      const colNames = columns.map((c) => c.name.toLowerCase());
      expect(colNames).toContain("id");
      expect(colNames).toContain("name");
      expect(colNames).toContain("email");
    });

    it("get_schema detects primary keys", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, {
        connection: db.connectionName,
        tables: ["users"],
      });
      const table = result.tables[0] as {
        primary_key: string[];
        columns: { name: string; is_primary_key: boolean }[];
      };
      expect(table.primary_key.map((k: string) => k.toLowerCase())).toContain("id");
      const idCol = table.columns.find((c) => c.name.toLowerCase() === "id");
      expect(idCol?.is_primary_key).toBe(true);
    });

    it("get_schema detects foreign keys", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, {
        connection: db.connectionName,
        tables: ["posts"],
      });
      const table = result.tables[0] as {
        foreign_keys: { column: string; references_table: string }[];
      };
      expect(table.foreign_keys.length).toBeGreaterThanOrEqual(1);
      const fk = table.foreign_keys.find((f) => f.column.toLowerCase() === "user_id");
      expect(fk).toBeDefined();
      expect(fk!.references_table.toLowerCase()).toBe("users");
    });

    it("get_schema returns row counts", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, { connection: db.connectionName });
      const usersTable = result.tables.find(
        (t: { name: string }) => t.name.toLowerCase() === "users",
      ) as { row_count: number };
      expect(usersTable).toBeDefined();
      expect(usersTable.row_count).toBe(3);
    });

    it("get_schema returns columns in definition order", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, {
        connection: db.connectionName,
        tables: ["users"],
      });
      const columns = (result.tables[0] as { columns: { name: string }[] }).columns;
      const colNames = columns.map((c) => c.name.toLowerCase());
      // id should come before name, name before email — definition order
      expect(colNames.indexOf("id")).toBeLessThan(colNames.indexOf("name"));
      expect(colNames.indexOf("name")).toBeLessThan(colNames.indexOf("email"));
    });

    it("get_schema uses consistent snake_case keys", async () => {
      if (!available) return;
      const result = await handleGetSchema(config, cm, {
        connection: db.connectionName,
        tables: ["users"],
      });
      const table = result.tables[0] as Record<string, unknown>;
      // Should have snake_case keys, not camelCase
      expect(table).toHaveProperty("primary_key");
      expect(table).toHaveProperty("foreign_keys");
      expect(table).toHaveProperty("row_count");
      expect(table).not.toHaveProperty("primaryKey");
      expect(table).not.toHaveProperty("foreignKeys");
      expect(table).not.toHaveProperty("rowCountEstimate");
    });

    it("search_schema finds tables", async () => {
      if (!available) return;
      const result = await handleSearchSchema(config, cm, {
        connection: db.connectionName,
        query: "users",
      });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].tableName.toLowerCase()).toBe("users");
    });

    it("search_schema finds columns", async () => {
      if (!available) return;
      const result = await handleSearchSchema(config, cm, {
        connection: db.connectionName,
        query: "email",
      });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].columnName!.toLowerCase()).toBe("email");
    });

    it("get_relationships finds foreign keys", async () => {
      if (!available) return;
      const result = await handleGetRelationships(config, cm, {
        connection: db.connectionName,
      });
      expect(result.relationships.length).toBeGreaterThanOrEqual(1);
      const fk = result.relationships.find(
        (r: { from_table: string }) => r.from_table.toLowerCase() === "posts",
      );
      expect(fk).toBeDefined();
      expect(fk!.to_table.toLowerCase()).toBe("users");
    });

    it("get_indexes finds indexes", async () => {
      if (!available) return;
      const result = await handleGetIndexes(config, cm, {
        connection: db.connectionName,
        table: "posts",
      });
      expect(result.length).toBeGreaterThanOrEqual(1);
      const idx = result.find((i: { name: string }) => i.name.toLowerCase().includes("user_id"));
      expect(idx).toBeDefined();
    });

    // --- Query tools ---

    it("execute_sql runs SELECT", async () => {
      if (!available) return;
      const result = await handleExecuteSql(config, cm, {
        connection: db.connectionName,
        query: "SELECT name FROM users ORDER BY id",
      });
      expect(result.row_count).toBe(3);
      expect(result.rows[0][0]).toBe("Alice");
    });

    it("execute_sql runs parameterized SELECT", async () => {
      if (!available) return;
      const p = db.paramPlaceholder(1);
      const result = await handleExecuteSql(config, cm, {
        connection: db.connectionName,
        query: `SELECT name FROM users WHERE id = ${p}`,
        params: [2],
      });
      expect(result.row_count).toBe(1);
      expect(result.rows[0][0]).toBe("Bob");
    });

    it("execute_sql returns affected_rows for writes", async () => {
      if (!available) return;
      const result = await handleExecuteSql(config, cm, {
        connection: db.connectionName,
        query: "UPDATE posts SET status = 'archived' WHERE status = 'draft'",
      });
      expect(result.affected_rows).toBe(1);
    });

    it("get_sample returns rows", async () => {
      if (!available) return;
      const result = await handleGetSample(config, cm, {
        connection: db.connectionName,
        table: "users",
        limit: 2,
      });
      expect(result.row_count).toBe(2);
    });

    // --- Data analysis tools ---

    it("get_distinct_values returns values with counts", async () => {
      if (!available) return;
      const result = await handleGetDistinctValues(config, cm, {
        connection: db.connectionName,
        table: "users",
        column: "role",
      });
      expect(result.values.length).toBeGreaterThanOrEqual(2);
      const roles = result.values.map((v: { value: unknown }) => v.value);
      expect(roles).toContain("admin");
      expect(roles).toContain("user");
    });

    it("get_table_stats returns column statistics", async () => {
      if (!available) return;
      const result = await handleGetTableStats(config, cm, {
        connection: db.connectionName,
        table: "users",
      });
      expect(result.table.toLowerCase()).toBe("users");
      expect(result.columns.length).toBeGreaterThanOrEqual(4);
      const nameCol = result.columns.find((c: { name: string }) => c.name.toLowerCase() === "name");
      expect(nameCol).toBeDefined();
      expect(nameCol!.distinct_count).toBe(3);
      expect(nameCol!.null_count).toBe(0);
    });

    // --- Safety tools ---

    it("validate_query validates SELECT", async () => {
      if (!available) return;
      const result = await handleValidateQuery(config, cm, {
        connection: db.connectionName,
        query: "SELECT * FROM users",
      });
      expect(result.syntax_valid).toBe(true);
      expect(result.category).toBe("read");
      expect(result.would_be_allowed).toBe(true);
    });

    it("validate_query estimates rows for UPDATE", async () => {
      if (!available) return;
      const result = await handleValidateQuery(config, cm, {
        connection: db.connectionName,
        query: "UPDATE users SET role = 'inactive' WHERE role = 'user'",
      });
      expect(result.category).toBe("write");
      expect(result.estimated_rows_affected).toBe(2);
    });

    it("rejects multi-statement queries", async () => {
      if (!available) return;
      await expect(
        handleExecuteSql(config, cm, {
          connection: db.connectionName,
          query: "SELECT 1; DROP TABLE users",
        }),
      ).rejects.toThrow("Multi-statement");
    });
  });
}
