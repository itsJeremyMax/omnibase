# Custom Tools

Define your own MCP tools as SQL templates in your config. Custom tools are registered alongside built-in tools and go through the same security pipeline.

## Basic Example

```yaml
tools:
  get_active_users:
    connection: my-db
    description: "Get all active users"
    sql: "SELECT * FROM users WHERE active = true"
    max_rows: 100
```

Custom tools are registered as `custom_<name>` (e.g., `custom_get_active_users`).

## Parameters

Parameters use `{param_name}` placeholders that are substituted as parameterized queries (not string interpolation) to prevent SQL injection.

```yaml
tools:
  find_orders_by_status:
    connection: my-db
    description: "Find orders filtered by status"
    permission: read-write
    parameters:
      status:
        type: enum
        description: "Order status"
        values: [pending, shipped, delivered, cancelled]
      min_amount:
        type: number
        description: "Minimum order amount"
        required: false
        default: 0
    sql: >
      SELECT * FROM orders
      WHERE status = {status}
        AND total >= {min_amount}
```

**Parameter types:** `string`, `number`, `boolean`, `enum`

**Auto-generated descriptions:** If you omit the `description` field, it will be derived from leading `-- ` comment lines in your SQL template.

**Optional overrides per tool:** `permission`, `max_rows`, `timeout` (fall back to connection/default values)

## Multi-Statement Tools

Use `steps` instead of `sql` to run multiple statements within a transaction. Mark one step with `return: true` to control which result goes back to the agent (defaults to the last step). If any step fails, the entire transaction is rolled back.

```yaml
tools:
  user_activity_report:
    connection: my-db
    description: "Generate user activity report"
    parameters:
      days:
        type: number
        description: "Days to look back"
        required: false
        default: 30
    steps:
      - sql: |
          CREATE TEMP TABLE recent_activity AS
          SELECT user_id, COUNT(*) as action_count
          FROM events
          WHERE created_at > datetime('now', '-' || {days} || ' days')
          GROUP BY user_id
      - sql: |
          SELECT u.name, u.email, COALESCE(ra.action_count, 0) as actions
          FROM users u
          LEFT JOIN recent_activity ra ON ra.user_id = u.id
          ORDER BY actions DESC
        return: true
```

## Tool Composition

Use `compose` to build pipelines where each step can call another custom tool or run inline SQL. Results from earlier steps are available to later steps via `{step_name.column}` references, which expand to comma-separated values.

```yaml
tools:
  get_active_user_ids:
    connection: my-db
    description: "Get active user IDs"
    sql: "SELECT id FROM users WHERE active = true"

  active_user_orders:
    connection: my-db
    description: "Get orders for all active users"
    compose:
      - tool: get_active_user_ids
        as: users
      - sql: "SELECT * FROM orders WHERE user_id IN ({users.id})"
        as: orders
```

Steps run sequentially and the last step's result is returned. Tool-ref steps can pass arguments via `args`, and inline SQL steps can reference results from any prior step. Circular dependencies between composed tools are detected at validation time.

## Hot Reload

The server watches your config file and reloads custom tools automatically when it changes. No restart needed.

## CLI Management

```bash
npx omnibase-mcp tools list       # list all custom tools
npx omnibase-mcp tools add        # interactive wizard to add a tool
npx omnibase-mcp tools remove     # interactive wizard to remove a tool
npx omnibase-mcp tools validate   # validate custom tool definitions
npx omnibase-mcp tools test       # dry-run a tool with sample arguments
```
