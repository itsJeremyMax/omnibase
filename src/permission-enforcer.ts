import { PermissionLevel, QueryCategory, PermissionError } from "./types.js";

const PERMISSION_HIERARCHY: Record<PermissionLevel, Set<QueryCategory>> = {
  "read-only": new Set(["read"]),
  "read-write": new Set(["read", "write"]),
  admin: new Set(["read", "write", "ddl"]),
};

export function enforcePermission(
  connectionName: string,
  permissionLevel: PermissionLevel,
  queryCategory: QueryCategory,
): void {
  const allowed = PERMISSION_HIERARCHY[permissionLevel];
  if (!allowed.has(queryCategory)) {
    throw new PermissionError(connectionName, permissionLevel, queryCategory);
  }
}
