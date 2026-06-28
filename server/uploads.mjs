import { createHash, randomUUID } from "node:crypto";
import { formatUnits, parseUnits } from "viem";
import { json, parseJson, withTransaction } from "./db.mjs";
import { requiredAccessLevel } from "./access-policy.mjs";

export const UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;
export const UPLOAD_ROW_LIMIT = 500;

export function validateUpload(db, issuerId, payload) {
  const filename = sanitizeFilename(payload?.filename || "jobs.json");
  const format = String(payload?.format || "json").toLowerCase();
  const content = payload?.content;
  if (!["json", "csv"].includes(format)) throw uploadError(400, "format must be json or csv.");
  if (typeof content !== "string" || !content.trim()) throw uploadError(400, "content is required.");
  if (Buffer.byteLength(content) > UPLOAD_LIMIT_BYTES) throw uploadError(413, "Upload exceeds the 2 MiB limit.");
  const rawRows = format === "json" ? parseJsonUpload(content) : parseCsv(content);
  if (rawRows.length > UPLOAD_ROW_LIMIT) throw uploadError(413, `Upload exceeds ${UPLOAD_ROW_LIMIT} rows.`);
  const seen = new Set();
  const rows = rawRows.map((raw, index) => validateRow(db, issuerId, raw, index + 1, seen));
  const valid = rows.filter((row) => row.errors.length === 0);
  const totalReward = valid.reduce((sum, row) => sum + parseUnits(row.job.rewardAmount, 6), 0n);
  const uploadId = `upload_${randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86400000).toISOString();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO issuer_uploads
      (upload_id,issuer_id,filename,format,status,total_rows,valid_rows,invalid_rows,total_reward,content_hash,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(uploadId, issuerId, filename, format, "validated", rows.length, valid.length, rows.length - valid.length, formatUnits(totalReward, 6), createHash("sha256").update(content).digest("hex"), expiresAt, now.toISOString());
    const insert = db.prepare("INSERT INTO issuer_upload_rows (upload_id,row_number,job_json,errors_json,valid) VALUES (?,?,?,?,?)");
    for (const row of rows) insert.run(uploadId, row.rowNumber, row.job ? json(row.job) : null, json(row.errors), row.errors.length ? 0 : 1);
  });
  return uploadResponse(db, uploadId);
}

export function confirmUpload(db, issuerId, uploadId, payload = {}) {
  const mode = payload.mode || "strict";
  if (!["strict", "validOnly"].includes(mode)) throw uploadError(400, "mode must be strict or validOnly.");
  if (mode === "validOnly" && payload.acknowledgeInvalidRows !== true) throw uploadError(400, "validOnly confirmation requires acknowledgeInvalidRows=true.");
  return withTransaction(db, () => {
    const upload = db.prepare("SELECT * FROM issuer_uploads WHERE upload_id=? AND issuer_id=?").get(uploadId, issuerId);
    if (!upload) throw uploadError(404, `Upload ${uploadId} does not exist.`);
    if (upload.status === "confirmed") return uploadResponse(db, uploadId);
    if (upload.expires_at <= new Date().toISOString()) throw uploadError(410, "Upload preview expired.");
    if (mode === "strict" && upload.invalid_rows > 0) throw uploadError(409, "Strict confirmation requires every row to be valid.");
    const rows = db.prepare("SELECT * FROM issuer_upload_rows WHERE upload_id=? AND valid=1 ORDER BY row_number").all(uploadId);
    const created = [];
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO jobs
      (job_id,issuer_id,job_type,input_json,reward_amount,reward_asset,network,funding_status,status,proof_requirements_json,verification_mode,required_access_level,created_at,updated_at)
      VALUES (?,?,?,?,?,'USDC','Arc Testnet','reserved','open',?,?,?,?,?)`);
    for (const row of rows) {
      const job = parseJson(row.job_json, {});
      insert.run(job.jobId, issuerId, job.jobType, json(job.input), job.rewardAmount, json(job.proofRequirements), job.verificationMode, job.requiredAccessLevel, now, now);
      created.push(job.jobId);
    }
    db.prepare("UPDATE issuer_uploads SET status='confirmed',confirmation_mode=?,created_job_ids_json=?,confirmed_at=? WHERE upload_id=?").run(mode, json(created), now, uploadId);
    return uploadResponse(db, uploadId);
  });
}

