import { parse as parseYaml } from "yaml";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { OmnibaseConfig, ConnectionConfig, PermissionLevel, OmnibaseError } from "./types.js";

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
  defaults: {
    permission: string;
    timeout: number;
    max_rows: number;
  };
}

export function parseConfig(yamlContent: string): OmnibaseConfig {
  const raw = parseYaml(yamlContent) as RawConfig;

  if (!raw.defaults) {
    throw new Error("Config must have a 'defaults' section");
  }

  const defaults = {
    permission: validatePermission(raw.defaults.permission),
    timeout: raw.defaults.timeout,
    maxRows: raw.defaults.max_rows,
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

  return { connections, defaults };
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
  return parseConfig(content);
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
