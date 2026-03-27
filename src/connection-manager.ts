import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseBackend,
  QueryResult,
  SchemaInfo,
  ExecuteOptions,
} from "./types.js";

export class ConnectionManager {
  private connectedIds = new Set<string>();
  private schemaCache = new Map<string, SchemaInfo>();
  private statusMap = new Map<string, ConnectionStatus>();

  constructor(private backend: DatabaseBackend) {}

  async ensureConnected(config: ConnectionConfig): Promise<void> {
    if (this.connectedIds.has(config.name)) return;

    try {
      await this.backend.connect(config.name, config.dsn);
      this.connectedIds.add(config.name);
      this.statusMap.set(config.name, "connected");
    } catch (err) {
      this.statusMap.set(config.name, "error");
      throw err;
    }
  }

  async execute(
    config: ConnectionConfig,
    query: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    await this.ensureConnected(config);
    return this.backend.execute(config.name, query, params, {
      maxRows: options?.maxRows ?? config.maxRows,
      timeoutMs: options?.timeoutMs ?? config.timeout,
    });
  }

  async getSchema(config: ConnectionConfig, forceRefresh = false): Promise<SchemaInfo> {
    await this.ensureConnected(config);

    if (!forceRefresh && this.schemaCache.has(config.name)) {
      return this.schemaCache.get(config.name)!;
    }

    const schema = await this.backend.getSchema(
      config.name,
      config.schemaFilter
        ? {
            schemas: config.schemaFilter.schemas,
            tables: config.schemaFilter.tables,
          }
        : undefined,
    );

    this.schemaCache.set(config.name, schema);
    return schema;
  }

  async explainQuery(config: ConnectionConfig, query: string): Promise<QueryResult> {
    await this.ensureConnected(config);
    return this.backend.explainQuery(config.name, query);
  }

  async validateQuery(
    config: ConnectionConfig,
    query: string,
  ): Promise<{ valid: boolean; error?: string }> {
    await this.ensureConnected(config);
    return this.backend.validateQuery(config.name, query);
  }

  invalidateSchemaCache(connectionName: string): void {
    this.schemaCache.delete(connectionName);
  }

  getStatus(connectionName: string): ConnectionStatus {
    return this.statusMap.get(connectionName) ?? "available";
  }

  async ping(config: ConnectionConfig): Promise<void> {
    await this.ensureConnected(config);
    await this.backend.ping(config.name);
  }

  async disconnect(config: ConnectionConfig): Promise<void> {
    await this.backend.disconnect(config.name);
    this.connectedIds.delete(config.name);
    this.schemaCache.delete(config.name);
    this.statusMap.set(config.name, "available");
  }

  // Called by SidecarClient when the sidecar process crashes.
  // Clears connection state so ensureConnected will re-establish on next use.
  // Schema cache is preserved (it lives here, not in the sidecar).
  handleSidecarCrash(): void {
    this.connectedIds.clear();
    for (const [name] of this.statusMap) {
      this.statusMap.set(name, "available");
    }
  }

  async disconnectAll(configs: ConnectionConfig[]): Promise<void> {
    for (const config of configs) {
      if (this.connectedIds.has(config.name)) {
        try {
          await this.disconnect(config);
        } catch {
          // Best effort on shutdown
        }
      }
    }
  }

  // Note: periodic heartbeat (ping) is not implemented in v0.1.
  // The sidecar handles connection-level reconnection internally via Go's
  // database/sql pool. Heartbeat can be added as an interval timer here
  // if stale connections become a problem in practice.
}