export function uploadResponse(db, uploadId) {
  const upload = db.prepare("SELECT * FROM issuer_uploads WHERE upload_id=?").get(uploadId);
  const rows = db.prepare("SELECT * FROM issuer_upload_rows WHERE upload_id=? ORDER BY row_number").all(uploadId).map((row) => ({ rowNumber: row.row_number, valid: Boolean(row.valid), job: parseJson(row.job_json, null), errors: parseJson(row.errors_json, []) }));
  return { uploadId, filename: upload.filename, format: upload.format, status: upload.status, totalRows: upload.total_rows, validRows: upload.valid_rows, invalidRows: upload.invalid_rows, totalRewardRequired: upload.total_reward, expiresAt: upload.expires_at, confirmationMode: upload.confirmation_mode, createdJobIds: parseJson(upload.created_job_ids_json, []), rows };
}

function validateRow(db, issuerId, raw, rowNumber, seen) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { rowNumber, job: null, errors: ["Row must be an object."] };
  const jobId = String(raw.jobId || "").trim();
  const jobType = String(raw.jobType || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(jobId)) errors.push("jobId is invalid.");
  if (!jobType) errors.push("jobType is required.");
  if (seen.has(jobId)) errors.push("Duplicate jobId inside upload."); else seen.add(jobId);
  if (jobId && db.prepare("SELECT 1 FROM jobs WHERE job_id=?").get(jobId)) errors.push("jobId already exists.");
  const input = objectValue(raw.input, "input", errors);
  const proofRequirements = objectValue(raw.proofRequirements, "proofRequirements", errors);
  const verificationMode = raw.verificationMode || "deterministic";
  if (!["deterministic", "subjective"].includes(verificationMode)) errors.push("verificationMode must be deterministic or subjective.");
  let rewardAmount;
  try { const amount = parseUnits(String(raw.rewardAmount), 6); if (amount <= 0n) throw new Error(); rewardAmount = formatUnits(amount, 6); } catch { errors.push("rewardAmount must be positive USDC with at most 6 decimals."); }
  const required = rewardAmount ? requiredAccessLevel(rewardAmount, verificationMode) : null;
  if (rewardAmount && !required) errors.push("rewardAmount exceeds the v0 maximum of 0.10 USDC.");
  return { rowNumber, errors, job: { jobId, issuerId, jobType, input, rewardAmount, rewardAsset: "USDC", network: "Arc Testnet", proofRequirements, verificationMode, requiredAccessLevel: required } };
}

function objectValue(value, name, errors) {
  let parsed = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { errors.push(`${name} must contain valid JSON.`); return {}; } }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { errors.push(`${name} must be an object.`); return {}; }
  return parsed;
}

function parseJsonUpload(content) { let parsed; try { parsed = JSON.parse(content); } catch { throw uploadError(400, "Upload contains invalid JSON."); } const rows = Array.isArray(parsed) ? parsed : parsed?.jobs; if (!Array.isArray(rows)) throw uploadError(400, "JSON must be an array or an object with a jobs array."); return rows; }
function parseCsv(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = csvLine(lines.shift());
  return lines.map((line) => Object.fromEntries(headers.map((header, index) => [header.trim(), csvLine(line)[index] || ""])));
}
function csvLine(line) { const fields=[]; let value="",quoted=false; for(let i=0;i<line.length;i++){const char=line[i];if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(char===","&&!quoted){fields.push(value);value="";}else value+=char;}fields.push(value);return fields; }
function sanitizeFilename(value) { return String(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120); }
function uploadError(status, message) { const error = new Error(message); error.status = status; return error; }
