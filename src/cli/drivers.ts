import pc from "picocolors";
import Table from "cli-table3";
import { join, resolve } from "path";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import os from "os";

const REPO = "itsJeremyMax/omnibase";

function getVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "..", "..", "..", "package.json"), "utf-8"),
  );
  return pkg.version;
}

function getDriversBase(): string {
  return process.env.OMNIBASE_DRIVERS_PATH || join(os.homedir(), ".omnibase", "drivers");
}

function getDriversDir(): string {
  return join(getDriversBase(), getVersion());
}

function getPlatformKey(): string {
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = { arm64: "arm64", x64: "amd64" };
  const p = platformMap[os.platform()] ?? os.platform();
  const a = archMap[os.arch()] ?? os.arch();
  return `${p}-${a}`;
}

interface DriverManifest {
  drivers: Record<string, { binary: string; schemes: string[] }>;
}

function loadManifest(): DriverManifest | null {
  // Try version-specific dir first
  const versionManifest = join(getDriversDir(), "drivers.json");
  if (existsSync(versionManifest)) {
    return JSON.parse(readFileSync(versionManifest, "utf-8"));
  }
  // Fall back to sidecar source dir
  const srcManifest = resolve(__dirname, "..", "..", "..", "sidecar", "drivers.json");
  if (existsSync(srcManifest)) {
    return JSON.parse(readFileSync(srcManifest, "utf-8"));
  }
  return null;
}

async function list(): Promise<void> {
  const manifest = loadManifest();
  if (!manifest) {
    console.error(
      pc.red("No drivers manifest found. The manifest will be downloaded on first use."),
    );
    return;
  }

  const driversDir = getDriversDir();
  const platform = getPlatformKey();

  const table = new Table({
    head: [pc.bold("Driver"), pc.bold("Schemes"), pc.bold("Status")],
  });

  const sorted = Object.entries(manifest.drivers).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, entry] of sorted) {
    const binaryPath = join(driversDir, `${entry.binary}-${platform}`);
    const installed = existsSync(binaryPath);
    const unverified = existsSync(binaryPath + ".unverified");
    const schemesStr =
      entry.schemes.slice(0, 4).join(", ") + (entry.schemes.length > 4 ? ", ..." : "");
    let status: string;
    if (installed && unverified) {
      status = pc.yellow("installed (unverified)");
    } else if (installed) {
      status = pc.green("installed");
    } else {
      status = pc.dim("not installed");
    }
    table.push([name, schemesStr, status]);
  }

  console.log(table.toString());

  const total = sorted.length;
  const installedCount = sorted.filter(([, entry]) => {
    const binaryPath = join(driversDir, `${entry.binary}-${platform}`);
    return existsSync(binaryPath);
  }).length;
  console.log(pc.dim(`\n${installedCount}/${total} drivers installed. Path: ${driversDir}`));
}

