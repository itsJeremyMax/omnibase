import pc from "picocolors";
import { execSync } from "child_process";
import https from "https";
import {
  compareVersions,
  isMajorChange,
  fetchLatestVersionFromRegistry,
} from "../update-checker.js";

export interface ChangelogSection {
  heading: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export function parseChangelog(
  changelogText: string,
  fromVersion: string,
  toVersion: string,
): ChangelogEntry[] {
  if (!changelogText.trim()) return [];

  const lower = compareVersions(fromVersion, toVersion) < 0 ? fromVersion : toVersion;
  const upper = compareVersions(fromVersion, toVersion) < 0 ? toVersion : fromVersion;

  if (lower === upper) return [];

  const versionHeaderRegex = /^## \[(\d+\.\d+\.\d+)\].*?\((\d{4}-\d{2}-\d{2})\)/;
  const lines = changelogText.split("\n");

  const entries: ChangelogEntry[] = [];
  let currentEntry: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;

  for (const line of lines) {
    const versionMatch = line.match(versionHeaderRegex);
    if (versionMatch) {
      if (currentEntry && currentSection) {
        currentEntry.sections.push(currentSection);
      }
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      currentSection = null;
      continue;
    }

    if (!currentEntry) continue;

    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) {
      if (currentSection) {
        currentEntry.sections.push(currentSection);
      }
      currentSection = { heading: sectionMatch[1], items: [] };
      continue;
    }

    if (currentSection && line.startsWith("* ")) {
      const cleaned = line
        .slice(2)
        .replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)$/g, "")
        .trim();
      if (cleaned) {
        currentSection.items.push(cleaned);
      }
    }
  }

  if (currentEntry && currentSection) {
    currentEntry.sections.push(currentSection);
  }
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries.filter((e) => {
    return compareVersions(e.version, lower) > 0 && compareVersions(e.version, upper) <= 0;
  });
}

export function formatChangelog(entries: ChangelogEntry[], opts: { isDowngrade: boolean }): string {
  if (entries.length === 0) return "";

  const header = opts.isDowngrade ? "Changes being rolled back:" : "What's new:";
  const lines: string[] = [`  ${header}`, ""];

  for (const entry of entries) {
    lines.push(`  ${entry.version} (${entry.date})`);
    for (const section of entry.sections) {
      lines.push(`    ${section.heading}`);
      for (const item of section.items) {
        lines.push(`    - ${item}`);
      }
    }
    lines.push("");
  }

  lines.push("  Full release notes: https://github.com/itsJeremyMax/omnibase/releases");

  return lines.join("\n");
}

export interface InstallMethodGlobal {
  type: "global";
  command: (version: string) => string;
}

export interface InstallMethodNpx {
  type: "npx";
  message: string;
}

export interface InstallMethodLocal {
  type: "local";
  message: string;
}

export type InstallMethod = InstallMethodGlobal | InstallMethodNpx | InstallMethodLocal;

export function detectInstallMethod(scriptPath: string, npmPrefix: string): InstallMethod {
  if (scriptPath.includes("_npx")) {
    return {
      type: "npx",
      message:
        "You're running via npx, which fetches the latest version on demand.\n" +
        "  To pin a specific version: npx omnibase-mcp@<version>",
    };
  }

  if (scriptPath.startsWith(npmPrefix)) {
    return {
      type: "global",
      command: (version: string) => `npm install -g omnibase-mcp@${version}`,
    };
  }

  return {
    type: "local",
    message:
      "omnibase-mcp is installed as a local dependency.\n" +
      '  Update the version in your package.json and run "npm install".',
  };
}

export interface UpgradeOptions {
  dryRun?: boolean;
  version?: string;
  allowMajor?: boolean;
}

export interface UpgradeDeps {
  currentVersion: string;
  fetchLatestVersion: () => Promise<string>;
  fetchVersionExists: (version: string) => Promise<boolean>;
  fetchChangelog: (version: string) => Promise<string>;
  detectInstall: () => InstallMethod;
  execInstall: (command: string) => Promise<void>;
  verifyInstall: () => string;
  log: (message: string) => void;
}

