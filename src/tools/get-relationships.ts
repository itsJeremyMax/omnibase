import type { OmnibaseConfig } from "../types.js";
import type { ConnectionManager } from "../connection-manager.js";
import { OmnibaseError } from "../types.js";
import { getConnection } from "../config.js";

interface Relationship {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

interface TableNode {
  name: string;
  references: string[];
  referenced_by: string[];
}

export async function handleGetRelationships(
  config: OmnibaseConfig,
  cm: ConnectionManager,
  args: { connection: string; table?: string },
) {
  const connConfig = getConnection(config, args.connection);

  const schema = await cm.getSchema(connConfig);

  // Validate table exists if specified
  if (args.table) {
    const tableExists = schema.tables.some(
      (t) => t.name.toLowerCase() === args.table!.toLowerCase(),
    );
    if (!tableExists) {
      throw new OmnibaseError(
        `Table '${args.table}' not found in connection '${args.connection}'`,
        "TABLE_NOT_FOUND",
      );
    }
  }

  // Build full relationship list from all foreign keys
  const relationships: Relationship[] = [];
  for (const table of schema.tables) {
    for (const fk of table.foreignKeys ?? []) {
      relationships.push({
        from_table: table.name,
        from_column: fk.column,
        to_table: fk.referencesTable,
        to_column: fk.referencesColumn,
      });
    }
  }

  // If a specific table is requested, filter to relationships involving that table
  const filtered = args.table
    ? relationships.filter(
        (r) =>
          r.from_table.toLowerCase() === args.table!.toLowerCase() ||
          r.to_table.toLowerCase() === args.table!.toLowerCase(),
      )
    : relationships;

  // Build a graph summary: for each table, what does it reference and what references it
  const nodeMap = new Map<string, TableNode>();

  const getNode = (name: string): TableNode => {
    if (!nodeMap.has(name)) {
      nodeMap.set(name, { name, references: [], referenced_by: [] });
    }
    return nodeMap.get(name)!;
  };

  for (const rel of filtered) {
    const from = getNode(rel.from_table);
    const to = getNode(rel.to_table);
    const label = `${rel.from_column} -> ${rel.to_table}.${rel.to_column}`;
    const reverseLabel = `${rel.from_table}.${rel.from_column} -> ${rel.to_column}`;
    if (!from.references.includes(label)) from.references.push(label);
    if (!to.referenced_by.includes(reverseLabel)) to.referenced_by.push(reverseLabel);
  }

  return {
    relationships: filtered,
    graph: Array.from(nodeMap.values()),
  };
}
