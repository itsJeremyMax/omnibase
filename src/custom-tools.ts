import { z } from "zod";
import type {
  OmnibaseConfig,
  CustomToolParameter,
  CustomToolConfig,
  QueryResult,
  PermissionLevel,
  ComposeStep,
} from "./types.js";
import { OmnibaseError } from "./types.js";
import { expandComposeReferences } from "./compose-expander.js";
import { getConnection } from "./config.js";
import { classifyQuery, isMultiStatement } from "./query-analyzer.js";
import { enforcePermission } from "./permission-enforcer.js";
import { formatQueryResult } from "./output-formatter.js";
import { checkSqlSecurity } from "./tools/execute-sql.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuditLogger } from "./audit-logger.js";

const VALID_PERMISSIONS: PermissionLevel[] = ["read-only", "read-write", "admin"];

const BUILT_IN_TOOL_NAMES = new Set([
  "list_connections",
  "test_connection",
  "get_schema",
  "execute_sql",
  "explain_query",
  "get_sample",
  "search_schema",
  "list_tables",
  "get_relationships",
  "get_indexes",
  "validate_query",
  "get_table_stats",
  "get_distinct_values",
]);

const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Extract {param} placeholders from a SQL template.
 */
export function extractPlaceholders(sql: string): string[] {
  const matches = sql.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

/**
 * Extract leading `-- ` comment lines from a SQL template and join them
 * into a single description string. Returns undefined if no comments found.
 */
export function extractSqlDescription(sql: string): string | undefined {
  const lines = sql.split("\n");
  const commentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("-- ")) {
      commentLines.push(trimmed.slice(3).trim());
    } else if (trimmed !== "") {
      break;
    }
  }
  return commentLines.length > 0 ? commentLines.join(" ") : undefined;
}

/**
 * Validate all custom tool definitions against the config.
 * Throws on the first validation error found.
 */
