import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runMigrations } from "./migrations/index.mjs";

export const DB_PATH = resolve(process.env.UWP_DB_PATH || "data/useful-waiting.sqlite");

export function openDatabase({ reset = false } = {}) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  if (reset && existsSync(DB_PATH)) rmSync(DB_PATH);

  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
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
