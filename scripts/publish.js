#!/usr/bin/env node

/**
 * Direct npm registry publish script.
 *
 * The npm CLI requires an OTP for publishing when account-level 2FA is
 * enforced, even when using a granular access token with "bypass 2FA"
 * enabled. This script publishes directly via the registry API, which
 * correctly honours the bypass-2FA flag on granular tokens.
 *
 * Usage:
 *   NODE_AUTH_TOKEN=npm_xxx node scripts/publish.js
 */

const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const token = process.env.NODE_AUTH_TOKEN;
if (!token) {
  console.error("NODE_AUTH_TOKEN environment variable is required");
  process.exit(1);
}

// Pack the tarball using npm pack
console.log("Creating tarball...");
const packOutput = execSync("npm pack --json", { encoding: "utf8" });
const packInfo = JSON.parse(packOutput);
const tgzFilename = packInfo[0].filename;
const tgzPath = path.join(process.cwd(), tgzFilename);

const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tgzData = fs.readFileSync(tgzPath);
const shasum = crypto.createHash("sha1").update(tgzData).digest("hex");
const integrity = "sha512-" + crypto.createHash("sha512").update(tgzData).digest("base64");

const body = JSON.stringify({
  _id: pkgJson.name,
  name: pkgJson.name,
  description: pkgJson.description,
  "dist-tags": { latest: pkgJson.version },
  versions: {
    [pkgJson.version]: {
      ...pkgJson,
      _id: `${pkgJson.name}@${pkgJson.version}`,
      dist: {
        shasum,
        integrity,
        tarball: `https://registry.npmjs.org/${pkgJson.name}/-/${pkgJson.name}-${pkgJson.version}.tgz`,
      },
    },
  },
  _attachments: {
    [`${pkgJson.name}-${pkgJson.version}.tgz`]: {
      content_type: "application/octet-stream",
      data: tgzData.toString("base64"),
      length: tgzData.length,
    },
  },
  access: "public",
});

console.log(`Publishing ${pkgJson.name}@${pkgJson.version}...`);

const req = https.request(
  {
    hostname: "registry.npmjs.org",
    path: "/" + encodeURIComponent(pkgJson.name),
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Authorization: "Bearer " + token,
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log(`Successfully published ${pkgJson.name}@${pkgJson.version}`);
        // Clean up tarball
        fs.unlinkSync(tgzPath);
      } else {
        console.error(`Publish failed with status ${res.statusCode}`);
        console.error(data);
        fs.unlinkSync(tgzPath);
        process.exit(1);
      }
    });
  },
);

req.on("error", (err) => {
  console.error("Request failed:", err.message);
  process.exit(1);
});

req.write(body);
req.end();
