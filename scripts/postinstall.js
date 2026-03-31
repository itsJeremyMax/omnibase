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
const crypto = require("crypto");

const REPO = "itsJeremyMax/omnibase";
const BINARY_NAME = "omnibase-sidecar";
const SIDECAR_DIR = join(__dirname, "..", "sidecar");
const BIN_DIR = join(SIDECAR_DIR, "bin");
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
  return join(BIN_DIR, isWindows ? `${BINARY_NAME}.exe` : BINARY_NAME);
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

function downloadToString(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "omnibase-postinstall" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return downloadToString(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function getExpectedChecksum(checksumsText, assetName) {
  const lines = checksumsText.trim().split("\n");
  const match = lines.find((line) => {
    const parts = line.split(/\s+/);
    return parts[1] === assetName;
  });
  return match ? match.split(/\s+/)[0] : null;
}

function verifyChecksum(filePath, expectedHash) {
  const content = readFileSync(filePath);
  const actualHash = crypto.createHash("sha256").update(content).digest("hex");
  return { match: actualHash === expectedHash, actualHash };
}

function getDriversDir() {
  const home = os.homedir();
  return join(home, ".omnibase", "drivers", VERSION);
}

async function downloadDrivers() {
  // Try to read the user's config to determine which drivers to download
  const configPaths = [
    join(process.cwd(), "omnibase.config.yaml"),
    join(os.homedir(), ".config", "omnibase", "config.yaml"),
  ];

  let configContent = null;
  for (const p of configPaths) {
    try {
      configContent = readFileSync(p, "utf8");
      break;
    } catch {}
  }

  if (!configContent) {
    console.log(
      "No config found, skipping driver download. Drivers will be downloaded on first use.",
    );
    return;
  }

  // Parse DSN schemes from config (simple regex)
  const dsnPattern = /dsn:\s*["']?(\w+):/g;
  const schemes = new Set();
  let match;
  while ((match = dsnPattern.exec(configContent)) !== null) {
    schemes.add(match[1].toLowerCase());
  }

  if (schemes.size === 0) return;

  const driversDir = getDriversDir();
  mkdirSync(driversDir, { recursive: true });

  // Download manifest
  const manifestUrl = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${VERSION}/drivers.json`;
  const manifestPath = join(driversDir, "drivers.json");
  try {
    await download(manifestUrl, manifestPath);
  } catch (err) {
    console.log(`Could not download driver manifest: ${err.message}`);
    console.log("Drivers will be downloaded on first use.");
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // Download checksums
  const checksumsUrl = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${VERSION}/driver-checksums-sha256.txt`;
  const checksumsPath = join(driversDir, "driver-checksums-sha256.txt");
  try {
    await download(checksumsUrl, checksumsPath);
  } catch {
    console.log("Could not download driver checksums. Drivers will be downloaded on first use.");
    return;
  }
  const checksumsText = readFileSync(checksumsPath, "utf8");

  const platformKey = getPlatformKey();
  if (!platformKey) return;

  // Find which drivers to download
  const neededDrivers = new Set();
  for (const [, entry] of Object.entries(manifest.drivers)) {
    for (const scheme of entry.schemes) {
      if (schemes.has(scheme)) {
        neededDrivers.add(entry.binary);
        break;
      }
    }
  }

  for (const binaryName of neededDrivers) {
    const assetName = `${binaryName}-${platformKey}`;
    const destPath = join(driversDir, assetName);

    if (existsSync(destPath)) {
      console.log(`  ${assetName} already installed.`);
      continue;
    }

    const url = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${VERSION}/${assetName}`;
    console.log(`  Downloading ${assetName}...`);

    try {
      await download(url, destPath);
    } catch (err) {
      console.log(`  Failed: ${err.message}`);
      continue;
    }

    const expectedHash = getExpectedChecksum(checksumsText, assetName);
    if (!expectedHash) {
      unlinkSync(destPath);
      console.log(`  No checksum for ${assetName}, skipping.`);
      continue;
    }

    const { match: checksumMatch } = verifyChecksum(destPath, expectedHash);
    if (!checksumMatch) {
      unlinkSync(destPath);
      console.log(`  Checksum mismatch for ${assetName}, skipping.`);
      continue;
    }

    chmodSync(destPath, 0o755);
    console.log(`  ${assetName} installed.`);
  }
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
    console.log(
      `Note: The sidecar now uses separate driver plugins. Drivers will be downloaded to ~/.omnibase/drivers/${VERSION}/`,
    );
    unlinkSync(binaryPath);
  } else if (binaryExists && !installedVersion) {
    console.log(`omnibase-sidecar binary found without version info, re-downloading ${VERSION}...`);
    unlinkSync(binaryPath);
  }

  if (!existsSync(BIN_DIR)) {
    mkdirSync(BIN_DIR, { recursive: true });
  }

  const platformKey = getPlatformKey();

  // Try downloading from GitHub releases
  if (platformKey) {
    const assetName = getBinaryName(platformKey);
    const url = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${VERSION}/${assetName}`;
    console.log(`Downloading omnibase-sidecar ${VERSION} for ${platformKey}...`);

    let downloaded = false;
    try {
      await download(url, binaryPath);
      downloaded = true;
    } catch (err) {
      console.log(`Download failed: ${err.message}`);
      // Fall through to Go build
    }

    // Checksum verification is mandatory for downloaded binaries.
    // This is intentionally outside the download try/catch so that
    // verification failures cannot accidentally fall through to the
    // Go build fallback.
    if (downloaded) {
      const checksumsUrl = `https://github.com/${REPO}/releases/download/omnibase-mcp-v${VERSION}/checksums-sha256.txt`;
      let checksumsText;
      try {
        checksumsText = await downloadToString(checksumsUrl);
      } catch (err) {
        unlinkSync(binaryPath);
        console.error(
          `Failed to download checksums file: ${err.message}\n` +
            `The downloaded binary has been deleted.\n` +
            `Please retry or download manually from: https://github.com/${REPO}/releases`,
        );
        process.exit(1);
      }

      const expectedHash = getExpectedChecksum(checksumsText, assetName);
      if (!expectedHash) {
        unlinkSync(binaryPath);
        console.error(
          `No checksum found for ${assetName} in checksums-sha256.txt.\n` +
            `The downloaded binary has been deleted.\n` +
            `Please retry or download manually from: https://github.com/${REPO}/releases`,
        );
        process.exit(1);
      }

      const { match, actualHash } = verifyChecksum(binaryPath, expectedHash);
      if (!match) {
        unlinkSync(binaryPath);
        console.error(
          `Checksum verification failed for ${assetName}.\n` +
            `Expected: ${expectedHash}\n` +
            `Actual:   ${actualHash}\n` +
            `The downloaded binary has been deleted. This may indicate tampering or a corrupted download.\n` +
            `Please retry or download manually from: https://github.com/${REPO}/releases`,
        );
        process.exit(1);
      }

      console.log("Checksum verified.");
      chmodSync(binaryPath, 0o755);
      writeInstalledVersion();
      console.log("omnibase-sidecar downloaded successfully.");
      await downloadDrivers();
      return;
    }
  }

  // Try building from source if Go is available
  try {
    execSync("go version", { stdio: "ignore" });
    console.log("Go detected. Building sidecar from source...");
    execSync(
      `cd "${SIDECAR_DIR}" && mkdir -p bin && go build -ldflags="-s -w" -o bin/${BINARY_NAME} .`,
      {
        stdio: "inherit",
      },
    );
    chmodSync(binaryPath, 0o755);
    writeInstalledVersion();
    console.log("omnibase-sidecar built successfully.");
    await downloadDrivers();
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

module.exports = { getExpectedChecksum, verifyChecksum };
