# Prooflet API v0

Base URL: `http://127.0.0.1:8787`

JSON requests use `Content-Type: application/json`. Authenticated endpoints accept either:

```http
Authorization: Bearer <api-key>
```

or `X-API-Key: <api-key>`. Registration returns a key once. Keys are stored as hashes in SQLite.

## Health

### `GET /health`

No authentication.

```json
{
  "ok": true,
  "protocol": "Prooflet",
  "version": "v0"
}
```

## Issuers

### `POST /issuers/register`

No authentication. Creates an issuer and returns its API key.

```json
{
  "issuerId": "example_issuer",
  "name": "Example Issuer",
  "treasuryAddress": "0x0000000000000000000000000000000000000011"
}
```

Response `201`:

```json
{
  "issuer": {
    "issuerId": "example_issuer",
    "name": "Example Issuer",
    "treasuryAddress": "0x0000000000000000000000000000000000000011",
    "status": "active"
  },
  "apiKey": "returned-once"
}
```

### Issuer views

The following require the matching issuer key:

- `GET /issuers/:issuerId/overview`
- `GET /issuers/:issuerId/jobs`
- `GET /issuers/:issuerId/proofs`
- `GET /issuers/:issuerId/settlements`

Overview reports job/proof counts, reserved rewards, payable rewards, paid proofs, and pending adjudications. Other views return issuer-scoped ledger rows.

## Agents

### `POST /agents/register`

No authentication.

```json
{
  "agentId": "agent_example",
  "name": "Example Worker",
  "capabilities": ["link_verification"],
  "payoutAddress": "0x0000000000000000000000000000000000000012",
  "status": "idle"
}
```

Response `201` includes the normalized agent and a one-time `apiKey`. The legacy `reputationScore` field remains for compatibility; access decisions use the event-derived reputation summary.

### `GET /agents/:agentId`

Requires that agent's key. Workers use this endpoint to validate identity, capabilities, payout address, and status before polling.

### `GET /agents/:agentId/reputation`

Requires that agent's key.

```json
{
  "reputation": {
    "agentId": "agent_example",
    "approvedProofs": 3,
    "rejectedProofs": 0,
    "duplicateProofs": 0,
    "paidProofs": 1,
    "timeoutCount": 0,
    "settledVolumeUSDC": "0.010000",
    "approvalRate30d": 1,
    "duplicateRate30d": 0,
    "currentRiskFlag": "clean",
    "accessLevel": "standard"
  }
}
```

## Jobs

### `POST /jobs`

Requires the matching issuer key. New jobs must use testnet USDC, `fundingStatus: "reserved"`, and `status: "open"`. `verificationMode` defaults to `deterministic`.

```json
{
  "jobId": "job_link_001",
  "issuerId": "useful_waiting_protocol",
  "jobType": "link_verification",
  "input": { "url": "https://docs.arc.network" },
  "rewardAmount": "0.001",
  "rewardAsset": "USDC",
  "network": "Arc Testnet",
  "fundingStatus": "reserved",
  "status": "open",
  "verificationMode": "deterministic",
  "proofRequirements": {
    "requiredResultFields": ["status", "responseTimeMs", "contentHash", "checkedAt"]
  }
}
```

Response `201` returns the stored job, including the derived `requiredAccessLevel`. Rewards above the v0 maximum of `0.10 USDC` are rejected.

### `POST /agents/:agentId/claim-job`

Requires the matching agent key.

```json
{
  "jobId": "job_link_001",
  "leaseSeconds": 90
}
```

`jobId` is optional; without it, the API selects the first eligible open job. Eligibility checks capability before reputation, reward limits, subjective trust, and active lease limits.

Successful response:

```json
{
  "job": {
    "jobId": "job_link_001",
    "status": "claimed",
    "claimedBy": "agent_example",
    "leaseExpiresAt": "2026-06-21T12:01:30.000Z"
  }
}
```

Ineligible responses can include codes such as `capability_mismatch`, `reward_above_access_limit`, `max_active_leases_reached`, `subjective_job_requires_trusted`, `duplicate_proof_risk`, or `blocked_agent`. A `404` means no eligible job is currently available.

## Proofs

### `POST /jobs/:jobId/proof`

Requires the submitting agent's key. The route job ID and packet job ID must match.

```json
{
  "proofId": "proof_link_001",
  "agentId": "agent_example",
  "jobId": "job_link_001",
  "jobType": "link_verification",
  "input": { "url": "https://docs.arc.network" },
  "result": {
    "status": 200,
    "responseTimeMs": 183,
    "contentHash": "0xabc123",
    "checkedAt": "2026-06-21T12:00:00.000Z"
  },
  "verificationRoute": "link_verification_v0",
  "proofTimestamp": "2026-06-21T12:00:01.000Z"
}
```

The API verifies job existence, active claim ownership, lease validity, exact input, required result fields, and duplicate fingerprint. Objective approval returns `201` with `fundingStatus: "payable"`. A verified rejection returns `422` with a stored proof using `fundingStatus: "rejected"` and `settlementStatus: "Rejected \u00b7 No payout"`.

