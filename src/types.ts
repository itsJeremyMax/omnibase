// --- Config types ---
// Note: YAML config uses snake_case (max_rows, schema_filter).
// The config loader (Task 10) maps these to camelCase TypeScript fields.

export type PermissionLevel = "read-only" | "read-write" | "admin";

export interface ConnectionConfig {
  name: string; // Populated by config loader from the Record key, not from YAML
  dsn: string;
  permission: PermissionLevel;
  timeout: number;
  maxRows: number;
  schemaFilter?: {
    schemas?: string[];
    tables?: string[];
  };
  allowAllPragmas?: boolean;
  maxValueLength?: number;
  readOnlyTables?: string[];
}

export interface OmnibaseConfig {
  connections: Record<string, ConnectionConfig>;
  defaults: {
    permission: PermissionLevel;
    timeout: number;
    maxRows: number;
  };
}

// --- Connection state ---

export type ConnectionStatus = "available" | "connected" | "error";

export interface ConnectionInfo {
  name: string;
  databaseType: string;
  permissionLevel: PermissionLevel;
  status: ConnectionStatus;
}

// --- Schema types ---

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  rowCountEstimate: number;
  comment: string | null;
}

export interface TableSummary {
  name: string;
  schema: string;
  columnCount: number;
  primaryKey: string[];
  rowCountEstimate: number;
}

export interface SchemaInfo {
  tables: TableInfo[];
}

// --- Query result types ---

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  hasMore: boolean;
  affectedRows?: number;
  lastInsertId?: number;
}

export interface FormattedQueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  truncated_from?: number;
  affected_rows?: number;
  last_insert_id?: number;
}

// --- Query classification ---

export type QueryCategory = "read" | "write" | "ddl";

// --- Sidecar JSON-RPC types ---
// Note: error.code uses application-level string codes (e.g., "PERMISSION_DENIED"),
// not standard JSON-RPC 2.0 numeric codes. This is intentional — our protocol
// is JSON-RPC-shaped but uses string codes for richer error classification.

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
}

// --- DatabaseBackend interface ---

export interface ExecuteOptions {
  maxRows?: number;
  timeoutMs?: number;
}

export interface SchemaFilter {
  schemas?: string[];
  tables?: string[];
}

export interface DatabaseBackend {
  connect(id: string, dsn: string): Promise<void>;
  execute(
    id: string,
    query: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult>;
  getSchema(id: string, filter?: SchemaFilter): Promise<SchemaInfo>;
  explainQuery(id: string, query: string): Promise<QueryResult>;
  validateQuery(id: string, query: string): Promise<{ valid: boolean; error?: string }>;
  ping(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
}

// --- Error types ---

export class OmnibaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "OmnibaseError";
  }
}

export class PermissionError extends OmnibaseError {
  constructor(
    connectionName: string,
    permissionLevel: PermissionLevel,
    queryCategory: QueryCategory,
  ) {
    super(
      `Connection '${connectionName}' is ${permissionLevel}, ${queryCategory} queries are not allowed`,
      "PERMISSION_DENIED",
    );
    this.name = "PermissionError";
  }
}

export class ConnectionError extends OmnibaseError {
  constructor(connectionName: string, detail: string) {
    super(`Connection '${connectionName}' failed: ${detail}`, "CONNECTION_ERROR", detail);
    this.name = "ConnectionError";
  }
}
