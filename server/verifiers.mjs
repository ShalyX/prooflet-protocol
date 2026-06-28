import { createHash } from "node:crypto";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function proofFingerprint(proof) {
  const reusableResult = proof.result?.contentHash || proof.result?.semanticChecksum || proof.result;
  return createHash("sha256")
    .update(canonicalJson({ jobType: proof.jobType, input: proof.input, result: reusableResult }))
    .digest("hex");
}

export function verifyProof(job, proof, requirements) {
  const missing = requiredFields(requirements?.requiredResultFields || [], proof.result);
  if (missing.length > 0) return reject(`Missing required result field(s): ${missing.join(", ")}.`);

  if (proof.jobType !== job.jobType) return reject("Proof jobType does not match the claimed job.");
  if (canonicalJson(proof.input) !== canonicalJson(job.input)) return reject("Proof input does not match the job input.");

  if (job.jobType === "link_verification") {
    const status = Number(proof.result?.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) return reject("Link proof requires a valid HTTP status.");
    if (!Number.isFinite(Number(proof.result?.responseTimeMs)) || Number(proof.result.responseTimeMs) < 0) {
      return reject("Link proof requires a non-negative responseTimeMs.");
    }
    if (!/^0x[0-9a-f]+$/i.test(String(proof.result?.contentHash || ""))) return reject("Link proof requires a hexadecimal contentHash.");
    if (status >= 400) return reject(`Link verification returned HTTP ${status}.`);
    return approve("link_verification_v0");
  }

  if (job.jobType === "freshness_check") {
    if (Number.isNaN(Date.parse(proof.result?.lastModified))) return reject("Freshness proof requires a valid lastModified timestamp.");
    if (typeof proof.result?.stale !== "boolean") return reject("Freshness proof requires a boolean stale result.");
    if (proof.result.stale) return reject("Source is stale and does not satisfy the freshness requirement.");
    return approve("freshness_check_v0");
  }

  if (job.jobType === "context_compression") {
    const orig = Number(proof.result?.originalLength);
    const comp = Number(proof.result?.compressedLength);
    const ratio = Number(proof.result?.compressionRatio);
    if (!Number.isFinite(orig) || orig <= 0) return reject("Context compression proof requires a positive originalLength.");
    if (!Number.isFinite(comp) || comp <= 0) return reject("Context compression proof requires a positive compressedLength.");
    if (comp >= orig) return reject("Compressed output must be shorter than original input.");
    if (!Number.isFinite(ratio) || ratio <= 0) return reject("Context compression must have a positive compression ratio.");
    if (!/^0x[0-9a-f]+$/i.test(String(proof.result?.semanticChecksum || ""))) return reject("Context compression requires a hexadecimal semanticChecksum.");
    return approve("context_compression_v0");
  }

  if (job.jobType === "duplicate_proof") return reject("Duplicate proof jobs are rejection fixtures and never receive payout.", "duplicate_proof_v0");
  return reject(`No deterministic verifier exists for ${job.jobType}.`);
}

function requiredFields(fields, result) {
  return fields.filter((path) => path.split(".").reduce((value, key) => value?.[key], result) == null);
}

function approve(route) {
  return { approved: true, route, reason: null };
}

function reject(reason, route = "deterministic_v0") {
  return { approved: false, route, reason };
}
