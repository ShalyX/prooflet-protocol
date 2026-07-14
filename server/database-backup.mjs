import { DatabaseSync, backup } from "node:sqlite";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const BACKUP_FORMAT = "prooflet-sqlite-backup-v1";
const REQUIRED_TABLES = [
  "schema_migrations",
  "issuers",
  "agents",
  "jobs",
  "proofs",
  "api_keys",
  "adjudicator_api_keys",
  "settlement_batches",
  "settlement_transactions",
];

export async function backupDatabase(db, destinationPath) {
  const destination = resolve(destinationPath);
  const manifestPath = manifestPathFor(destination);
  if (existsSync(destination) || existsSync(manifestPath)) {
    throw new Error("Backup destination already exists; choose a new path rather than overwriting a known-good backup.");
  }

  mkdirSync(dirname(destination), { recursive: true });
  const token = randomUUID();
  const stagedDatabase = `${destination}.tmp-${token}`;
  const stagedManifest = `${manifestPath}.tmp-${token}`;
  try {
    await backup(db, stagedDatabase);
    chmodSync(stagedDatabase, 0o600);
    const metadata = validateProofletDatabase(stagedDatabase);
    syncFile(stagedDatabase);
    const manifest = {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      sha256: sha256File(stagedDatabase),
      migrationVersion: metadata.migrationVersion,
      requiredTables: REQUIRED_TABLES,
    };
    writeFileSync(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    syncFile(stagedManifest);
    renameSync(stagedDatabase, destination);
    try {
      renameSync(stagedManifest, manifestPath);
    } catch (error) {
      rmSync(destination, { force: true });
      throw error;
    }
    syncDirectory(dirname(destination));
    return destination;
  } finally {
    rmSync(stagedDatabase, { force: true });
    rmSync(stagedManifest, { force: true });
  }
}

export function restoreDatabase({ sourcePath, destinationPath }) {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination) throw new Error("Backup source and restore destination must differ.");
  if (existsSync(`${source}-wal`) || existsSync(`${source}-shm`)) {
    throw new Error("Restore source has SQLite sidecars; use a manifest-backed online backup artifact instead of copying a live database.");
  }
  validateBackupArtifact(source);

  mkdirSync(dirname(destination), { recursive: true });
  const token = randomUUID();
  const staged = `${destination}.restore-${token}`;
  const rollback = `${destination}.rollback-${token}`;
  const rollbackWal = `${rollback}-wal`;
  const rollbackShm = `${rollback}-shm`;
  let previousMoved = false;
  let installed = false;
  if (!existsSync(destination) && (existsSync(`${destination}-wal`) || existsSync(`${destination}-shm`))) {
    throw new Error("Restore destination has SQLite sidecars without a main database; resolve the inconsistent maintenance state first.");
  }
  try {
    copyFileSync(source, staged);
    chmodSync(staged, 0o600);
    syncFile(staged);
    validateProofletDatabase(staged);

    if (existsSync(destination)) {
      renameSync(destination, rollback);
      previousMoved = true;
    }
    if (existsSync(`${destination}-wal`)) renameSync(`${destination}-wal`, rollbackWal);
    if (existsSync(`${destination}-shm`)) renameSync(`${destination}-shm`, rollbackShm);

    renameSync(staged, destination);
    installed = true;
    validateProofletDatabase(destination);
    rmSync(rollback, { force: true });
    rmSync(rollbackWal, { force: true });
    rmSync(rollbackShm, { force: true });
    syncDirectory(dirname(destination));
    return destination;
  } catch (error) {
    rmSync(staged, { force: true });
    if (installed) rmSync(destination, { force: true });
    if (previousMoved) {
      if (existsSync(rollback)) renameSync(rollback, destination);
      if (existsSync(rollbackWal)) renameSync(rollbackWal, `${destination}-wal`);
      if (existsSync(rollbackShm)) renameSync(rollbackShm, `${destination}-shm`);
    }
    syncDirectory(dirname(destination));
    throw error;
  } finally {
    rmSync(staged, { force: true });
  }
}

export function manifestPathFor(databasePath) {
  return `${resolve(databasePath)}.manifest.json`;
}

function validateBackupArtifact(path) {
  const manifestPath = manifestPathFor(path);
  if (!existsSync(manifestPath)) throw new Error("Backup manifest is missing; restore accepts only artifacts created by Prooflet's online backup command.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.format !== BACKUP_FORMAT) throw new Error("Unsupported Prooflet backup format.");
  if (manifest.sha256 !== sha256File(path)) throw new Error("Backup checksum does not match its manifest.");
  const metadata = validateProofletDatabase(path);
  if (metadata.migrationVersion !== manifest.migrationVersion) throw new Error("Backup migration version does not match its manifest.");
  return manifest;
}

function validateProofletDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const result = db.prepare("PRAGMA integrity_check").get();
    if (result.integrity_check !== "ok") throw new Error("SQLite integrity check failed.");
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`Backup is not a Prooflet database; missing tables: ${missing.join(", ")}.`);
    const migrationVersion = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
    if (migrationVersion < 13) throw new Error("Backup schema is older than the credential-revocation migration.");
    return { migrationVersion };
  } finally {
    db.close();
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function syncFile(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
