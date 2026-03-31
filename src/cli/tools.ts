import pc from "picocolors";
import Table from "cli-table3";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { resolveConfigPath, loadConfig, getConnection } from "../config.js";
import { extractPlaceholders, validateCustomTools, substituteParameters } from "../custom-tools.js";
import { SidecarClient } from "../sidecar-client.js";
import { ConnectionManager } from "../connection-manager.js";
import type { QueryResult } from "../types.js";

function getConfigPath(): string {
  const configPath = resolveConfigPath(process.cwd());
  if (!configPath) {
    console.error(
      pc.red("No omnibase.config.yaml found. Run `npx omnibase-mcp@latest init` to create one."),
    );
    process.exit(1);
  }
  return configPath;
}

function readRawConfig(configPath: string): Record<string, unknown> {
  const content = readFileSync(configPath, "utf-8");
  return parseYaml(content) as Record<string, unknown>;
}

async function list(): Promise<void> {
  const configPath = getConfigPath();
  const config = loadConfig(configPath);

  if (!config.tools || Object.keys(config.tools).length === 0) {
    console.log(pc.dim("No custom tools defined."));
    console.log(pc.dim("Add one with: omnibase tools add"));
    return;
  }

  const table = new Table({
    head: [pc.bold("Name"), pc.bold("Connection"), pc.bold("Permission"), pc.bold("Parameters")],
  });

  for (const [name, tool] of Object.entries(config.tools)) {
    const params = tool.parameters ? Object.keys(tool.parameters).join(", ") : pc.dim("none");
    const permission = tool.permission ?? pc.dim("(inherited)");
    table.push([`custom_${name}`, tool.connection, permission, params]);
  }

  console.log(table.toString());
}

