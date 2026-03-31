import { parse as parseYaml } from "yaml";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import {
  OmnibaseConfig,
  ConnectionConfig,
  PermissionLevel,
  OmnibaseError,
  CustomToolConfig,
  CustomToolStep,
  CustomToolParameterType,
  AuditConfig,
} from "./types.js";
import { extractSqlDescription } from "./custom-tools.js";

const VALID_PERMISSIONS: PermissionLevel[] = ["read-only", "read-write", "admin"];

interface RawConfig {
  connections: Record<
    string,
    {
      dsn?: string;
      permission?: string;
      timeout?: number;
      max_rows?: number;
      schema_filter?: {
        schemas?: string[];
        tables?: string[];
      };
      allow_all_pragmas?: boolean;
      max_value_length?: number;
      read_only_tables?: string[];
    }
  >;
  defaults?: {
    permission?: string;
    timeout?: number;
    max_rows?: number;
  };
  tools?: Record<
    string,
    {
      connection?: string;
      description?: string;
      sql?: string;
      steps?: Array<{ sql?: string; return?: boolean }>;
      permission?: string;
      max_rows?: number;
      timeout?: number;
      parameters?: Record<
        string,
        {
          type?: string;
          description?: string;
          required?: boolean;
          default?: unknown;
          values?: string[];
        }
      >;
    }
  >;
  audit?: {
    enabled?: boolean;
    path?: string;
    format?: string;
    max_entries?: number;
  };
  schema_hints?: boolean;
}

const DEFAULT_PERMISSION: PermissionLevel = "read-only";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_ROWS = 500;

export function parseConfig(yamlContent: string, configFilePath?: string): OmnibaseConfig {
  const raw = parseYaml(yamlContent) as RawConfig;

  const defaults = {
    permission: raw.defaults?.permission
      ? validatePermission(raw.defaults.permission)
      : DEFAULT_PERMISSION,
    timeout: raw.defaults?.timeout ?? DEFAULT_TIMEOUT,
    maxRows: raw.defaults?.max_rows ?? DEFAULT_MAX_ROWS,
  };

  const connections: Record<string, ConnectionConfig> = {};

  for (const [name, rawConn] of Object.entries(raw.connections || {})) {
    if (!rawConn.dsn) {
      throw new Error(`Connection '${name}' is missing 'dsn'`);
    }

    const dsn = resolveDsn(rawConn.dsn);
    const permission = rawConn.permission
      ? validatePermission(rawConn.permission)
      : defaults.permission;

    connections[name] = {
      name,
      dsn,
      permission,
      timeout: rawConn.timeout ?? defaults.timeout,
      maxRows: rawConn.max_rows ?? defaults.maxRows,
      schemaFilter: rawConn.schema_filter
        ? {
            schemas: rawConn.schema_filter.schemas,
            tables: rawConn.schema_filter.tables,
          }
        : undefined,
      allowAllPragmas: rawConn.allow_all_pragmas ?? false,
      maxValueLength: rawConn.max_value_length,
      readOnlyTables: rawConn.read_only_tables,
    };
  }

  // Parse custom tools
  let tools: Record<string, CustomToolConfig> | undefined;
  if (raw.tools && Object.keys(raw.tools).length > 0) {
    tools = {};
    for (const [name, rawTool] of Object.entries(raw.tools)) {
      const sqlDescription = rawTool.sql ? extractSqlDescription(rawTool.sql) : undefined;
      const tool: CustomToolConfig = {
        connection: rawTool.connection!,
        description: rawTool.description ?? sqlDescription,
        ...(rawTool.sql != null ? { sql: rawTool.sql } : {}),
        ...(rawTool.steps != null
          ? {
              steps: rawTool.steps.map(
                (s): CustomToolStep => ({
                  sql: s.sql!,
                  ...(s.return != null ? { return: s.return } : {}),
                }),
              ),
            }
          : {}),
      };

      if (rawTool.permission) {
        tool.permission = validatePermission(rawTool.permission);
      }
      if (rawTool.max_rows != null) {
        tool.maxRows = rawTool.max_rows;
      }
      if (rawTool.timeout != null) {
        tool.timeout = rawTool.timeout;
      }

      if (rawTool.parameters) {
        tool.parameters = {};
        for (const [paramName, rawParam] of Object.entries(rawTool.parameters)) {
          tool.parameters[paramName] = {
            type: rawParam.type as CustomToolParameterType,
            description: rawParam.description!,
            required: rawParam.required ?? true,
            ...(rawParam.default !== undefined ? { default: rawParam.default } : {}),
            ...(rawParam.values ? { values: rawParam.values } : {}),
          };
        }
      }

      tools[name] = tool;
    }
  }

  let audit: AuditConfig | undefined;
  if (raw.audit) {
    const configDir = configFilePath ? dirname(configFilePath) : process.cwd();
    audit = {
      enabled: raw.audit.enabled ?? false,
      path: raw.audit.path ?? join(configDir, ".omnibase", "audit.log"),
      format: (raw.audit.format === "text" ? "text" : "jsonl") as "jsonl" | "text",
      maxEntries: raw.audit.max_entries ?? 10000,
    };
  }

  return { connections, defaults, tools, audit, schemaHints: raw.schema_hints ?? true };
}

export function getConnection(config: OmnibaseConfig, name: string): ConnectionConfig {
  // Case-insensitive connection name lookup
  const conn =
    config.connections[name] ??
    Object.values(config.connections).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!conn) {
    throw new OmnibaseError(`Unknown connection: '${name}'`, "UNKNOWN_CONNECTION");
  }
  return conn;
}

export function loadConfig(configPath: string): OmnibaseConfig {
  const content = readFileSync(configPath, "utf-8");
  return parseConfig(content, configPath);
}

export function resolveConfigPath(cwd: string): string | null {
  // 1. OMNIBASE_CONFIG env var (highest priority)
  const envPath = process.env.OMNIBASE_CONFIG;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. Project-local
  const localPath = join(cwd, "omnibase.config.yaml");
  if (existsSync(localPath)) {
    return localPath;
  }

  // 3. User-global
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const globalPath = join(home, ".config", "omnibase", "config.yaml");
  if (existsSync(globalPath)) {
    return globalPath;
  }

  return null;
}

function resolveDsn(dsn: string): string {
  if (!dsn.startsWith("$")) {
    return dsn;
  }

  const envName = dsn.slice(1);
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Environment variable '${envName}' is not set (referenced in DSN)`);
  }
  return value;
}

function validatePermission(value: string): PermissionLevel {
  if (!VALID_PERMISSIONS.includes(value as PermissionLevel)) {
    throw new Error(
      `Invalid permission level '${value}'. Must be one of: ${VALID_PERMISSIONS.join(", ")}`,
    );
  }
  return value as PermissionLevel;
}
