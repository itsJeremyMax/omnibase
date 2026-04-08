<p align="center">
  <img src="assets/banner.svg" alt="Omnibase" width="100%" />
</p>

Give your AI agent secure access to every database. PostgreSQL, MySQL, SQLite, ClickHouse, SQL Server, and [50+ more](https://github.com/xo/usql) through a single MCP server. Works with Claude Code, OpenCode, GitHub Copilot, Cursor, and any MCP-compatible client.

- **One server, every database.** Connect Postgres, MySQL, ClickHouse, and SQL Server side by side. Your agent picks the right one.
- **Secure by default.** Read-only permissions, query classification, credential isolation. Agents get guardrails, not footguns.
- **Shareable config.** One YAML file defines connections, permissions, and custom tools. Commit it, and your whole team gets the same agent capabilities.

## Get Started

**1. Add to Claude Code:**

```bash
claude mcp add omnibase -- npx -y omnibase-mcp@latest
```

<details>
<summary>OpenCode, GitHub Copilot, Cursor, and other MCP clients</summary>

Add to your MCP config (`.mcp.json`):

```json
{
  "mcpServers": {
    "omnibase": {
      "command": "npx",
      "args": ["-y", "omnibase-mcp"]
    }
  }
}
```

</details>

**2. Create a config file:**

```bash
npx omnibase-mcp init
```

Edit `omnibase.config.yaml` with your database connections ([full configuration guide](docs/configuration.md)):

```yaml
connections:
  app:
    dsn: pg://localhost:5432/myapp    # or $DATABASE_URL from env
    permission: read-write
  analytics:
    dsn: clickhouse://localhost:9000/analytics
    permission: read-write
  warehouse:
    dsn: mysql://user:pass@localhost:3306/warehouse
    permission: read-only
```

That's it. Your agent now has access to 14 database tools, plus any [custom tools](docs/custom-tools.md) you define.

<details>
<summary>Install from source (contributors)</summary>

```bash
git clone https://github.com/itsJeremyMax/omnibase.git
cd omnibase
pnpm install
pnpm build
```

Then point your MCP client at `node dist/src/index.js` with `cwd` set to your project directory.

</details>

## What Your Agent Can Do

### Understand any codebase's data model in seconds

```
You: "I just joined this project. Walk me through the data model."
```

Your agent connects to `app`, `analytics`, and `warehouse`, discovers tables across all three, traces foreign key relationships, and returns a complete summary: table names, column types, row counts, and how everything connects. What used to take hours of reading migration files takes seconds.

*Tools used: list_connections, list_tables, get_schema, get_relationships*

<details>
<summary>What you'd do manually</summary>

```sql
-- Connect to each database separately, then run:

-- app (Postgres)
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '...';
SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY';
SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables;

-- analytics (ClickHouse — different syntax)
SELECT name FROM system.tables WHERE database = currentDatabase();
SELECT name, type, is_in_primary_key FROM system.columns WHERE table = '...';
-- ClickHouse doesn't have foreign keys, so no FK query available

-- warehouse (MySQL — yet another syntax)
SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE();
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '...';
SELECT table_name, column_name, referenced_table_name, referenced_column_name
  FROM information_schema.key_column_usage WHERE referenced_table_name IS NOT NULL;

-- Then manually stitch the results together across all three
```

</details>

### Query across databases

```
You: "Compare our product inventory in warehouse with what customers
      actually ordered last quarter in app. What's sitting on shelves?"
```

Your agent queries `warehouse` (MySQL) for current stock levels, pulls last quarter's order volumes from `app` (Postgres), and joins the results by SKU. It identifies 34 products with over 500 units in stock but fewer than 10 orders. You can't write a single query for this because the data lives in two different database engines.

*Tools used: list_connections, get_schema, execute_sql (across app and warehouse)*

<details>
<summary>What you'd do manually</summary>

```sql
-- Terminal 1: warehouse (MySQL)
SELECT sku, product_name, quantity_on_hand
  FROM inventory
  WHERE quantity_on_hand > 0;
-- Copy results to a spreadsheet or temp file

-- Terminal 2: app (Postgres)
SELECT p.sku, SUM(oi.quantity) AS units_ordered
  FROM order_items oi
  JOIN products p ON oi.product_id = p.id
  JOIN orders o ON oi.order_id = o.id
  WHERE o.ordered_at >= NOW() - INTERVAL '3 months'
  GROUP BY p.sku;
-- Copy results to the same spreadsheet

-- Manually match SKUs across both result sets
-- Filter to high-stock, low-order items
-- Reformat into something useful
```

</details>

### Debug with live data

```
You: "The /api/orders endpoint is returning wrong totals. Figure out why."
```

Your agent reads the route handler, queries the orders table in `app`, then checks `analytics` and finds the pre-computed totals are out of sync. It traces the mismatch to a missing category, updates the analytics table, hits the endpoint again, and confirms the response is now correct.

*Tools used: get_schema, execute_sql (across app and analytics)*

### Investigate production issues safely

```
You: "Failed payments spiked 3x in the last hour. What's going on?"
```

Your agent explores the payments schema on `warehouse` (read-only), runs analytics on the last hour of transactions, and identifies that all failures share a single payment provider and error code. Not a single row modified. The connection is read-only, so the agent couldn't write even if it tried.

*Tools used: get_schema, execute_sql (read-only on warehouse), get_distinct_values*

[More use cases →](docs/use-cases.md)

## Built-in Tools

Your agent gets 14 tools out of the box, covering schema exploration, parameterized queries, and execution plan analysis.

<details>
<summary>All 14 tools</summary>

### Discover

| Tool | What it does |
|------|-------------|
| `list_connections` | See all configured databases and their status |
| `test_connection` | Ping a specific database. Returns latency and driver error on failure |
| `list_tables` | Quick overview with row counts |
| `get_schema` | Summary or detailed column/index/FK info |
| `search_schema` | Find tables and columns by keyword |
| `get_relationships` | Map foreign keys across the entire database |
| `get_indexes` | List indexes with columns and uniqueness |

### Query

| Tool | What it does |
|------|-------------|
| `execute_sql` | Run queries with permission enforcement and parameterized inputs |
| `explain_query` | See the query plan without executing |
| `get_sample` | Preview rows from any table (injection-safe) |

### Analyze

| Tool | What it does |
|------|-------------|
| `get_table_stats` | Column cardinality, null rates, min/max (sampled) |
| `get_distinct_values` | Distinct values with counts for any column |

### Validate

| Tool | What it does |
|------|-------------|
| `validate_query` | Check syntax, schema references, permissions, and estimate affected rows before executing |

### History

| Tool | What it does |
|------|-------------|
| `query_history` | View recent query execution history with filtering by connection, status, and pagination |

</details>

## Custom Tools

Define SQL templates as MCP tools your whole team can use. Add them to your config and commit. Every agent on the project gets the same capabilities, no code required.

```yaml
tools:
  get_active_users:
    connection: app
    description: "Get all active users"
    sql: "SELECT * FROM users WHERE active = true"
```

Chain tools together with `compose` to build multi-step pipelines:

```yaml
tools:
  active_user_orders:
    connection: app
    description: "Get orders for all active users"
    compose:
      - tool: get_active_users
        as: users
      - sql: "SELECT * FROM orders WHERE user_id IN ({users.id})"
        as: orders
```

Custom tools live in `omnibase.config.yaml` alongside your connections. Commit it to your repo and your team shares the same tools, permissions, and database access.

[Full custom tools guide →](docs/custom-tools.md)

## Configuration

| Database | DSN |
|----------|-----|
| PostgreSQL | `pg://user:pass@host:5432/dbname` |
| MySQL | `mysql://user:pass@host:3306/dbname` |
| ClickHouse | `clickhouse://host:9000/dbname` |
| SQLite | `sqlite:./path/to/db.db` |
| SQL Server | `mssql://user:pass@host/dbname` |

Any [usql-compatible DSN](https://github.com/xo/usql#database-support) works. [Full configuration guide →](docs/configuration.md)

## Security

Every query is parsed and classified before it reaches your database. Your agent never sees credentials, can't run dangerous functions, and respects the permission level you set.

- Credentials never reach agents. DSNs resolve server-side
- Read-only by default. Explicit opt-in for writes
- Dangerous functions blocked across all engines
- Multi-statement queries rejected
- Table names validated against schema cache

[Security deep dive & architecture →](docs/security.md)

## CLI

```bash
npx omnibase-mcp status           # health dashboard
npx omnibase-mcp tools list       # list custom tools
npx omnibase-mcp upgrade          # upgrade to latest
```

[Full CLI reference →](docs/cli.md)

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, and conventions.

```bash
pnpm test                          # unit tests
pnpm test:integration              # cross-database tests (needs Docker)
cd sidecar && go test ./... -v     # Go sidecar tests
```

## License

Apache 2.0. See [LICENSE](LICENSE)

## Disclaimer

This software is provided "as is", without warranty of any kind. The authors and contributors are not liable for any damages, data loss, or issues arising from the use of this tool. Omnibase executes SQL queries against real databases. Always review agent-generated queries, use read-only permissions where possible, and test thoroughly before use in production environments. By using this software, you accept full responsibility for its use.
