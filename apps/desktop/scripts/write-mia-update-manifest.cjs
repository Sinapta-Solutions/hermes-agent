#!/usr/bin/env node
/**
 * write-mia-update-manifest.cjs
 *
 * Generates mia-hermes-update.json with REAL values from:
 *   - git rev-parse HEAD (full 40-char SHA)
 *   - apps/desktop/release/ (finds the NSIS installer)
 *   - win-unpacked/resources/install-stamp.json (reads builtAt)
 *
 * Usage:
 *   node scripts/write-mia-update-manifest.cjs [--version X.Y.Z] [--notes "..."]
 *
 * Run AFTER `npm run dist:win:nsis` completes.
 * Reads the install-stamp.json from the build output to get the exact builtAt.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DESKTOP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..", "..");
const RELEASE_DIR = path.join(DESKTOP_ROOT, "release");
const HERMES_HOME =
  process.env.HERMES_HOME ||
  path.join(
    process.env.LOCALAPPDATA || process.env.HOME,
    "hermes"
  );
const MANIFEST_PATH = path.join(HERMES_HOME, "mia-hermes-update.json");

function tryExec(cmd) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: REPO_ROOT,
    }).trim();
  } catch {
    return null;
  }
}

function main() {
  // --- Parse CLI args ---
  const args = process.argv.slice(2);
  let version = null;
  let notes = "M.i.A Hermes update";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) version = args[++i];
    if (args[i] === "--notes" && args[i + 1]) notes = args[++i];
  }

  // --- Version from package.json if not provided ---
  if (!version) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(DESKTOP_ROOT, "package.json"), "utf8")
    );
    version = pkg.version;
  }
  if (!version) {
    console.error("[write-mia-update-manifest] ERROR: cannot determine version");
    process.exit(1);
  }

  // --- Real SHA from git ---
  const sha = tryExec("git rev-parse HEAD");
  if (!sha || sha.length < 10) {
    console.error("[write-mia-update-manifest] ERROR: git rev-parse HEAD failed");
    process.exit(1);
  }

  // --- Find installer ---
  const installerGlob = path.join(RELEASE_DIR, `MIA-Hermes-${version}-win-x64.exe`);
  if (!fs.existsSync(installerGlob)) {
    console.error(`[write-mia-update-manifest] ERROR: installer not found: ${installerGlob}`);
    process.exit(1);
  }

  // --- Read builtAt from install-stamp.json in build output ---
  const stampPath = path.join(DESKTOP_ROOT, "build", "install-stamp.json");
  let builtAt = null;
  if (fs.existsSync(stampPath)) {
    const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    builtAt = stamp.builtAt || null;
  }
  if (!builtAt) {
    // Fallback: try win-unpacked (only exists during/after build)
    const unpacked = path.join(
      RELEASE_DIR,
      "win-unpacked",
      "resources",
      "install-stamp.json"
    );
    if (fs.existsSync(unpacked)) {
      const stamp = JSON.parse(fs.readFileSync(unpacked, "utf8"));
      builtAt = stamp.builtAt || null;
    }
  }
  if (!builtAt) {
    console.warn(
      "[write-mia-update-manifest] WARNING: install-stamp.json not found; using current time"
    );
    builtAt = new Date().toISOString();
  }

  // --- Read installed stamp for beforeSha ---
  const installedStampPath = path.join(
    process.env.LOCALAPPDATA || process.env.HOME,
    "Programs",
    "MIA-Hermes",
    "resources",
    "install-stamp.json"
  );
  let beforeSha = null;
  if (fs.existsSync(installedStampPath)) {
    const installed = JSON.parse(fs.readFileSync(installedStampPath, "utf8"));
    beforeSha = installed.commit || null;
  }

  // --- Write manifest ---
  const manifest = {
    version,
    afterSha: sha,
    afterCommit: sha,
    beforeSha,
    installerPath: installerGlob.replace(/\//g, "\\"),
    installerSha512: null, // filled below if we can hash
    dirty: false,
    packageBuiltAt: builtAt,
    notes,
  };

  // --- Optional: compute SHA-512 of installer ---
  try {
    const hash = execSync(
      `powershell -Command "(Get-FileHash -Algorithm SHA512 '${installerGlob}').Hash.ToLower()"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (hash && hash.length === 128) {
      manifest.installerSha512 = hash;
    }
  } catch {
    console.warn(
      "[write-mia-update-manifest] WARNING: could not compute SHA-512; leaving null"
    );
  }

  // --- Ensure HERMES_HOME exists ---
  fs.mkdirSync(HERMES_HOME, { recursive: true });

  // --- Write ---
  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  console.log(`[write-mia-update-manifest] wrote ${MANIFEST_PATH}`);
  console.log(`  version:    ${manifest.version}`);
  console.log(`  afterSha:   ${manifest.afterSha}`);
  console.log(`  beforeSha:  ${manifest.beforeSha || "(none)"}`);
  console.log(`  builtAt:    ${manifest.packageBuiltAt}`);
  console.log(`  installer:  ${path.basename(manifest.installerPath)}`);
  console.log(`  sha512:     ${manifest.installerSha512 ? "computed" : "skipped"}`);
}

main();