export function fetchVersionExists(version: string): Promise<boolean> {
  return new Promise((resolve) => {
    https
      .get(
        `https://registry.npmjs.org/omnibase-mcp/${version}`,
        { headers: { Accept: "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      )
      .on("error", () => resolve(false));
  });
}

export function fetchChangelogFromGitHub(version: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/itsJeremyMax/omnibase/omnibase-mcp-v${version}/CHANGELOG.md`;
    const req = https.get(url, { headers: { "User-Agent": "omnibase-mcp" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
          reject(new Error("Redirect without location header"));
          return;
        }
        https
          .get(redirectUrl, { headers: { "User-Agent": "omnibase-mcp" } }, (redirectRes) => {
            let data = "";
            redirectRes.on("data", (chunk: string) => (data += chunk));
            redirectRes.on("end", () => resolve(data));
          })
          .on("error", reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub returned HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
  });
}

export function execInstallCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      execSync(command, { stdio: "inherit" });
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export async function runUpgrade(options: UpgradeOptions, deps: UpgradeDeps): Promise<void> {
  const { dryRun, version: targetVersionArg, allowMajor } = options;

  let targetVersion: string;
  try {
    if (targetVersionArg) {
      const exists = await deps.fetchVersionExists(targetVersionArg);
      if (!exists) {
        deps.log(
          `  Version ${targetVersionArg} not found on npm.\n` +
            `  Run \`omnibase-mcp upgrade --dry-run\` to see the latest available version.`,
        );
        return;
      }
      targetVersion = targetVersionArg;
    } else {
      targetVersion = await deps.fetchLatestVersion();
    }
  } catch {
    deps.log("  Could not reach the npm registry. Check your internet connection.");
    return;
  }

  if (compareVersions(targetVersion, deps.currentVersion) === 0) {
    deps.log(`  Already up to date (v${deps.currentVersion})`);
    return;
  }

  if (isMajorChange(deps.currentVersion, targetVersion) && !allowMajor) {
    deps.log(
      `  Cannot upgrade from ${deps.currentVersion} to ${targetVersion}: major version change.\n` +
        `  Major updates may include breaking changes.\n` +
        `  Run \`omnibase-mcp upgrade${targetVersionArg ? ` --version ${targetVersionArg}` : ""} --allow-major\` to proceed.`,
    );
    return;
  }

  const isDowngrade = compareVersions(targetVersion, deps.currentVersion) < 0;

  if (targetVersionArg) {
    deps.log(`  Current: ${deps.currentVersion}`);
    deps.log(`  Target:  ${targetVersion}${isDowngrade ? " (downgrade)" : ""}`);
  } else {
    deps.log(`  Current: ${deps.currentVersion}`);
    deps.log(`  Latest:  ${targetVersion}`);
  }
  deps.log("");

  try {
    const changelogText = await deps.fetchChangelog(targetVersion);
    if (changelogText) {
      const entries = parseChangelog(changelogText, deps.currentVersion, targetVersion);
      const formatted = formatChangelog(entries, { isDowngrade });
      if (formatted) {
        deps.log(formatted);
        deps.log("");
      }
    }
  } catch {
    // Changelog fetch failed -- not critical, continue
  }

  if (dryRun) {
    const cmd = targetVersionArg
      ? `omnibase-mcp upgrade --version ${targetVersion}`
      : `omnibase-mcp upgrade`;
    deps.log(`  Run \`${cmd}\` to install.`);
    return;
  }

  const installMethod = deps.detectInstall();
  if (installMethod.type !== "global") {
    deps.log(`  ${installMethod.message}`);
    return;
  }

  const command = installMethod.command(targetVersion);
  deps.log(`  Installing omnibase-mcp@${targetVersion}...`);
  try {
    await deps.execInstall(command);
    const installedVersion = deps.verifyInstall();
    if (installedVersion === targetVersion) {
      deps.log(`\n  ${pc.green("Updated successfully")} to v${targetVersion}`);
    } else {
      deps.log(
        `\n  ${pc.yellow("Warning:")} expected v${targetVersion} but found v${installedVersion}.` +
          `\n  You may need to restart your terminal or check your PATH.`,
      );
    }
  } catch {
    deps.log(`\n  ${pc.red("Update failed.")} You can try manually: ${command}`);
  }
}

export async function handleUpgradeCommand(): Promise<void> {
  const args = process.argv.slice(3);
  const options: UpgradeOptions = {
    dryRun: args.includes("--dry-run"),
    allowMajor: args.includes("--allow-major"),
  };

  const versionFlagIndex = args.indexOf("--version");
  if (versionFlagIndex !== -1 && args[versionFlagIndex + 1]) {
    options.version = args[versionFlagIndex + 1];
  }

  const { readFileSync: readFs } = await import("fs");
  const { resolve: resolvePath } = await import("path");
  const pkg = JSON.parse(readFs(resolvePath(__dirname, "..", "..", "..", "package.json"), "utf-8"));

  const npmPrefix = (() => {
    try {
      return execSync("npm prefix -g", { encoding: "utf-8" }).trim();
    } catch {
      return "";
    }
  })();

  const deps: UpgradeDeps = {
    currentVersion: pkg.version,
    fetchLatestVersion: fetchLatestVersionFromRegistry,
    fetchVersionExists,
    fetchChangelog: fetchChangelogFromGitHub,
    detectInstall: () => detectInstallMethod(process.argv[1], npmPrefix),
    execInstall: execInstallCommand,
    verifyInstall: () => {
      try {
        return execSync("omnibase-mcp --version", { encoding: "utf-8" })
          .trim()
          .replace(/^omnibase-mcp v/, "");
      } catch {
        return "unknown";
      }
    },
    log: (msg: string) => console.log(msg),
  };

  await runUpgrade(options, deps);
}
