# Omnibase

Give your AI agent secure access to any database. PostgreSQL, MySQL, SQLite, and [50+ more](https://github.com/xo/usql) through a single MCP server. Works with Claude Code, OpenCode, GitHub Copilot, Cursor, and any MCP-compatible client.

```yaml
# omnibase.config.yaml — all options: https://github.com/itsJeremyMax/omnibase#configuration-reference
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

Edit `omnibase.config.yaml` with your database connection ([all options](#configuration-reference), [more examples](examples/)):

```yaml
connections:
  my-db:
    dsn: "pg://myuser:mypassword@localhost:5432/mydb"
    permission: read-write
```

DSNs starting with `$` resolve from environment variables (e.g. `dsn: $DATABASE_URL`).

That's it. Your agent now has access to 13 database tools.

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
| `test_connection` | Ping a specific database — returns latency and driver error on failure |
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

## What Makes This Different

**Every query is inspected before it reaches your database.**

Omnibase parses and classifies each SQL statement. A `DELETE FROM users` without a WHERE clause gets flagged. A `pg_read_file('/etc/passwd')` gets blocked. A `WITH x AS (UPDATE ...) SELECT ...` is correctly identified as a write, not a read.

This isn't just read-only mode. It's:

- **Dangerous function blocking** across all engines — `pg_read_file`, `xp_cmdshell`, `LOAD_FILE`, `lo_export`, and dozens more
- **Sensitive table protection** — `pg_shadow`, `mysql.user`, `sys.sql_logins` are inaccessible, even with schema-qualified names
- **Permission levels per connection** — read-only, read-write, admin. The agent's access is independent of the database user's privileges
- **Schema-aware validation** — `validate_query` checks that tables and columns actually exist, resolves aliases, catches fake columns in INSERT lists, and warns about bulk operations
- **Write impact estimation** — before running an UPDATE or DELETE, see how many rows would be affected
- **Portable parameterized queries** — use `?` everywhere, Omnibase translates to `$1` (Postgres), `:1` (Oracle), `@p1` (SQL Server) automatically

## Configuration Reference

### DSN formats

| Database | DSN |
|----------|-----|
| SQLite | `sqlite:./path/to/db.db` |
| PostgreSQL | `pg://user:pass@host:5432/dbname` |
| MySQL | `my://user:pass@host:3306/dbname` |
| SQL Server | `mssql://user:pass@host/dbname` |
| Oracle | `or://user:pass@host:1521/sid` |

Any [usql-compatible DSN](https://github.com/xo/usql#database-support) works. DSNs starting with `$` resolve from environment variables.

### Connection options

```yaml
connections:
  my-db:
    dsn: $DATABASE_URL          # required
    permission: read-only       # read-only | read-write | admin (default: read-only)
    timeout: 30000              # query timeout in ms (default: 30000)
    max_rows: 500               # max rows returned per query (default: 500)
    max_value_length: 500       # truncate column values longer than this (default: 500)
    allow_all_pragmas: false    # allow all SQLite PRAGMAs (default: false)
    read_only_tables:           # optional — protect specific tables from writes
      - users
      - audit_log
    schema_filter:              # optional — limit visible schemas/tables
      schemas: [public]

# Optional — override built-in defaults
defaults:
  permission: read-only         # default permission for connections that don't specify one
  timeout: 30000                # default query timeout in ms
  max_rows: 500                 # default max rows returned per query
```

### Config discovery

1. `OMNIBASE_CONFIG` environment variable
2. `./omnibase.config.yaml` in working directory
3. `~/.config/omnibase/config.yaml`

### Permission levels

| Level | SELECT | INSERT/UPDATE/DELETE | CREATE/ALTER/DROP |
|-------|--------|---------------------|-------------------|
| `read-only` | Yes | No | No |
| `read-write` | Yes | Yes | No |
| `admin` | Yes | Yes | Yes |

## Architecture

```
MCP Client (Claude Code, OpenCode, GitHub Copilot, Cursor)
        |  MCP Protocol (stdio)
        v
Omnibase MCP Server (TypeScript)
  - Permission enforcement, query analysis, schema caching, output formatting
        |  JSON-RPC over stdin/stdout
        v
Go Sidecar (usql driver packages)
  - Native database connections, parameterized queries, schema introspection
        |  Native drivers
        v
Any Database
```

The TypeScript server handles agent-facing concerns. The Go sidecar handles database concerns. Adding a new database driver only requires changes in Go.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, and conventions.

```bash
pnpm test                          # unit tests
pnpm run test:integration          # cross-database tests (needs Docker)
cd sidecar && go test ./... -v     # Go sidecar tests
```

## Security

- Credentials never reach agents — DSNs resolve server-side, agents see connection names only
- Read-only by default — every connection requires explicit opt-in for writes
- SQL parsed and classified before execution — unrecognized statements default to "write" (fail safe)
- Multi-statement queries rejected — prevents `SELECT 1; DROP TABLE users`
- Dangerous functions blocked — filesystem access, OS execution, credential exposure across all engines
- Table names validated against schema cache — prevents SQL injection in tool parameters
- Sidecar auto-recovery — if the Go process crashes, it respawns transparently on the next call

## License

Apache 2.0 — see [LICENSE](LICENSE)

## Disclaimer

This software is provided "as is", without warranty of any kind. The authors and contributors are not liable for any damages, data loss, or issues arising from the use of this tool. Omnibase executes SQL queries against real databases. Always review agent-generated queries, use read-only permissions where possible, and test thoroughly before use in production environments. By using this software, you accept full responsibility for its use.
