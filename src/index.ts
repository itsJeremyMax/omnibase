#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"));
const VERSION: string = pkg.version;
import { loadConfig, resolveConfigPath } from "./config.js";
import { SidecarClient } from "./sidecar-client.js";
import { ConnectionManager } from "./connection-manager.js";
import { handleListConnections } from "./tools/list-connections.js";
import { handleGetSchema } from "./tools/get-schema.js";
import { handleExecuteSql } from "./tools/execute-sql.js";
import { handleExplainQuery } from "./tools/explain-query.js";
import { handleGetSample } from "./tools/get-sample.js";
import { handleSearchSchema } from "./tools/search-schema.js";
import { handleListTables } from "./tools/list-tables.js";
import { handleGetRelationships } from "./tools/get-relationships.js";
import { handleGetIndexes } from "./tools/get-indexes.js";
import { handleValidateQuery } from "./tools/validate-query.js";
import { handleGetTableStats } from "./tools/get-table-stats.js";
import { handleGetDistinctValues } from "./tools/get-distinct-values.js";
import { handleTestConnection } from "./tools/test-connection.js";
import { OmnibaseError } from "./types.js";

const STARTER_CONFIG = `# Omnibase configuration
# Docs: https://github.com/itsJeremyMax/omnibase

connections:
  my-db:
    dsn: "sqlite:./my-database.db"  # or pg://user:pass@host/db, my://user:pass@host/db
    permission: read-write            # read-only | read-write | admin

defaults:
  permission: read-only
  timeout: 30000
  max_rows: 500
`;

