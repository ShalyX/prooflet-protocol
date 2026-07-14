import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { revokeSourceVisibleDevelopmentCredentials, runMigrations } from "./migrations/index.mjs";

export const DB_PATH = resolve(process.env.UWP_DB_PATH || "data/useful-waiting.sqlite");

export function assertDurableProductionStorage(path, env = process.env) {
  const required = env["NODE_ENV"] === "production" && env["PROOFLET_DURABLE_STORAGE_REQUIRED"] === "true";
  if (!required) return;
  const normalized = resolve(path);
  if (!isPersistentPath(normalized, env)) {
    throw new Error("Prooflet production durable storage is required; configure a persistent disk path and mount before starting the API.");
  }
}

export function databaseStorageStatus(path = DB_PATH, env = process.env) {
  const configured = Boolean(path);
  const durability = env["PROOFLET_STORAGE_DURABILITY"] || "local";
  const durable = isPersistentPath(resolve(path), env);
  return {
    configured,
    durable,
    mode: durable ? "persistent-disk" : durability === "persistent-disk" ? "misconfigured" : "local",
  };
}

function isPersistentPath(path, env) {
  if (env["PROOFLET_STORAGE_DURABILITY"] !== "persistent-disk") return false;
  const mountValue = env["PROOFLET_PERSISTENT_MOUNT_PATH"];
  if (!mountValue) return false;
  const mount = resolve(mountValue);
  if (mount === "/tmp" || mount.startsWith("/tmp/")) return false;
  const child = relative(mount, path);
  return Boolean(child) && child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(child);
}

export function openDatabase({ reset = false, path = DB_PATH, env = process.env } = {}) {
  const databasePath = resolve(path);
  assertDurableProductionStorage(databasePath, env);
  mkdirSync(dirname(databasePath), { recursive: true });
  if (reset && existsSync(databasePath)) rmSync(databasePath);

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
  if (env.NODE_ENV === "production") revokeSourceVisibleDevelopmentCredentials(db);
  return db;
}

export function migrate(db) {
  runMigrations(db);
}

export function json(value) {
  return JSON.stringify(value);
}

export function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function withTransaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function expireLeases(db, now = new Date().toISOString()) {
  const expired = db.prepare(`
    SELECT job_id FROM job_claims
    WHERE status = 'active' AND lease_expires_at <= ?
  `).all(now);

  if (expired.length === 0) return 0;
  const jobIds = expired.map((row) => row.job_id);
  const placeholders = jobIds.map(() => "?").join(",");
  db.prepare(`UPDATE job_claims SET status = 'expired' WHERE status = 'active' AND job_id IN (${placeholders})`).run(...jobIds);
  db.prepare(`
    UPDATE jobs
    SET status = 'open', claimed_by = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE status = 'claimed' AND job_id IN (${placeholders})
  `).run(now, ...jobIds);
  return expired.length;
}
