import { resolve } from "path";
import { SidecarClient } from "../sidecar-client.js";
import { ConnectionManager } from "../connection-manager.js";

export function resolveSidecarPath(): string {
  return (
    process.env.OMNIBASE_SIDECAR_PATH ||
    resolve(__dirname, "..", "..", "..", "sidecar", "omnibase-sidecar")
  );
}

export interface StartedSidecar {
  sidecar: SidecarClient;
  cm: ConnectionManager;
}

export async function startSidecar(): Promise<StartedSidecar> {
  const sidecar = new SidecarClient(resolveSidecarPath());
  await sidecar.start();
  const cm = new ConnectionManager(sidecar);
  return { sidecar, cm };
}
