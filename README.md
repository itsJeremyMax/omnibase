<p align="center">
  <img src="assets/banner.svg" alt="Omnibase" width="100%" />
</p>

Give your AI agent secure access to any database. PostgreSQL, MySQL, SQLite, and [50+ more](https://github.com/xo/usql) through a single MCP server. Works with Claude Code, OpenCode, GitHub Copilot, Cursor, and any MCP-compatible client.

```yaml
# omnibase.config.yaml
connections:
  prod:
    dsn: $DATABASE_URL     # credentials stay in your environment
    permission: read-only   # read-only | read-write | admin
```

```
You: "What tables have the most NULL values?"
Agent: [calls get_table_stats] → shows null percentages per column across all tables
```

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

Edit `omnibase.config.yaml` with your database connection ([full configuration guide](docs/configuration.md), [examples](examples/)):

```yaml
connections:
  my-db:
    dsn: "pg://myuser:mypassword@localhost:5432/mydb"
    permission: read-write
```

DSNs starting with `$` resolve from environment variables (e.g. `dsn: $DATABASE_URL`).

That's it. Your agent now has access to 14 database tools, plus any [custom tools](docs/custom-tools.md) you define.

<details>
<summary>Install from source (contributors)</summary>

```bash
git clone https://github.com/itsJeremyMax/omnibase.git
cd omnibase
pnpm install
pnpm run build
```

Then point your MCP client at `node dist/src/index.js` with `cwd` set to your project directory.

</details>

## What Your Agent Gets

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

## Custom Tools

Define SQL templates as MCP tools in your config:

```yaml
tools:
  get_active_users:
    connection: my-db
    description: "Get all active users"
    sql: "SELECT * FROM users WHERE active = true"
```

Chain tools together with `compose` to build pipelines:

```yaml
tools:
  active_user_orders:
    connection: my-db
    description: "Get orders for all active users"
    compose:
      - tool: get_active_users
        as: users
      - sql: "SELECT * FROM orders WHERE user_id IN ({users.id})"
```

Also supports parameters, multi-statement transactions, and more.
[Full custom tools guide →](docs/custom-tools.md)

## Configuration

| Database | DSN |
|----------|-----|
| PostgreSQL | `pg://user:pass@host:5432/dbname` |
| MySQL | `my://user:pass@host:3306/dbname` |
| SQLite | `sqlite:./path/to/db.db` |
| SQL Server | `mssql://user:pass@host/dbname` |

Any [usql-compatible DSN](https://github.com/xo/usql#database-support) works. [Full configuration guide →](docs/configuration.md)

## Security

Every query is parsed and classified before it reaches your database.

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
pnpm run test:integration          # cross-database tests (needs Docker)
cd sidecar && go test ./... -v     # Go sidecar tests
```

## License

Apache 2.0. See [LICENSE](LICENSE)

## Disclaimer

This software is provided "as is", without warranty of any kind. The authors and contributors are not liable for any damages, data loss, or issues arising from the use of this tool. Omnibase executes SQL queries against real databases. Always review agent-generated queries, use read-only permissions where possible, and test thoroughly before use in production environments. By using this software, you accept full responsibility for its use.
