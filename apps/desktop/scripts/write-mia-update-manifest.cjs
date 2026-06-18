#!/usr/bin/env node
/**
 * write-mia-update-manifest.cjs
 *
 * Generates mia-hermes-update.json with REAL values from:
 *   - git rev-parse HEAD (full 40-char SHA)
 *   - apps/desktop/release/ (finds the NSIS installer)
 *   - build/win-unpacked install-stamp.json (reads builtAt)
 *
 * Usage:
 *   node scripts/write-mia-update-manifest.cjs [--version X.Y.Z] [--notes "..."]
 *
 * Run AFTER `npm run dist:win:nsis` completes.
 * The installer is copied into HERMES_HOME/releases with a commit-suffixed
 * filename so rollback never depends on an ephemeral or overwritten release
 * folder.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DESKTOP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..", "..");
const RELEASE_DIR = path.join(DESKTOP_ROOT, "release");

function normalizeHermesHomeRoot(home) {
  if (!home) return home;
  const resolved = path.resolve(String(home));
  const parent = path.dirname(resolved);
  return path.basename(parent).toLowerCase() === "profiles" ? path.dirname(parent) : resolved;
}

const HERMES_HOME = normalizeHermesHomeRoot(
  process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || process.env.HOME, "hermes")
);
const MANIFEST_PATH = path.join(HERMES_HOME, "mia-hermes-update.json");
const INSTALL_HISTORY_PATH = path.join(HERMES_HOME, "mia-hermes-install-history.json");
const RELEASE_CACHE_DIR = path.join(HERMES_HOME, "releases");

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

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeExistingPath(value) {
  return typeof value === "string" && value && fs.existsSync(value) ? value : null;
}

function sha512File(filePath) {
  return crypto.createHash("sha512").update(fs.readFileSync(filePath)).digest("hex");
}

function existingInstallerPathWithMatchingHash(filePath, expectedSha512) {
  const existing = normalizeExistingPath(filePath);
  if (!existing) return null;
  if (typeof expectedSha512 !== "string" || expectedSha512.length !== 128) return existing;
  try {
    return sha512File(existing) === expectedSha512.toLowerCase() ? existing : null;
  } catch {
    return null;
  }
}

function manifestHistoryEntry(manifest) {
  return {
    version: manifest.version || null,
    sha: manifest.afterCommit || manifest.afterSha || null,
    packageBuiltAt: manifest.packageBuiltAt || null,
    installerPath: manifest.installerPath || null,
    installerSha512: manifest.installerSha512 || null,
    createdAt: manifest.createdAt || null,
  };
}

function previousHistoryEntry(manifest) {
  if (!manifest.previousInstallerPath) return null;
  return {
    version: manifest.previousVersion || null,
    sha: manifest.previousSha || manifest.beforeSha || null,
    packageBuiltAt: manifest.previousPackageBuiltAt || null,
    installerPath: manifest.previousInstallerPath,
    installerSha512: manifest.previousInstallerSha512 || null,
  };
}

function writeInstallHistory(manifest) {
  const history = {
    schemaVersion: 1,
    updatedAt: manifest.createdAt,
    current: manifestHistoryEntry(manifest),
    previous: previousHistoryEntry(manifest),
  };
  fs.writeFileSync(INSTALL_HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function currentManifestAsPrevious(existing, next) {
  if (!existing || typeof existing !== "object") return null;

  const previousInstallerPath = existingInstallerPathWithMatchingHash(
    existing.previousInstallerPath || existing.rollbackInstallerPath,
    existing.previousInstallerSha512 || existing.rollbackInstallerSha512
  );
  const existingInstallerPath = existingInstallerPathWithMatchingHash(
    existing.installerPath,
    existing.installerSha512
  );
  const existingSha = existing.afterCommit || existing.afterSha || null;
  const samePackage =
    existing.version === next.version &&
    existingSha === next.afterSha &&
    existing.packageBuiltAt === next.packageBuiltAt;

  // Re-running the manifest writer for the same package should preserve the
  // older rollback target, not turn the current installer into its own rollback.
  if (samePackage) {
    if (!previousInstallerPath) return null;
    return {
      previousVersion: existing.previousVersion || null,
      previousSha: existing.previousSha || existing.rollbackSha || existing.beforeSha || null,
      previousPackageBuiltAt: existing.previousPackageBuiltAt || existing.rollbackBuiltAt || null,
      previousInstallerPath,
      previousInstallerSha512: existing.previousInstallerSha512 || existing.rollbackInstallerSha512 || null,
    };
  }

  if (existingInstallerPath && existingSha && next.beforeSha && existingSha === next.beforeSha) {
    return {
      previousVersion: existing.version || null,
      previousSha: existingSha,
      previousPackageBuiltAt: existing.packageBuiltAt || null,
      previousInstallerPath: existingInstallerPath,
      previousInstallerSha512: existing.installerSha512 || null,
    };
  }

  if (!previousInstallerPath) return null;
  return {
    previousVersion: existing.previousVersion || null,
    previousSha: existing.previousSha || existing.rollbackSha || existing.beforeSha || null,
    previousPackageBuiltAt: existing.previousPackageBuiltAt || existing.rollbackBuiltAt || null,
    previousInstallerPath,
    previousInstallerSha512: existing.previousInstallerSha512 || existing.rollbackInstallerSha512 || null,
  };
}

function cachedInstallerName(sourcePath, version, sha) {
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);
  return `${base}-${sha.slice(0, 12)}${ext}`;
}

function main() {
  const args = process.argv.slice(2);
  let version = null;
  let notes = "M.i.A Hermes update";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) version = args[++i];
    if (args[i] === "--notes" && args[i + 1]) notes = args[++i];
  }

  if (!version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, "package.json"), "utf8"));
    version = pkg.version;
  }
  if (!version) {
    console.error("[write-mia-update-manifest] ERROR: cannot determine version");
    process.exit(1);
  }

  const sha = tryExec("git rev-parse HEAD");
  if (!sha || sha.length < 10) {
    console.error("[write-mia-update-manifest] ERROR: git rev-parse HEAD failed");
    process.exit(1);
  }

  const installerSource = path.join(RELEASE_DIR, `MIA-Hermes-${version}-win-x64.exe`);
  if (!fs.existsSync(installerSource)) {
    console.error(`[write-mia-update-manifest] ERROR: installer not found: ${installerSource}`);
    process.exit(1);
  }

  const stampPath = path.join(DESKTOP_ROOT, "build", "install-stamp.json");
  let builtAt = null;
  if (fs.existsSync(stampPath)) {
    const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    builtAt = stamp.builtAt || null;
  }
  if (!builtAt) {
    const unpacked = path.join(RELEASE_DIR, "win-unpacked", "resources", "install-stamp.json");
    if (fs.existsSync(unpacked)) {
      const stamp = JSON.parse(fs.readFileSync(unpacked, "utf8"));
      builtAt = stamp.builtAt || null;
    }
  }
  if (!builtAt) {
    console.warn("[write-mia-update-manifest] WARNING: install-stamp.json not found; using current time");
    builtAt = new Date().toISOString();
  }

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

  const existingManifest = readJsonIfExists(MANIFEST_PATH);

  fs.mkdirSync(RELEASE_CACHE_DIR, { recursive: true });
  const cachedInstallerPath = path.join(RELEASE_CACHE_DIR, cachedInstallerName(installerSource, version, sha));
  fs.copyFileSync(installerSource, cachedInstallerPath);

  const manifest = {
    version,
    branch: "mia-hermes",
    afterSha: sha,
    afterCommit: sha,
    beforeSha,
    installerPath: cachedInstallerPath,
    installerSha512: sha512File(cachedInstallerPath),
    silentArgs: ["/S", "%INSTALL_DIR_ARG%"],
    dirty: false,
    packageBuiltAt: builtAt,
    createdAt: new Date().toISOString(),
    notes,
  };

  const previous = currentManifestAsPrevious(existingManifest, manifest);
  if (previous) Object.assign(manifest, previous);

  fs.mkdirSync(HERMES_HOME, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeInstallHistory(manifest);

  console.log(`[write-mia-update-manifest] wrote ${MANIFEST_PATH}`);
  console.log(`  version:    ${manifest.version}`);
  console.log(`  afterSha:   ${manifest.afterSha}`);
  console.log(`  beforeSha:  ${manifest.beforeSha || "(none)"}`);
  console.log(`  builtAt:    ${manifest.packageBuiltAt}`);
  console.log(`  installer:  ${path.basename(manifest.installerPath)}`);
  console.log(`  cache:      ${manifest.installerPath}`);
  console.log(`  history:    ${INSTALL_HISTORY_PATH}`);
  console.log(`  sha512:     ${manifest.installerSha512 ? "computed" : "skipped"}`);
  console.log(`  rollback:   ${manifest.previousInstallerPath ? path.basename(manifest.previousInstallerPath) : "(none)"}`);
}

main();
