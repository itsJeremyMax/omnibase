# Configuration

## DSN Formats

Any [usql-compatible DSN](https://github.com/xo/usql#database-support) works. DSNs starting with `$` resolve from environment variables (e.g., `dsn: $DATABASE_URL`).

| Database | DSN |
|----------|-----|
| SQLite | `sqlite:./path/to/db.db` |
| PostgreSQL | `pg://user:pass@host:5432/dbname` |
| MySQL | `my://user:pass@host:3306/dbname` |
| SQL Server | `mssql://user:pass@host/dbname` |
| Oracle | `or://user:pass@host:1521/sid` |

See `examples/` for full config files per database.

## Connection Options

```yaml
connections:
  my-db:
    dsn: $DATABASE_URL          # required
    permission: read-only       # read-only | read-write | admin (default: read-only)
    timeout: 30000              # query timeout in ms (default: 30000)
    max_rows: 500               # max rows returned per query (default: 500)
    max_value_length: 500       # truncate column values longer than this (default: 500)
    allow_all_pragmas: false    # allow all SQLite PRAGMAs (default: false)
    read_only_tables:           # optional - protect specific tables from writes
      - users
      - audit_log
    schema_filter:              # optional - limit visible schemas/tables
      schemas: [public]
```

## Defaults

Override built-in defaults for all connections:

```yaml
defaults:
  permission: read-only         # default permission for connections that don't specify one
  timeout: 30000                # default query timeout in ms
  max_rows: 500                 # default max rows returned per query
```

## Permission Levels

| Level | SELECT | INSERT/UPDATE/DELETE | CREATE/ALTER/DROP |
|-------|--------|---------------------|-------------------|
| `read-only` | Yes | No | No |
| `read-write` | Yes | Yes | No |
| `admin` | Yes | Yes | Yes |

## Schema Hints

Omnibase embeds table and column names directly in tool descriptions so your AI agent sees the schema without needing to call `get_schema` first. This is enabled by default and updates automatically when a schema is fetched.

```yaml
schema_hints: true   # embed table/column names in tool descriptions (default: true)
```

## Audit Logging

Log every query to a local file for debugging and compliance. The `query_history` MCP tool lets agents view their own query history.

```yaml
audit:
  enabled: true
  path: ./.omnibase/audit.log     # default: .omnibase/audit.log next to config file
  format: jsonl                    # jsonl (default) or text
  max_entries: 10000               # 0 = unlimited (default: 10000)
```

The audit log defaults to `.omnibase/audit.log` in the same directory as your config file, so each project gets its own log. By default, the last 10,000 entries are retained and older entries are automatically pruned.

## Config Discovery

1. `OMNIBASE_CONFIG` environment variable
2. `./omnibase.config.yaml` in working directory
3. `~/.config/omnibase/config.yaml`
