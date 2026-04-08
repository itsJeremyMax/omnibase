# Use Cases

Real-world scenarios where Omnibase helps your AI agent work with databases effectively.

## Custom tool reuse

Define a complex report once, use it forever. Your agent calls it by name. No SQL needed.

```yaml
tools:
  churn_report:
    connection: app
    description: "Weekly churn report. Users active last month but not this month."
    sql: |
      SELECT u.id, u.name, u.email, MAX(e.created_at) AS last_active
      FROM users u
      JOIN events e ON e.user_id = u.id
      WHERE e.created_at < DATE('now', '-30 days')
        AND u.id NOT IN (
          SELECT DISTINCT user_id FROM events
          WHERE created_at >= DATE('now', '-30 days')
        )
      GROUP BY u.id
```

```
You: "Run the churn report."
Agent: [calls custom_churn_report] → returns 23 users who churned this month
```

Every developer on the team gets the same tool by pulling the latest config.

## Write protection in action

Permission enforcement isn't just a setting. It actively stops your agent from making mistakes.

```
You: "Clean up the test data in the users table."
Agent: [calls execute_sql with DELETE FROM users WHERE email LIKE '%@test.com']
       → Blocked: Connection 'prod' is read-only, write queries are not allowed.
Agent: "I can't delete from the users table. The prod connection is read-only.
        Want me to check the staging connection instead?"
```

The agent adapts to the constraint instead of failing silently. No data lost.

## Audit trail for compliance

Every query your agent runs is logged. See who ran what, when, and how long it took.

```yaml
audit:
  enabled: true
  # path defaults to .omnibase/audit.log
```

```bash
npx omnibase-mcp audit tail
```

```
2026-04-08T14:22:01Z [ok] execute_sql @ prod-db 12ms 847 rows
  SELECT u.name, COUNT(o.id) FROM users u JOIN orders o ON ...
2026-04-08T14:22:03Z [error] execute_sql @ prod-db 2ms 0 rows
  DROP TABLE users  Connection 'prod-db' is read-only, ddl queries are not allowed
```

Useful for debugging agent behavior, compliance audits, and understanding query patterns.

## Onboarding new team members

A new developer joins your project. Instead of reading migration files and ER diagrams, they ask their agent:

```
You: "What databases does this project use and what's in them?"
Agent: [calls list_connections] → 3 databases: app (Postgres), analytics (ClickHouse), warehouse (MySQL)
       [calls list_tables on each] → 47 tables total
       [calls get_relationships on app] → maps foreign keys
       "Here's the data model: the app database has 32 tables centered around
        users, orders, and products. The analytics database tracks events and
        metrics. Here are the key relationships..."
```

This works because the `omnibase.config.yaml` is committed to the repo. New developers get the same database access as everyone else. No setup, no Slack messages asking for credentials.

## Cross-database analytics

Your data lives in multiple databases. Your agent can query all of them in a single conversation.

```
You: "What's our average order value by region, and how does it correlate with
      the support ticket volume in each region?"
Agent: [queries orders on app] → calculates AOV by region
       [queries support_tickets on warehouse] → counts tickets by region
       "Here's the breakdown: APAC has the highest AOV ($142) but also the most
        support tickets (340). EMEA has lower AOV ($98) with fewer tickets (120).
        The correlation suggests higher-value orders generate more support load."
```

No ETL pipeline, no data warehouse, no waiting for the analytics team. The agent works with the data where it lives.

## Compose pipelines for multi-step reports

Chain tools together for complex workflows that would be tedious to do manually.

```yaml
tools:
  admin_assigned_tasks:
    connection: app
    description: "Get all tasks assigned to admin users"
    compose:
      - tool: get_admin_user_ids
        as: admins
      - sql: |
          SELECT t.title, t.status, t.priority, u.name AS assignee
          FROM tasks t
          JOIN users u ON t.assigned_to = u.id
          WHERE t.assigned_to IN ({admins.id})
          ORDER BY t.priority DESC
        as: tasks

  get_admin_user_ids:
    connection: app
    description: "Get IDs of admin users"
    sql: "SELECT id FROM users WHERE role = 'admin'"
```

The first tool feeds its results into the second. The agent calls `custom_admin_assigned_tasks` and gets the final report in one step. Compose pipelines keep complex logic in config, not in agent prompts.