async function install(target?: string): Promise<void> {
  const manifest = loadManifest();
  if (!manifest) {
    console.error(pc.red("No drivers manifest found."));
    return;
  }

  if (!target) {
    console.error("Usage: omnibase-mcp drivers install <driver-name|--all>");
    return;
  }

  const version = getVersion();
  const platform = getPlatformKey();
  const driversDir = getDriversDir();
  mkdirSync(driversDir, { recursive: true });

  const toInstall: string[] = [];

  if (target === "--all") {
    toInstall.push(...Object.values(manifest.drivers).map((e) => e.binary));
  } else {
    // Find by driver name
    const entry = manifest.drivers[target];
    if (entry) {
      toInstall.push(entry.binary);
    } else {
      // Search schemes
      for (const [, e] of Object.entries(manifest.drivers)) {
        if (e.schemes.includes(target)) {
          toInstall.push(e.binary);
          break;
        }
      }
    }
    if (toInstall.length === 0) {
      console.error(
        pc.red(
          `Unknown driver or scheme: ${target}. Run 'omnibase-mcp drivers list' to see available drivers.`,
        ),
      );
      return;
    }
  }

  let installed = 0;
  let skipped = 0;
  let failed = 0;

  for (const binary of toInstall) {
    const assetName = `${binary}-${platform}`;
    const destPath = join(driversDir, assetName);

    if (existsSync(destPath)) {
      console.log(pc.dim(`  ${assetName} already installed.`));
      skipped++;
      continue;
    }

    const url = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${version}/${assetName}`;
    console.log(`  Downloading ${assetName}...`);

    try {
      execSync(`curl -fsSL -o "${destPath}" "${url}"`, { stdio: "pipe" });
      execSync(`chmod +x "${destPath}"`, { stdio: "pipe" });
      console.log(pc.green(`  ${assetName} installed.`));
      installed++;
    } catch {
      // Download failed; try building from source
      const sidecarDir = resolve(__dirname, "..", "..", "..", "sidecar");
      const driverPkg = binary.replace("driver-", "");
      const mainGo = join(sidecarDir, "drivers", driverPkg, "main.go");

      if (existsSync(mainGo)) {
        try {
          execSync("go version", { stdio: "pipe" });
          console.log(pc.dim(`  Download failed, building ${driverPkg} from source...`));
          execSync(`cd "${sidecarDir}" && go build -o "${destPath}" ./drivers/${driverPkg}/`, {
            stdio: "pipe",
          });
          execSync(`chmod +x "${destPath}"`, { stdio: "pipe" });
          // Mark as unverified
          const { writeFileSync } = await import("fs");
          writeFileSync(destPath + ".unverified", "built from source");
          console.log(pc.yellow(`  ${assetName} built from source (unverified).`));
          installed++;
        } catch {
          console.error(pc.red(`  Failed to download or build ${assetName}.`));
          failed++;
        }
      } else {
        console.error(pc.red(`  Failed to download ${assetName}.`));
        failed++;
      }
    }
  }

  console.log(`\nInstalled: ${installed}  Skipped: ${skipped}  Failed: ${failed}`);
}

async function build(target?: string): Promise<void> {
  // Check Go is available
  try {
    execSync("go version", { stdio: "pipe" });
  } catch {
    console.error(
      pc.red(
        "Go is not installed. Install Go from https://go.dev/dl/ to build drivers from source.",
      ),
    );
    return;
  }

  const manifest = loadManifest();
  if (!manifest) {
    console.error(pc.red("No drivers manifest found."));
    return;
  }

  const sidecarDir = resolve(__dirname, "..", "..", "..", "sidecar");
  if (!existsSync(join(sidecarDir, "drivers"))) {
    console.error(
      pc.red("Sidecar source not found. This command requires the omnibase source tree."),
    );
    return;
  }

  if (!target) {
    console.error("Usage: omnibase-mcp drivers build <driver-name|--all>");
    return;
  }

  const platform = getPlatformKey();
  const driversDir = getDriversDir();
  mkdirSync(driversDir, { recursive: true });

  const toBuild: Array<{ name: string; binary: string }> = [];

  if (target === "--all") {
    for (const [name, entry] of Object.entries(manifest.drivers)) {
      toBuild.push({ name, binary: entry.binary });
    }
  } else {
    const entry = manifest.drivers[target];
    if (entry) {
      toBuild.push({ name: target, binary: entry.binary });
    } else {
      for (const [name, e] of Object.entries(manifest.drivers)) {
        if (e.schemes.includes(target)) {
          toBuild.push({ name, binary: e.binary });
          break;
        }
      }
    }
    if (toBuild.length === 0) {
      console.error(
        pc.red(
          `Unknown driver or scheme: ${target}. Run 'omnibase-mcp drivers list' to see available drivers.`,
        ),
      );
      return;
    }
  }

  let built = 0;
  let skipped = 0;
  let failed = 0;

  for (const { name, binary } of toBuild) {
    const assetName = `${binary}-${platform}`;
    const destPath = join(driversDir, assetName);
    const driverPkg = binary.replace("driver-", "");
    const mainGo = join(sidecarDir, "drivers", driverPkg, "main.go");

    if (existsSync(destPath) && !existsSync(destPath + ".unverified")) {
      console.log(pc.dim(`  ${name} already installed (verified).`));
      skipped++;
      continue;
    }

    if (!existsSync(mainGo)) {
      console.error(pc.red(`  ${name}: source not found at drivers/${driverPkg}/main.go`));
      failed++;
      continue;
    }

    process.stdout.write(`  Building ${name}...`);
    try {
      execSync(
        `cd "${sidecarDir}" && go build -ldflags="-s -w" -o "${destPath}" ./drivers/${driverPkg}/`,
        {
          stdio: "pipe",
          timeout: 120000,
        },
      );
      execSync(`chmod +x "${destPath}"`, { stdio: "pipe" });
      const { writeFileSync } = await import("fs");
      writeFileSync(destPath + ".unverified", "built from source");
      console.log(pc.yellow(" ok (unverified)"));
      built++;
    } catch {
      console.log(pc.red(" FAILED"));
      failed++;
    }
  }

  console.log(`\nBuilt: ${built}  Skipped: ${skipped}  Failed: ${failed}`);
  if (built > 0) {
    console.log(
      pc.dim(
        "Drivers built from source are marked as unverified until checksums can be validated against a release.",
      ),
    );
  }
}

async function clean(): Promise<void> {
  const base = getDriversBase();
  const currentVersion = getVersion();

  if (!existsSync(base)) {
    console.log("No drivers directory found.");
    return;
  }

  const entries = readdirSync(base, { withFileTypes: true });
  const versions = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let removed = 0;
  for (const v of versions) {
    if (v !== currentVersion) {
      rmSync(join(base, v), { recursive: true, force: true });
      console.log(`  Removed ${v}/`);
      removed++;
    }
  }

  if (removed === 0) {
    console.log("No old versions to clean.");
  } else {
    console.log(`\nCleaned ${removed} old version(s).`);
  }
}

async function path(): Promise<void> {
  console.log(getDriversDir());
}

export const drivers = { list, install, build, clean, path };
