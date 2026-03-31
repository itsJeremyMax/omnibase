import https from "https";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import os from "os";

const CACHE_DIR = resolve(os.homedir(), ".config", "omnibase");
const CACHE_FILE = resolve(CACHE_DIR, ".update-check");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

export interface UpdateCheckCache {
  latestVersion: string;
  checkedAt: number;
}

export interface UpdateCheckDeps {
  fetchLatestVersion: () => Promise<string>;
  readCache: () => UpdateCheckCache | null;
  writeCache: (cache: UpdateCheckCache) => void;
  now: () => number;
}

export function fetchLatestVersionFromRegistry(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://registry.npmjs.org/omnibase-mcp/latest",
      { headers: { Accept: "application/json" }, timeout: FETCH_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Registry returned HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.version);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Registry request timed out"));
    });
    req.on("error", reject);
  });
}

export function readCacheFromDisk(): UpdateCheckCache | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeCacheToDisk(cache: UpdateCheckCache): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // Best-effort caching
  }
}

function defaultDeps(): UpdateCheckDeps {
  return {
    fetchLatestVersion: fetchLatestVersionFromRegistry,
    readCache: readCacheFromDisk,
    writeCache: writeCacheToDisk,
    now: () => Date.now(),
  };
}

export async function checkForUpdate(
  currentVersion: string,
  deps: UpdateCheckDeps = defaultDeps(),
): Promise<UpdateCheckCache | null> {
  try {
    const cached = deps.readCache();
    if (cached && deps.now() - cached.checkedAt < CACHE_MAX_AGE_MS) {
      return cached;
    }
    const latestVersion = await deps.fetchLatestVersion();
    const result: UpdateCheckCache = { latestVersion, checkedAt: deps.now() };
    deps.writeCache(result);
    return result;
  } catch {
    return null;
  }
}

export async function getUpdateNotice(
  currentVersion: string,
  deps: UpdateCheckDeps = defaultDeps(),
): Promise<string | null> {
  if (process.env.NO_UPDATE_NOTIFIER) {
    return null;
  }
  const result = await checkForUpdate(currentVersion, deps);
  if (!result) return null;
  const comparison = compareVersions(result.latestVersion, currentVersion);
  if (comparison <= 0) return null;
  if (isMajorChange(currentVersion, result.latestVersion)) {
    return `New major version available: ${currentVersion} -> ${result.latestVersion}. Run \`omnibase-mcp upgrade --allow-major\` to update.`;
  }
  return `Update available: ${currentVersion} -> ${result.latestVersion}. Run \`omnibase-mcp upgrade\` to update.`;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): ParsedVersion {
  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (va[key] > vb[key]) return 1;
    if (va[key] < vb[key]) return -1;
  }
  return 0;
}

export function isMajorChange(from: string, to: string): boolean {
  const vFrom = parseVersion(from);
  const vTo = parseVersion(to);
  return vFrom.major !== vTo.major;
}
