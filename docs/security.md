# Security & Architecture

## How Queries Are Inspected

Every query is inspected before it reaches your database.

Omnibase parses and classifies each SQL statement. A `DELETE FROM users` without a WHERE clause gets flagged. A `pg_read_file('/etc/passwd')` gets blocked. A `WITH x AS (UPDATE ...) SELECT ...` is correctly identified as a write, not a read.

This isn't just read-only mode. It's:

- **Dangerous function blocking** across all engines: `pg_read_file`, `xp_cmdshell`, `LOAD_FILE`, `lo_export`, and dozens more
- **Sensitive table protection.** `pg_shadow`, `mysql.user`, `sys.sql_logins` are inaccessible, even with schema-qualified names
- **Permission levels per connection.** Read-only, read-write, admin. The agent's access is independent of the database user's privileges
- **Schema-aware validation.** `validate_query` checks that tables and columns actually exist, resolves aliases, catches fake columns in INSERT lists, and warns about bulk operations
- **Write impact estimation.** Before running an UPDATE or DELETE, see how many rows would be affected
- **Portable parameterized queries.** Use `?` everywhere. Omnibase translates to `$1` (Postgres), `:1` (Oracle), `@p1` (SQL Server) automatically

## Security Summary

- Credentials never reach agents. DSNs resolve server-side; agents see connection names only
- Read-only by default. Every connection requires explicit opt-in for writes
- SQL is parsed and classified before execution. Unrecognized statements default to "write" (fail safe)
- Multi-statement queries are rejected. Prevents `SELECT 1; DROP TABLE users`
- Dangerous functions are blocked: filesystem access, OS execution, credential exposure across all engines
- Table names are validated against the schema cache. Prevents SQL injection in tool parameters
- Sidecar auto-recovery. If the Go process crashes, it respawns transparently on the next call

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