export function validateCustomTools(config: OmnibaseConfig): void {
  if (!config.tools) return;

  for (const [name, tool] of Object.entries(config.tools)) {
    // Tool name format
    if (!TOOL_NAME_PATTERN.test(name)) {
      throw new OmnibaseError(
        `Custom tool '${name}': name must be alphanumeric and underscores only, starting with a letter`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // No collision with built-ins
    if (BUILT_IN_TOOL_NAMES.has(name)) {
      throw new OmnibaseError(
        `Custom tool '${name}' collides with a built-in tool name`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Description must be present (either explicit or derived from SQL comments)
    if (!tool.description) {
      throw new OmnibaseError(
        `Custom tool '${name}': missing 'description'. Add a description field or start the SQL with '-- ' comment lines`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Connection must exist
    try {
      getConnection(config, tool.connection);
    } catch {
      throw new OmnibaseError(
        `Custom tool '${name}': connection '${tool.connection}' does not exist`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Permission override must be valid
    if (tool.permission && !VALID_PERMISSIONS.includes(tool.permission)) {
      throw new OmnibaseError(
        `Custom tool '${name}': invalid permission '${tool.permission}'. Must be one of: ${VALID_PERMISSIONS.join(", ")}`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Validate sql/steps/compose mutual exclusivity
    const definedModes = [tool.sql != null, tool.steps != null, tool.compose != null].filter(
      Boolean,
    ).length;
    if (definedModes > 1) {
      throw new OmnibaseError(
        `Custom tool '${name}': cannot define more than one of 'sql', 'steps', or 'compose'`,
        "INVALID_TOOL_CONFIG",
      );
    }
    if (definedModes === 0) {
      throw new OmnibaseError(
        `Custom tool '${name}': must define either 'sql', 'steps', or 'compose'`,
        "INVALID_TOOL_CONFIG",
      );
    }

    if (tool.steps != null) {
      if (tool.steps.length === 0) {
        throw new OmnibaseError(
          `Custom tool '${name}': 'steps' must have at least one step`,
          "INVALID_TOOL_CONFIG",
        );
      }
      if (tool.steps.filter((s) => s.return).length > 1) {
        throw new OmnibaseError(
          `Custom tool '${name}': at most one step may have 'return: true'`,
          "INVALID_TOOL_CONFIG",
        );
      }
    }

    // Validate compose pipeline
    if (tool.compose != null) {
      validateComposePipeline(name, tool, config);
    }

    // Validate parameters (skip for compose tools since they don't use {param} in top-level SQL)
    if (tool.compose == null) {
      const allSql = tool.sql != null ? [tool.sql] : tool.steps!.map((s) => s.sql);
      const placeholders = [...new Set(allSql.flatMap((s) => extractPlaceholders(s)))];
      const definedParams = new Set(Object.keys(tool.parameters ?? {}));

      // Every placeholder must have a parameter definition
      for (const placeholder of placeholders) {
        if (!definedParams.has(placeholder)) {
          throw new OmnibaseError(
            `Custom tool '${name}': SQL placeholder {${placeholder}} has no matching parameter definition`,
            "INVALID_TOOL_CONFIG",
          );
        }
      }
    }

    // Validate each parameter
    if (tool.parameters) {
      for (const [paramName, param] of Object.entries(tool.parameters)) {
        // Enum must have values
        if (param.type === "enum" && (!param.values || param.values.length === 0)) {
          throw new OmnibaseError(
            `Custom tool '${name}': enum parameter '${paramName}' must have a non-empty 'values' array`,
            "INVALID_TOOL_CONFIG",
          );
        }

        // Optional params must have a default
        if (param.required === false && param.default === undefined) {
          throw new OmnibaseError(
            `Custom tool '${name}': optional parameter '${paramName}' must have a 'default' value`,
            "INVALID_TOOL_CONFIG",
          );
        }
      }
    }
  }

  // Cross-tool circular dependency detection for compose tools
  detectComposeCircularDeps(config);
}

const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateComposePipeline(
  toolName: string,
  tool: CustomToolConfig,
  config: OmnibaseConfig,
): void {
  const compose = tool.compose!;

  if (compose.length === 0) {
    throw new OmnibaseError(
      `Custom tool '${toolName}': 'compose' must have at least one step`,
      "INVALID_TOOL_CONFIG",
    );
  }

  const stepNames = new Set<string>();
  const paramNames = new Set(Object.keys(tool.parameters ?? {}));

  for (const step of compose) {
    // Each step needs 'as'
    if (!step.as) {
      throw new OmnibaseError(
        `Custom tool '${toolName}': each compose step must have an 'as' name`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // 'as' must be a valid identifier
    if (!VALID_IDENTIFIER.test(step.as)) {
      throw new OmnibaseError(
        `Custom tool '${toolName}': compose step 'as' name '${step.as}' must be a valid identifier`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Unique within pipeline
    if (stepNames.has(step.as)) {
      throw new OmnibaseError(
        `Custom tool '${toolName}': duplicate compose step name '${step.as}'`,
        "INVALID_TOOL_CONFIG",
      );
    }
    stepNames.add(step.as);

    // Must not shadow parameter names
    if (paramNames.has(step.as)) {
      throw new OmnibaseError(
        `Custom tool '${toolName}': compose step name '${step.as}' shadows a parameter name`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Each step has either tool or sql, not both
    const hasTool = step.tool != null;
    const hasSql = step.sql != null;
    if (hasTool === hasSql) {
      throw new OmnibaseError(
        `Custom tool '${toolName}': compose step '${step.as}' must have exactly one of 'tool' or 'sql'`,
        "INVALID_TOOL_CONFIG",
      );
    }

    // Tool references must exist in config
    if (hasTool) {
      if (!config.tools || !config.tools[step.tool!]) {
        throw new OmnibaseError(
          `Custom tool '${toolName}': compose step '${step.as}' references unknown tool '${step.tool}'`,
          "INVALID_TOOL_CONFIG",
        );
      }
    }
  }
}

/**
 * Detect circular dependencies across composed tools via DFS.
 */
function detectComposeCircularDeps(config: OmnibaseConfig): void {
  if (!config.tools) return;

  // Build adjacency: tool -> set of tools it references via compose
  const edges = new Map<string, Set<string>>();
  for (const [name, tool] of Object.entries(config.tools)) {
    if (tool.compose) {
      const refs = new Set<string>();
      for (const step of tool.compose) {
        if (step.tool) {
          refs.add(step.tool);
        }
      }
      if (refs.size > 0) {
        edges.set(name, refs);
      }
    }
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      throw new OmnibaseError(
        `Circular dependency detected in compose tools: ${cycle.join(" -> ")}`,
        "INVALID_TOOL_CONFIG",
      );
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const neighbors = edges.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path, node]);
      }
    }

    inStack.delete(node);
  }

  for (const node of edges.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }
}

/**
 * Substitute {param} placeholders with ? positional params and return values array.
 * Handles type coercion and validation.
 */
export function substituteParameters(
  sql: string,
  args: Record<string, unknown>,
  paramDefs: Record<string, CustomToolParameter>,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];

  const substituted = sql.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, paramName: string) => {
    const def = paramDefs[paramName];
    if (!def) return _match; // shouldn't happen after validation

    let value = args[paramName];

    // Use default for optional params not provided
    if (value === undefined && def.required === false) {
      value = def.default;
    }

    // Type coercion and validation
    value = coerceParameter(paramName, value, def);

    values.push(value);
    return "?";
  });

  return { sql: substituted, values };
}

function coerceParameter(name: string, value: unknown, def: CustomToolParameter): unknown {
  switch (def.type) {
    case "string":
      return String(value);

    case "number": {
      const num = Number(value);
      if (isNaN(num)) {
        throw new OmnibaseError(
          `Parameter '${name}': value '${value}' is not a valid number (NaN)`,
          "INVALID_PARAMETER",
        );
      }
      return num;
    }

    case "boolean":
      if (typeof value === "string") {
        return value.toLowerCase() === "true";
      }
      return Boolean(value);

    case "enum":
      if (!def.values!.includes(String(value))) {
        throw new OmnibaseError(
          `Parameter '${name}': value '${value}' is not in allowed values: ${def.values!.join(", ")}`,
          "INVALID_PARAMETER",
        );
      }
      return String(value);

    default:
      return value;
  }
}

/**
 * Build a Zod schema from custom tool parameter definitions.
 */
export function buildZodSchema(
  parameters?: Record<string, CustomToolParameter>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (!parameters || Object.keys(parameters).length === 0) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, param] of Object.entries(parameters)) {
    let schema: z.ZodTypeAny;

    switch (param.type) {
      case "string":
        schema = z.string().describe(param.description);
        break;
      case "number":
        schema = z.number().describe(param.description);
        break;
      case "boolean":
        schema = z.boolean().describe(param.description);
        break;
      case "enum":
        schema = z.enum(param.values! as [string, ...string[]]).describe(param.description);
        break;
      default:
        schema = z.string().describe(param.description);
    }

    if (param.required === false) {
      schema = schema.optional();
    }

    shape[name] = schema;
  }

  return z.object(shape);
}

/**
 * Register all validated custom tools on the MCP server.
 * Returns a map of tool names to their registered handles (for hot reload removal).
 */
export function registerCustomTools(
  server: McpServer,
  config: OmnibaseConfig,
  cm: ConnectionManager,
  auditLogger?: AuditLogger,
): Map<string, { remove: () => void }> {
  const handles = new Map<string, { remove: () => void }>();
  if (!config.tools) return handles;

  for (const [name, tool] of Object.entries(config.tools)) {
    const schema = buildZodSchema(tool.parameters);
    const mcpName = `custom_${name}`;

    const handle = server.tool(
      mcpName,
      tool.description ?? "",
      schema.shape,
      async (args: Record<string, unknown>) => {
        try {
          const result = await executeCustomTool(config, cm, name, tool, args, auditLogger);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
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
      },
    );

    handles.set(mcpName, handle);
  }

  return handles;
}

/**
 * Reload custom tools: remove all previously registered custom tools,
 * then register tools from the new config.
 */
export function reloadCustomTools(
  server: McpServer,
  config: OmnibaseConfig,
  cm: ConnectionManager,
  previousHandles: Map<string, { remove: () => void }>,
  auditLogger?: AuditLogger,
): Map<string, { remove: () => void }> {
  // Remove all previously registered custom tools
  for (const [, handle] of previousHandles) {
    handle.remove();
  }

  // Register new tools from updated config
  return registerCustomTools(server, config, cm, auditLogger);
}

/**
 * Execute multi-step custom tool within a transaction.
 */
async function executeCustomToolSteps(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  toolName: string,
  tool: CustomToolConfig,
  args: Record<string, unknown>,
  auditLogger?: AuditLogger,
) {
  const connConfig = getConnection(config, tool.connection);
  const paramDefs = tool.parameters ?? {};
  const effectivePermission = tool.permission ?? connConfig.permission;

  // Pre-validate all steps: substitute params, security check, classify
  const categoryRank: Record<string, number> = { read: 0, write: 1, ddl: 2 };
  let maxCategory: "read" | "write" | "ddl" = "read";
  const substituted: { sql: string; values: unknown[] }[] = [];

  for (const step of tool.steps!) {
    const { sql, values } = substituteParameters(step.sql, args, paramDefs);
    checkSqlSecurity(sql, connConfig);
    const category = classifyQuery(sql);
    if (categoryRank[category]! > categoryRank[maxCategory]!) {
      maxCategory = category;
    }
    substituted.push({ sql, values });
  }

  enforcePermission(connConfig.name, effectivePermission, maxCategory);

  const execOpts = {
    maxRows: tool.maxRows ?? connConfig.maxRows,
    timeoutMs: tool.timeout ?? connConfig.timeout,
  };

  const startMs = Date.now();

  // Acquire a per-connection lock to prevent concurrent transactions.
  // Most databases (especially SQLite) don't support nested transactions,
  // so concurrent multi-step tool calls on the same connection must be serialized.
  const releaseLock = await cm.acquireTransactionLock(connConfig.name);

  await cm.execute(connConfig, "BEGIN", [], execOpts);

  let returnResult: QueryResult | null = null;
  let lastResult: QueryResult | null = null;

  // Track temp tables created during execution for cleanup.
  // Temp tables are connection-scoped (not transaction-scoped) in most databases,
  // so without cleanup, re-running the same tool would fail with "table already exists".
  const tempTablesCreated: string[] = [];

  try {
    for (let i = 0; i < tool.steps!.length; i++) {
      const { sql, values } = substituted[i]!;
      const stepResult = await cm.execute(connConfig, sql, values, execOpts);
      lastResult = stepResult;
      if (tool.steps![i]!.return === true) {
        returnResult = stepResult;
      }
      const category = classifyQuery(sql);
      if (category === "ddl" || category === "write") {
        cm.invalidateSchemaCache(connConfig.name);
      }
      // Track temp tables for cleanup
      const tempMatch = sql.match(
        /CREATE\s+TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i,
      );
      if (tempMatch) {
        tempTablesCreated.push(tempMatch[1]!);
      }
    }
    await cm.execute(connConfig, "COMMIT", [], execOpts);
  } catch (err) {
    try {
      await cm.execute(connConfig, "ROLLBACK", [], execOpts);
    } catch {
      // Ignore rollback errors
    }
    void auditLogger?.log({
      tool: `custom_${toolName}`,
      connection: connConfig.name,
      sql: tool.steps!.map((s) => s.sql).join("; "),
      params: [],
      durationMs: Date.now() - startMs,
      rows: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // Clean up temp tables so the tool is idempotent across invocations
    for (const table of tempTablesCreated) {
      try {
        await cm.execute(connConfig, `DROP TABLE IF EXISTS ${table}`, [], execOpts);
      } catch {
        // Best effort cleanup
      }
    }
    releaseLock();
  }

  const result = returnResult ?? lastResult!;
  void auditLogger?.log({
    tool: `custom_${toolName}`,
    connection: connConfig.name,
    sql: tool.steps!.map((s) => s.sql).join("; "),
    params: [],
    durationMs: Date.now() - startMs,
    rows: result.rowCount,
    status: "ok",
  });
  return formatQueryResult(result, tool.maxRows ?? connConfig.maxRows, connConfig.maxValueLength);
}

/**
 * Execute a custom tool: substitute parameters, run through security pipeline, execute.
 */
export async function executeCustomTool(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  _toolName: string,
  tool: CustomToolConfig,
  args: Record<string, unknown>,
  auditLogger?: AuditLogger,
) {
  if (tool.compose != null && tool.compose.length > 0) {
    return executeComposedTool(config, cm, _toolName, tool, args, auditLogger);
  }

  if (tool.steps != null) {
    return executeCustomToolSteps(config, cm, _toolName, tool, args, auditLogger);
  }

  const connConfig = getConnection(config, tool.connection);

  // Substitute parameters into SQL template
  const paramDefs = tool.parameters ?? {};
  const { sql, values } = substituteParameters(tool.sql!, args, paramDefs);

  // Security checks: reuse the same pipeline as execute_sql
  if (isMultiStatement(sql)) {
    throw new OmnibaseError(
      "Custom tool SQL template contains multiple statements",
      "MULTI_STATEMENT",
    );
  }

  checkSqlSecurity(sql, connConfig);

  const category = classifyQuery(sql);

  // Use tool-level permission override, or fall back to connection permission
  const effectivePermission = tool.permission ?? connConfig.permission;
  enforcePermission(connConfig.name, effectivePermission, category);

  // Invalidate schema cache on writes
  if (category === "ddl" || category === "write") {
    cm.invalidateSchemaCache(connConfig.name);
  }

  // Execute with tool-level overrides
  const startMs = Date.now();
  let result;
  try {
    result = await cm.execute(connConfig, sql, values, {
      maxRows: tool.maxRows ?? connConfig.maxRows,
      timeoutMs: tool.timeout ?? connConfig.timeout,
    });
  } catch (err) {
    void auditLogger?.log({
      tool: `custom_${_toolName}`,
      connection: connConfig.name,
      sql,
      params: values,
      durationMs: Date.now() - startMs,
      rows: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  void auditLogger?.log({
    tool: `custom_${_toolName}`,
    connection: connConfig.name,
    sql,
    params: values,
    durationMs: Date.now() - startMs,
    rows: result.rowCount,
    status: "ok",
  });

  return formatQueryResult(result, tool.maxRows ?? connConfig.maxRows, connConfig.maxValueLength);
}

/**
 * Execute a custom tool and return the raw QueryResult (not formatted).
 * Used internally by compose pipelines to feed results into later steps.
 */
async function executeRawCustomTool(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  toolName: string,
  tool: CustomToolConfig,
  args: Record<string, unknown>,
  auditLogger?: AuditLogger,
): Promise<QueryResult> {
  if (tool.compose != null && tool.compose.length > 0) {
    return executeComposedToolRaw(config, cm, toolName, tool, args, auditLogger);
  }

  if (tool.steps != null) {
    // For steps tools, execute and get the raw result
    const connConfig = getConnection(config, tool.connection);
    const paramDefs = tool.parameters ?? {};
    const effectivePermission = tool.permission ?? connConfig.permission;

    const categoryRank: Record<string, number> = { read: 0, write: 1, ddl: 2 };
    let maxCategory: "read" | "write" | "ddl" = "read";
    const substituted: { sql: string; values: unknown[] }[] = [];

    for (const step of tool.steps!) {
      const { sql, values } = substituteParameters(step.sql, args, paramDefs);
      checkSqlSecurity(sql, connConfig);
      const category = classifyQuery(sql);
      if (categoryRank[category]! > categoryRank[maxCategory]!) {
        maxCategory = category;
      }
      substituted.push({ sql, values });
    }

    enforcePermission(connConfig.name, effectivePermission, maxCategory);

    const execOpts = {
      maxRows: tool.maxRows ?? connConfig.maxRows,
      timeoutMs: tool.timeout ?? connConfig.timeout,
    };

    const releaseLock = await cm.acquireTransactionLock(connConfig.name);
    await cm.execute(connConfig, "BEGIN", [], execOpts);

    let returnResult: QueryResult | null = null;
    let lastResult: QueryResult | null = null;

    try {
      for (let i = 0; i < tool.steps!.length; i++) {
        const { sql, values } = substituted[i]!;
        const stepResult = await cm.execute(connConfig, sql, values, execOpts);
        lastResult = stepResult;
        if (tool.steps![i]!.return === true) {
          returnResult = stepResult;
        }
      }
      await cm.execute(connConfig, "COMMIT", [], execOpts);
    } catch (err) {
      try {
        await cm.execute(connConfig, "ROLLBACK", [], execOpts);
      } catch {
        // Ignore rollback errors
      }
      throw err;
    } finally {
      releaseLock();
    }

    return returnResult ?? lastResult!;
  }

  // Single SQL tool
  const connConfig = getConnection(config, tool.connection);
  const paramDefs = tool.parameters ?? {};
  const { sql, values } = substituteParameters(tool.sql!, args, paramDefs);

  if (isMultiStatement(sql)) {
    throw new OmnibaseError(
      "Custom tool SQL template contains multiple statements",
      "MULTI_STATEMENT",
    );
  }

  checkSqlSecurity(sql, connConfig);
  const category = classifyQuery(sql);
  const effectivePermission = tool.permission ?? connConfig.permission;
  enforcePermission(connConfig.name, effectivePermission, category);

  if (category === "ddl" || category === "write") {
    cm.invalidateSchemaCache(connConfig.name);
  }

  return cm.execute(connConfig, sql, values, {
    maxRows: tool.maxRows ?? connConfig.maxRows,
    timeoutMs: tool.timeout ?? connConfig.timeout,
  });
}

/**
 * Execute a composed tool pipeline and return formatted result.
 */
async function executeComposedTool(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  toolName: string,
  tool: CustomToolConfig,
  args: Record<string, unknown>,
  auditLogger?: AuditLogger,
) {
  const startMs = Date.now();
  const connConfig = getConnection(config, tool.connection);

  try {
    const result = await executeComposedToolRaw(config, cm, toolName, tool, args, auditLogger);

    const sqlSummary = tool.compose!.map((s) => (s.tool ? `[tool:${s.tool}]` : s.sql)).join("; ");
    void auditLogger?.log({
      tool: `custom_${toolName}`,
      connection: connConfig.name,
      sql: sqlSummary,
      params: [],
      durationMs: Date.now() - startMs,
      rows: result.rowCount,
      status: "ok",
    });

    return formatQueryResult(result, tool.maxRows ?? connConfig.maxRows, connConfig.maxValueLength);
  } catch (err) {
    const sqlSummary = tool.compose!.map((s) => (s.tool ? `[tool:${s.tool}]` : s.sql)).join("; ");
    void auditLogger?.log({
      tool: `custom_${toolName}`,
      connection: connConfig.name,
      sql: sqlSummary,
      params: [],
      durationMs: Date.now() - startMs,
      rows: 0,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Execute a composed tool pipeline and return raw QueryResult.
 * Used for nested composition.
 */
async function executeComposedToolRaw(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  _toolName: string,
  tool: CustomToolConfig,
  args: Record<string, unknown>,
  auditLogger?: AuditLogger,
): Promise<QueryResult> {
  const connConfig = getConnection(config, tool.connection);
  const context = new Map<string, QueryResult>();
  let lastResult: QueryResult | null = null;

  for (const step of tool.compose!) {
    let result: QueryResult;

    if (step.tool) {
      // Tool reference step: resolve the referenced tool and execute it
      const refTool = config.tools![step.tool]!;
      const stepArgs: Record<string, unknown> = {};

      // Merge compose step args with the outer tool's args
      if (step.args) {
        for (const [key, value] of Object.entries(step.args)) {
          // If the value is a string like "{param}", resolve from outer args
          if (typeof value === "string" && /^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(value)) {
            const paramName = value.slice(1, -1);
            stepArgs[key] = args[paramName];
          } else {
            stepArgs[key] = value;
          }
        }
      }

      result = await executeRawCustomTool(config, cm, step.tool, refTool, stepArgs, auditLogger);
    } else {
      // Inline SQL step: expand compose references, run through security pipeline
      let sql = expandComposeReferences(step.sql!, context);

      // Also substitute {param} placeholders from outer args
      const paramDefs = tool.parameters ?? {};
      const substituted = substituteParameters(sql, args, paramDefs);
      sql = substituted.sql;

      if (isMultiStatement(sql)) {
        throw new OmnibaseError(
          `Compose step '${step.as}': SQL contains multiple statements`,
          "MULTI_STATEMENT",
        );
      }

      checkSqlSecurity(sql, connConfig);
      const category = classifyQuery(sql);
      const effectivePermission = tool.permission ?? connConfig.permission;
      enforcePermission(connConfig.name, effectivePermission, category);

      if (category === "ddl" || category === "write") {
        cm.invalidateSchemaCache(connConfig.name);
      }

      result = await cm.execute(connConfig, sql, substituted.values, {
        maxRows: tool.maxRows ?? connConfig.maxRows,
        timeoutMs: tool.timeout ?? connConfig.timeout,
      });
    }

    context.set(step.as, result);
    lastResult = result;
  }

  return lastResult!;
}

/**
 * Export for testing: execute a custom tool directly.
 */
export async function executeCustomToolForTest(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  toolName: string,
  tool: CustomToolConfig,
  args: Record<string, unknown>,
) {
  return executeCustomTool(config, cm, toolName, tool, args);
}