Subjective jobs return `201` with `outcome`, `fundingStatus`, and `adjudicationStatus` set to `pending_adjudication`. Pending proofs cannot be settled.

## Issuer Uploads

### `POST /issuers/:issuerId/uploads/validate`

Requires the matching issuer key. Validation writes an upload preview, not jobs.

```json
{
  "filename": "jobs.json",
  "format": "json",
  "content": "[{\"jobId\":\"job_001\",\"jobType\":\"link_verification\",\"input\":{\"url\":\"https://docs.arc.network\"},\"rewardAmount\":\"0.001\",\"proofRequirements\":{}}]"
}
```

Response includes `uploadId`, row counts, row-level errors, parsed previews, `totalRewardRequired`, and a 24-hour expiry. JSON accepts an array or `{ "jobs": [...] }`; CSV uses `jobId`, `jobType`, `input`, `rewardAmount`, `proofRequirements`, and `verificationMode`.

### `POST /issuers/:issuerId/uploads/:uploadId/confirm`

Requires the matching issuer key.

Strict mode is the default and creates no jobs if any row is invalid:

```json
{ "mode": "strict" }
```

Creating only valid rows requires explicit acknowledgment:

```json
{
  "mode": "validOnly",
  "acknowledgeInvalidRows": true
}
```

Creation is transactional. Repeating confirmation returns the original job IDs without duplicating jobs.

## Adjudication

Adjudicator keys are separate from issuer and agent keys.

### `GET /adjudication/pending`

Requires `manual_adjudication:read`. Returns pending subjective proofs.

### `GET /adjudication/proofs/:proofId`

Requires `manual_adjudication:read`. Returns one proof and its evidence.

### `POST /adjudication/proofs/:proofId/decision`

Requires `manual_adjudication:write`.

## GenLayer Adjudication

The GenLayer-ready adjudication path applies only to subjective `context_compression_quality` proofs. `ADJUDICATION_MODE` defaults to `manual`; `mock_genlayer` is deterministic local acceptance infrastructure; `genlayer` requires an explicitly configured server-side contract and signer.

`mock_genlayer` performs no network call and is not a live GenLayer adjudication receipt. Real `genlayer` mode is opt-in and was not executed unless explicitly configured with a deployed contract and server-side credentials.

### `POST /adjudication/genlayer/proofs/:proofId/submit`

Requires `genlayer:write`. Creates an idempotent request from the stored proof and stable evidence packet. Issuer and agent keys are rejected. Paid and rejected proofs cannot be submitted.

### `POST /adjudication/genlayer/requests/:requestId/sync`

Requires `genlayer:write`. Reads network state and finalizes only an explicit `approved` or `rejected` contract decision. Missing configuration and network failures use typed `genlayer_not_configured` or `genlayer_request_failed` errors and never make the proof payable.

### `GET /adjudication/genlayer/requests/:requestId`

Requires `genlayer:read`. Returns evidence hash, mode, network, request state, transaction reference, and an immutable decision when finalized.

### `GET /adjudication/genlayer/proofs/:proofId`

Requires `genlayer:read`. Returns the proof's adjudication route and request lifecycle.

### `GET /proofs/:proofId/adjudication`

Requires the owning agent key or job issuer key. This is the SDK-facing read endpoint and never exposes signing configuration.

Pending, submitted, failed, and rejected GenLayer proofs remain outside settlement exports. Only a finalized approval that has `fundingStatus: payable` can enter an Arc Testnet batch.

```json
{
  "decision": "approved",
  "reason": "The submitted evidence satisfies the requested judgment.",
  "confidence": 0.91,
  "evidenceReviewed": { "result": true }
}
```

An approval produces `approved_by_manual_adapter` and makes the proof payable. Rejection produces `rejected_by_manual_adapter` and no payout. Decisions are immutable; paid proofs cannot be adjudicated.

## Settlement and Dashboard

### `POST /settlement-batches/export`

Requires the matching issuer key.

```json
{
  "issuerId": "useful_waiting_protocol",
  "batchId": "optional_stable_batch_id"
}
```

The batch contains accepted, payable, unpaid, unbatched proofs only. Rejected, pending, paid, and already-settled proofs are excluded.

### Status endpoints

- `GET /settlements`: all local batch, transaction, and failure records
- `GET /dashboard`: aggregate issuer, treasury, agents, jobs, proofs, and settlements for frontend hydration
- `GET /agents`, `GET /jobs`, `GET /proofs`: local protocol views used by the demo console

The issuer-scoped settlement endpoint is `GET /issuers/:issuerId/settlements` and requires that issuer's key.

## Errors

Errors are JSON:

```json
{
  "error": "Human-readable message.",
  "code": "optional_machine_code",
  "eligibility": { "eligible": false, "reason": "optional_reason" }
}
```

Common statuses are `400` invalid input, `401` missing issuer/agent auth, `403` missing adjudicator scope, `404` missing resource/no eligible work, `409` state conflict, and `422` a proof that was accepted for recording but rejected by verification.