async function add(): Promise<void> {
  const p = await import("@clack/prompts");
  const configPath = getConfigPath();
  const config = loadConfig(configPath);
  const connectionNames = Object.keys(config.connections);

  if (connectionNames.length === 0) {
    console.error(pc.red("No connections configured. Add a connection first."));
    process.exit(1);
  }

  p.intro(pc.bold("Add Custom Tool"));

  const name = await p.text({
    message: "Tool name",
    placeholder: "get_active_users",
    validate: (value) => {
      if (!value || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
        return "Must be alphanumeric and underscores only, starting with a letter";
      }
      const builtIns = new Set([
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
      if (builtIns.has(value)) {
        return "Name collides with a built-in tool";
      }
      if (config.tools?.[value]) {
        return "A custom tool with this name already exists";
      }
    },
  });
  if (p.isCancel(name)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const connection = await p.select({
    message: "Which connection?",
    options: connectionNames.map((n) => ({ value: n, label: n })),
  });
  if (p.isCancel(connection)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const description = await p.text({
    message: "Description",
    placeholder: "What does this tool do?",
    validate: (value) => {
      if (!value || !value.trim()) return "Description is required";
    },
  });
  if (p.isCancel(description)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let sql: string;
  const sqlFileArg = process.argv.find((a) => a.startsWith("--sql-file="));
  if (sqlFileArg) {
    const filePath = sqlFileArg.split("=")[1];
    sql = readFileSync(filePath, "utf-8").trim();
    p.log.info(`SQL loaded from ${filePath}`);
  } else {
    const sqlInput = await p.text({
      message: "SQL template (use {param_name} for parameters)",
      placeholder: "SELECT * FROM users WHERE active = {is_active}",
      validate: (value) => {
        if (!value || !value.trim()) return "SQL is required";
      },
    });
    if (p.isCancel(sqlInput)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    sql = sqlInput as string;
  }

  const placeholders = extractPlaceholders(sql);
  const parameters: Record<
    string,
    { type: string; description: string; required?: boolean; default?: unknown; values?: string[] }
  > = {};

  if (placeholders.length > 0) {
    p.log.info(`Detected parameters: ${placeholders.join(", ")}`);

    for (const paramName of placeholders) {
      const paramType = await p.select({
        message: `Type for '${paramName}'?`,
        options: [
          { value: "string", label: "string" },
          { value: "number", label: "number" },
          { value: "boolean", label: "boolean" },
          { value: "enum", label: "enum" },
        ],
      });
      if (p.isCancel(paramType)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      const paramDesc = await p.text({
        message: `Description for '${paramName}'?`,
        validate: (v) => {
          if (!v || !v.trim()) return "Required";
        },
      });
      if (p.isCancel(paramDesc)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      const param: Record<string, unknown> = {
        type: paramType,
        description: paramDesc,
      };

      if (paramType === "enum") {
        const valuesInput = await p.text({
          message: `Allowed values for '${paramName}' (comma-separated)?`,
          placeholder: "pending, shipped, delivered",
          validate: (v) => {
            if (!v || !v.trim()) return "At least one value required";
          },
        });
        if (p.isCancel(valuesInput)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        param.values = (valuesInput as string).split(",").map((v: string) => v.trim());
      }

      const isRequired = await p.confirm({
        message: `Is '${paramName}' required?`,
        initialValue: true,
      });
      if (p.isCancel(isRequired)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      if (!isRequired) {
        const defaultVal = await p.text({
          message: `Default value for '${paramName}'?`,
        });
        if (p.isCancel(defaultVal)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        param.required = false;
        param.default = paramType === "number" ? Number(defaultVal) : defaultVal;
      }

      parameters[paramName] = param as { type: string; description: string };
    }
  }

  const wantOverrides = await p.confirm({
    message: "Override permission, max_rows, or timeout?",
    initialValue: false,
  });
  if (p.isCancel(wantOverrides)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let permission: string | undefined;
  let maxRows: number | undefined;
  let timeout: number | undefined;

  if (wantOverrides) {
    const permInput = await p.select({
      message: "Permission level?",
      options: [
        { value: "inherit", label: "Inherit from connection" },
        { value: "read-only", label: "read-only" },
        { value: "read-write", label: "read-write" },
        { value: "admin", label: "admin" },
      ],
    });
    if (p.isCancel(permInput)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    if (permInput !== "inherit") permission = permInput as string;

    const maxRowsInput = await p.text({
      message: "Max rows? (leave empty for default)",
      placeholder: "",
    });
    if (p.isCancel(maxRowsInput)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    if (maxRowsInput && (maxRowsInput as string).trim()) maxRows = Number(maxRowsInput);

    const timeoutInput = await p.text({
      message: "Timeout in ms? (leave empty for default)",
      placeholder: "",
    });
    if (p.isCancel(timeoutInput)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    if (timeoutInput && (timeoutInput as string).trim()) timeout = Number(timeoutInput);
  }

  const toolEntry: Record<string, unknown> = {
    connection,
    description,
    sql,
  };
  if (permission) toolEntry.permission = permission;
  if (maxRows) toolEntry.max_rows = maxRows;
  if (timeout) toolEntry.timeout = timeout;
  if (Object.keys(parameters).length > 0) toolEntry.parameters = parameters;

  p.log.info("Generated config:");
  const preview: Record<string, unknown> = {};
  preview[name as string] = toolEntry;
  console.log(stringifyYaml({ tools: preview }, { indent: 2 }));

  const confirmed = await p.confirm({
    message: "Add this tool to your config?",
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const rawConfig = readRawConfig(configPath);
  if (!rawConfig.tools) rawConfig.tools = {};
  (rawConfig.tools as Record<string, unknown>)[name as string] = toolEntry;
  writeFileSync(configPath, stringifyYaml(rawConfig, { indent: 2 }));

  p.outro(
    pc.green(
      `Tool "${name as string}" added! It will be available as "custom_${name as string}" on next server reload.`,
    ),
  );
}

async function remove(): Promise<void> {
  const p = await import("@clack/prompts");
  const configPath = getConfigPath();
  const config = loadConfig(configPath);

  if (!config.tools || Object.keys(config.tools).length === 0) {
    console.log(pc.dim("No custom tools to remove."));
    return;
  }

  p.intro(pc.bold("Remove Custom Tool"));

  const toolNames = Object.keys(config.tools);
  const selected = await p.select({
    message: "Which tool to remove?",
    options: toolNames.map((name) => ({
      value: name,
      label: `custom_${name}`,
      hint: config.tools![name].description,
    })),
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const tool = config.tools[selected as string];
  p.log.info(`Connection: ${tool.connection}`);
  p.log.info(`SQL: ${tool.sql ?? `${tool.steps?.length ?? 0} steps`}`);
  if (tool.parameters) {
    p.log.info(`Parameters: ${Object.keys(tool.parameters).join(", ")}`);
  }

  const confirmed = await p.confirm({
    message: `Remove "custom_${selected as string}"?`,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const rawConfig = readRawConfig(configPath);
  if (rawConfig.tools && typeof rawConfig.tools === "object") {
    delete (rawConfig.tools as Record<string, unknown>)[selected as string];
    if (Object.keys(rawConfig.tools as object).length === 0) {
      delete rawConfig.tools;
    }
  }
  writeFileSync(configPath, stringifyYaml(rawConfig, { indent: 2 }));

  p.outro(pc.green(`Tool "${selected as string}" removed.`));
}

async function validate(): Promise<void> {
  const configPath = getConfigPath();
  const config = loadConfig(configPath);

  if (!config.tools || Object.keys(config.tools).length === 0) {
    console.log(pc.dim("No custom tools defined. Nothing to validate."));
    return;
  }

  try {
    validateCustomTools(config);
    const count = Object.keys(config.tools).length;
    console.log(pc.green(`All ${count} custom tool(s) are valid.`));
  } catch (err) {
    console.error(pc.red(`Validation failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

function parseFlagsFromArgv(): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of process.argv.slice(5)) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return flags;
}

function formatResultTable(result: QueryResult): string {
  if (result.columns.length === 0) return pc.dim("(no columns returned)");
  const table = new Table({
    head: result.columns.map((c) => pc.bold(c)),
    wordWrap: true,
  });
  for (const row of result.rows) {
    table.push(
      row.map((cell) => {
        if (cell === null || cell === undefined) return pc.dim("NULL");
        const s = String(cell);
        return s.length > 120 ? s.slice(0, 120) + pc.dim("...") : s;
      }),
    );
  }
  return table.toString();
}

async function test(): Promise<void> {
  const p = await import("@clack/prompts");
  const configPath = getConfigPath();
  const config = loadConfig(configPath);

  try {
    validateCustomTools(config);
  } catch (err) {
    console.error(
      pc.red(`Config validation failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }

  if (!config.tools || Object.keys(config.tools).length === 0) {
    console.log(pc.dim("No custom tools defined."));
    process.exit(0);
  }

  let toolName = process.argv[4] as string | undefined;

  if (!toolName) {
    p.intro(pc.bold("Test Custom Tool"));
    const selected = await p.select({
      message: "Which tool to test?",
      options: Object.entries(config.tools).map(([name, tool]) => ({
        value: name,
        label: `custom_${name}`,
        hint: tool.description,
      })),
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    toolName = selected as string;
  } else {
    p.intro(pc.bold(`Test: custom_${toolName.replace(/^custom_/, "")}`));
  }

  if (toolName.startsWith("custom_")) toolName = toolName.slice(7);

  const tool = config.tools[toolName];
  if (!tool) {
    console.error(
      pc.red(
        `Tool "${toolName}" not found. Run \`npx omnibase-mcp tools list\` to see available tools.`,
      ),
    );
    process.exit(1);
  }

  const paramDefs = tool.parameters ?? {};
  const paramNames = Object.keys(paramDefs);
  const cliFlags = parseFlagsFromArgv();
  const args: Record<string, unknown> = {};

  for (const paramName of paramNames) {
    const def = paramDefs[paramName];
    if (cliFlags[paramName] !== undefined) {
      args[paramName] = cliFlags[paramName];
    } else if (def.required === false && def.default !== undefined) {
      const override = await p.text({
        message: `${paramName} (optional, default: ${String(def.default)})`,
        placeholder: String(def.default),
      });
      if (p.isCancel(override)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      args[paramName] = (override as string).trim() || def.default;
    } else if (def.type === "enum" && def.values) {
      const selected = await p.select({
        message: `${paramName} — ${def.description}`,
        options: def.values.map((v) => ({ value: v, label: v })),
      });
      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      args[paramName] = selected;
    } else if (def.type === "boolean") {
      const val = await p.confirm({
        message: `${paramName} — ${def.description}`,
        initialValue: true,
      });
      if (p.isCancel(val)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      args[paramName] = val;
    } else {
      const val = await p.text({
        message: `${paramName} — ${def.description}`,
        validate: (v) => {
          if (!v || !v.trim()) return "Value is required";
        },
      });
      if (p.isCancel(val)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      args[paramName] = val;
    }
  }

  let substituted: { sql: string; values: unknown[] };
  try {
    substituted = substituteParameters(tool.sql!, args, paramDefs);
  } catch (err) {
    console.error(pc.red(`Parameter error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  p.log.info(`Connection: ${pc.cyan(tool.connection)}`);
  p.log.info(`SQL template:\n${pc.dim(tool.sql!.trim())}`);
  if (substituted.values.length > 0) {
    p.log.info(
      `Parameters: ${substituted.values.map((v, i) => `$${i + 1} = ${pc.cyan(String(v))}`).join(", ")}`,
    );
  }

  const sidecarPath =
    process.env.OMNIBASE_SIDECAR_PATH ||
    resolve(__dirname, "..", "..", "..", "sidecar", "bin", "omnibase-sidecar");

  const sidecar = new SidecarClient(sidecarPath);
  const spinner = p.spinner();
  spinner.start("Connecting to database...");

  try {
    await sidecar.start();
  } catch (err) {
    spinner.stop("Failed to start sidecar");
    console.error(pc.red(`Sidecar error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const cm = new ConnectionManager(sidecar);
  const connConfig = getConnection(config, tool.connection);

  spinner.message("Executing query...");

  let result: QueryResult;
  const startMs = Date.now();

  try {
    result = await cm.execute(connConfig, substituted.sql, substituted.values, {
      maxRows: tool.maxRows ?? connConfig.maxRows,
      timeoutMs: tool.timeout ?? connConfig.timeout,
    });
  } catch (err) {
    spinner.stop("Query failed");
    console.error(pc.red(`Query error: ${err instanceof Error ? err.message : String(err)}`));
    await sidecar.stop();
    process.exit(1);
  }

  const elapsedMs = Date.now() - startMs;
  spinner.stop("Done");

  if (result.rows.length === 0) {
    console.log(pc.dim("(no rows returned)"));
  } else {
    console.log(formatResultTable(result));
  }

  const rowLabel = result.rowCount === 1 ? "row" : "rows";
  const truncatedNote = result.hasMore ? pc.yellow(" (truncated)") : "";
  console.log(
    `\n${pc.green(String(result.rowCount))} ${rowLabel} · ${pc.dim(`${elapsedMs}ms`)}${truncatedNote}`,
  );

  await sidecar.stop();
  p.outro(pc.green("Done."));
}

export const tools = { list, add, remove, validate, test };
