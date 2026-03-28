#!/usr/bin/env node

// Downloads the correct Go sidecar binary for the user's platform.
// Manages sidecar lifecycle: downloads on first install, re-downloads on version
// change, and falls back to Go build from source if needed.

const { execSync } = require("child_process");
const {
  existsSync,
  mkdirSync,
  chmodSync,
  createWriteStream,
  unlinkSync,
  readFileSync,
  writeFileSync,
} = require("fs");
const { join } = require("path");
const os = require("os");
const https = require("https");
const http = require("http");

const REPO = "itsJeremyMax/omnibase";
const BINARY_NAME = "omnibase-sidecar";
const SIDECAR_DIR = join(__dirname, "..", "sidecar");
const VERSION_FILE = join(SIDECAR_DIR, ".sidecar-version");

// Read version from package.json
const packageJson = require(join(__dirname, "..", "package.json"));
const VERSION = packageJson.version;

function getPlatformKey() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
  const archMap = { arm64: "arm64", x64: "amd64" };

  const p = platformMap[platform];
  const a = archMap[arch];

  if (!p || !a) {
    return null;
  }

  return `${p}-${a}`;
}

function getBinaryName(platformKey) {
  return platformKey.startsWith("windows")
    ? `${BINARY_NAME}-${platformKey}.exe`
    : `${BINARY_NAME}-${platformKey}`;
}

function getLocalBinaryPath() {
  const isWindows = os.platform() === "win32";
  return join(SIDECAR_DIR, isWindows ? `${BINARY_NAME}.exe` : BINARY_NAME);
}

function getInstalledVersion() {
  try {
    return readFileSync(VERSION_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

function writeInstalledVersion() {
  writeFileSync(VERSION_FILE, VERSION);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "omnibase-postinstall" } }, (res) => {
        // Follow redirects (GitHub releases use 302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          return download(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          unlinkSync(dest);
          reject(err);
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const binaryPath = getLocalBinaryPath();
  const installedVersion = getInstalledVersion();
  const binaryExists = existsSync(binaryPath);

  // Skip if binary exists and version matches
  if (binaryExists && installedVersion === VERSION) {
    console.log(`omnibase-sidecar ${VERSION} already installed.`);
    return;
  }

  // Log why we're (re)downloading
  if (binaryExists && installedVersion && installedVersion !== VERSION) {
    console.log(`Upgrading omnibase-sidecar from ${installedVersion} to ${VERSION}...`);
    unlinkSync(binaryPath);
  } else if (binaryExists && !installedVersion) {
    console.log(`omnibase-sidecar binary found without version info, re-downloading ${VERSION}...`);
    unlinkSync(binaryPath);
  }

  if (!existsSync(SIDECAR_DIR)) {
    mkdirSync(SIDECAR_DIR, { recursive: true });
  }

  const platformKey = getPlatformKey();

  // Try downloading from GitHub releases
  if (platformKey) {
    const assetName = getBinaryName(platformKey);
    const url = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${VERSION}/${assetName}`;
    console.log(`Downloading omnibase-sidecar ${VERSION} for ${platformKey}...`);

    try {
      await download(url, binaryPath);
      chmodSync(binaryPath, 0o755);
      writeInstalledVersion();
      console.log("omnibase-sidecar downloaded successfully.");
      return;
    } catch (err) {
      console.log(`Download failed: ${err.message}`);
      // Fall through to Go build
    }
  }

  // Try building from source if Go is available
  try {
    execSync("go version", { stdio: "ignore" });
    console.log("Go detected. Building sidecar from source...");
    execSync(`cd "${SIDECAR_DIR}" && go build -o ${BINARY_NAME} .`, {
      stdio: "inherit",
    });
    chmodSync(binaryPath, 0o755);
    writeInstalledVersion();
    console.log("omnibase-sidecar built successfully.");
    return;
  } catch {
    // Go not available
  }

  // Nothing worked
  console.log(
    `\nomnibase-sidecar binary not found.\n\n` +
      `Options:\n` +
      `  1. Download from: https://github.com/${REPO}/releases\n` +
      `  2. Build from source (requires Go 1.22+): cd sidecar && go build -o ${BINARY_NAME} .\n`,
  );
}

main().catch((err) => {
  console.error("postinstall error:", err.message);
  // Don't fail the install — the user can build manually
});