function handleInit(): void {
  const configPath = resolve(process.cwd(), "omnibase.config.yaml");
  if (existsSync(configPath)) {
    console.log(`omnibase.config.yaml already exists at ${configPath}`);
    process.exit(0);
  }
  writeFileSync(configPath, STARTER_CONFIG);
  console.log(`Created omnibase.config.yaml`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit omnibase.config.yaml with your database connection`);
  console.log(`  2. Add to Claude Code: claude mcp add omnibase -- npx -y omnibase-mcp`);
  process.exit(0);
}

// Handle CLI commands
if (process.argv[2] === "init") {
  handleInit();
}

async function main() {
  // Load config
  const configPath = resolveConfigPath(process.cwd());
  if (!configPath) {
    // Don't exit — start the server and return a helpful error on every tool call.
    // This lets the MCP client connect and see the error instead of a silent failure.
    console.error(
      "omnibase: no config file found. Run `npx omnibase-mcp@latest init` to create one, or see https://github.com/itsJeremyMax/omnibase#get-started",
    );
    const server = new McpServer({ name: "omnibase", version: VERSION });
    server.tool("list_connections", "List all configured database connections", {}, async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: true,
            message:
              "No omnibase.config.yaml found. Run `npx omnibase-mcp@latest init` to create one, set OMNIBASE_CONFIG env var, or see https://github.com/itsJeremyMax/omnibase#get-started",
          }),
        },
      ],
      isError: true,
    }));
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  const config = loadConfig(configPath);

  // Start sidecar
  const sidecarPath =
    process.env.OMNIBASE_SIDECAR_PATH ||
    resolve(__dirname, "..", "..", "sidecar", "omnibase-sidecar");
  const sidecar = new SidecarClient(sidecarPath);
  await sidecar.start();

  const cm = new ConnectionManager(sidecar);

  // Auto-recover: when sidecar crashes, reset connection state so
  // lazy reconnection works on the next tool call
  sidecar.setCrashHandler(() => {
    cm.handleSidecarCrash();
  });

  // Create MCP server
  const server = new McpServer({
    name: "omnibase",
    version: VERSION,
  });

  // Register tools
  server.tool(
    "list_connections",
    "List all configured database connections with their status and permission levels",
    {},
    async () => {
      try {
        const result = handleListConnections(config, cm);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "test_connection",
    "Test a specific database connection. Returns status, latency, and the actual driver error on failure. Use this to diagnose connection issues.",
    {
      connection: z.string().describe("Connection name from config"),
    },
    async ({ connection }) => {
      try {
        const result = await handleTestConnection(config, cm, { connection });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "get_schema",
    "Get database schema. Without tables param: returns summary (table names, column counts, PKs). With tables param: returns full column details for specified tables.",
    {
      connection: z.string().describe("Connection name from config"),
      tables: z.array(z.string()).optional().describe("Specific tables for detailed schema"),
      force_refresh: z.boolean().optional().describe("Force refresh cached schema"),
    },
    async ({ connection, tables, force_refresh }) => {
      try {
        const result = await handleGetSchema(config, cm, { connection, tables, force_refresh });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "execute_sql",
    "Execute a SQL query. Permission level of the connection determines what's allowed (read-only, read-write, admin). Supports parameterized queries.",
    {
      connection: z.string().describe("Connection name from config"),
      query: z.string().describe("SQL query to execute"),
      params: z
        .array(z.unknown())
        .optional()
        .describe("Query parameters for parameterized queries"),
    },
    async ({ connection, query, params }) => {
      try {
        const result = await handleExecuteSql(config, cm, { connection, query, params });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "explain_query",
    "Show the query execution plan without executing the query. Always allowed regardless of permission level.",
    {
      connection: z.string().describe("Connection name from config"),
      query: z.string().describe("SQL query to explain"),
    },
    async ({ connection, query }) => {
      try {
        const result = await handleExplainQuery(config, cm, { connection, query });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "get_sample",
    "Preview rows from a table. Table name is validated against schema to prevent injection.",
    {
      connection: z.string().describe("Connection name from config"),
      table: z.string().describe("Table name to sample"),
      limit: z.number().optional().describe("Number of rows to return (default 10)"),
    },
    async ({ connection, table, limit }) => {
      try {
        const result = await handleGetSample(config, cm, { connection, table, limit });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "search_schema",
    "Search for tables and columns by keyword. Searches names and comments. Returns up to 20 results ranked by relevance.",
    {
      connection: z.string().describe("Connection name from config"),
      query: z.string().describe("Search keyword"),
    },
    async ({ connection, query }) => {
      try {
        const result = await handleSearchSchema(config, cm, { connection, query });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "list_tables",
    "List all tables with row counts. Faster than get_schema for a quick overview of what's in the database. By default uses exact counts (COUNT(*)); set exact_counts=false for faster approximate counts on large databases.",
    {
      connection: z.string().describe("Connection name from config"),
      exact_counts: z
        .boolean()
        .optional()
        .describe(
          "When true (default), returns exact row counts via COUNT(*). When false, returns approximate counts from database statistics (faster but may be stale).",
        ),
    },
    async ({ connection, exact_counts }) => {
      try {
        const result = await handleListTables(config, cm, { connection, exact_counts });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "get_relationships",
    "Map foreign key relationships across the database. Returns a list of relationships and a graph showing what each table references and what references it. Optionally filter to a specific table.",
    {
      connection: z.string().describe("Connection name from config"),
      table: z.string().optional().describe("Filter to relationships involving this table"),
    },
    async ({ connection, table }) => {
      try {
        const result = await handleGetRelationships(config, cm, { connection, table });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "get_indexes",
    "List indexes across the database or for a specific table. Shows index name, columns, and uniqueness.",
    {
      connection: z.string().describe("Connection name from config"),
      table: z.string().optional().describe("Filter to indexes on this table"),
    },
    async ({ connection, table }) => {
      try {
        const result = await handleGetIndexes(config, cm, { connection, table });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "validate_query",
    "Check if a SQL query is syntactically valid and would be allowed by the connection's permission level, without executing it. Note: only checks syntax and permissions, not whether referenced tables/columns exist.",
    {
      connection: z.string().describe("Connection name from config"),
      query: z.string().describe("SQL query to validate"),
    },
    async ({ connection, query }) => {
      try {
        const result = await handleValidateQuery(config, cm, { connection, query });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "get_table_stats",
    "Column-level statistics for a table: null counts/percentages, distinct values, min/max. Uses a sample (default 10,000 rows) to avoid full table scans on large databases.",
    {
      connection: z.string().describe("Connection name from config"),
      table: z.string().describe("Table name"),
      sample_size: z.number().optional().describe("Max rows to sample (default 10000)"),
    },
    async ({ connection, table, sample_size }) => {
      try {
        const result = await handleGetTableStats(config, cm, { connection, table, sample_size });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  server.tool(
    "get_distinct_values",
    "Show distinct values and their counts for a column. Useful for understanding enums, statuses, categories, and other low-cardinality columns.",
    {
      connection: z.string().describe("Connection name from config"),
      table: z.string().describe("Table name"),
      column: z.string().describe("Column name"),
      limit: z.number().optional().describe("Max distinct values to return (default 50)"),
    },
    async ({ connection, table, column, limit }) => {
      try {
        const result = await handleGetDistinctValues(config, cm, {
          connection,
          table,
          column,
          limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await cm.disconnectAll(Object.values(config.connections));
    await sidecar.stop();
    process.exit(0);
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function errorResponse(err: unknown) {
  const message =
    err instanceof OmnibaseError
      ? `${err.code}: ${err.message}${err.detail ? ` (${err.detail})` : ""}`
      : err instanceof Error
        ? err.message
        : String(err);

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: true, message }) }],
    isError: true,
  };
}

main().catch((err) => {
  console.error("Failed to start omnibase:", err);
  process.exit(1);
});
