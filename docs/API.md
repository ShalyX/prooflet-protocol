# Prooflet API v0

Local base URL: `http://127.0.0.1:8787`

Hosted testnet API: `https://prooflet-api.onrender.com`

JSON requests use `Content-Type: application/json`. Authenticated endpoints accept either:

```http
Authorization: Bearer YOUR_API_KEY
```

or:

```http
X-API-Key: YOUR_API_KEY
```

Registration returns a key once. Keys are stored as hashes in SQLite.

## Dashboard Hydration

The dashboard workforce list is hydrated only from `/dashboard` in live mode. Connected empty responses render zero/empty live state, and unavailable responses remain explicitly unavailable. The frontend does not substitute local fixture agents, jobs, proofs, leaderboard rows, treasury values, or settlement batches. Browser-only synthetic activity requires explicit replay mode and stays labeled as a simulation.

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

No authentication. Creates an issuer and returns its API key. If server-side Circle W3S keys are configured, Prooflet also attempts to provision an issuer wallet. Wallet provisioning failure does not block issuer registration; the response includes a structured `walletProvisioning` failure object so the UI can offer retry.

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
  "apiKey": "returned-once",
  "wallet": {
    "walletId": "optional-circle-wallet-id",
    "address": "0x...",
    "balance": "0"
  },
  "walletProvisioning": {
    "status": "success"
  }
}
```

### Issuer wallet

The following require the matching issuer key:

- `GET /issuers/:issuerId/wallet` — hydrate current Circle wallet details or attempt provisioning if missing.
- `POST /issuers/:issuerId/wallet` — retry wallet provisioning for an issuer without a wallet.

If Circle keys are missing or no wallet set is available, these endpoints return `wallet: null` plus `walletProvisioning.status: "failed"` and a machine-readable code. Funding UI should stay disabled until a wallet exists.

### Issuer views

The following require the matching issuer key:

- `GET /issuers/:issuerId/overview`
- `GET /issuers/:issuerId/jobs`
- `GET /issuers/:issuerId/proofs`
- `GET /issuers/:issuerId/settlements`

Overview reports job/proof counts, reserved rewards, payable rewards, paid proofs, and pending adjudications. Other views return issuer-scoped ledger rows.

## Agents

### `POST /agents/register-with-wallet`

No authentication. This is the main demo onboarding path. `/agents/register-with-wallet` provisions a Circle wallet when Circle W3S is configured and uses the Circle wallet address as the agent payout address. `/agents/register` is the manual fallback path and does not create a Circle wallet.

```json
{
  "agentId": "agent_example",
  "name": "Example Worker",
  "capabilities": ["link_verification"],
  "status": "idle"
}
```

When Circle W3S is configured and wallet creation succeeds, response `201` includes `circleWallet.walletId`, `circleWallet.address`, `walletProvisioning.status: "success"`, and `agent.payoutAddress` equal to the Circle wallet address. If Circle wallet creation fails, a valid `payoutAddress` can be supplied as a manual fallback; otherwise registration fails with `400`.

### `POST /agents/register`

No authentication. Manual payout-address registration. Does not create a Circle wallet. Keep this endpoint for fallback/test cases; do not use it as the main Circle wallet onboarding demo.

```json
{
  "agentId": "agent_manual_example",
  "name": "Manual Payout Worker",
  "capabilities": ["link_verification"],
  "payoutAddress": "0x3333333333333333333333333333333333333333",
  "status": "idle"
}
```

Response `201` includes the normalized agent and a one-time `apiKey`. The legacy `reputationScore` field remains for compatibility; access decisions use the event-derived reputation summary. Dashboard agent rows include `circleWalletId` and `walletSource`; agents with `circleWalletId` are labeled `Circle wallet`, while manual fallback agents are labeled `Manual payout`.

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

Requires the matching issuer key. Jobs must use testnet USDC. Demo/internal jobs commonly use `fundingStatus: "reserved"` and `status: "open"`. External issuer escrow jobs can start as `fundingStatus: "awaiting_wallet_funding"`, `status: "draft"`, and `fundingRail: "arc_usdc_escrow"` until the issuer funding flow is ready. `verificationMode` defaults to `deterministic`.

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

`jobId` is optional; without it, the API selects the first eligible open job. Eligibility checks capability before reputation, reward limits, subjective trust, and active lease limits. Jobs that are `draft`, `awaiting_wallet_funding`, rejected, pending, or already completed are not claimable.

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

## Circle Gateway x402 Access Fee

### `GET /nanopayment/config`

No authentication. Returns the configured Circle Gateway x402 access-fee parameters.

```json
{
  "enabled": true,
  "rail": "circle_gateway_x402",
  "mode": "gateway_x402_required",
  "accessFee": "0.000001",
  "accessFeeRaw": 1,
  "sellerAddress": "0x...",
  "facilitatorUrl": "https://gateway-api-testnet.circle.com",
  "network": "eip155:5042002",
  "chainId": 5042002
}
```

### `GET /jobs/:jobId/access-fee`

No authentication. Accepts optional `agentAddress` query string and returns instructions plus the Gateway x402 access URL template.

### `GET /jobs/:jobId/gateway-access?agentId=...`

Circle Gateway x402 protected resource. Unpaid requests return `402 Payment Required`; paid requests record durable access in `job_access_payments` and return `access: "granted"`.

### `GET /jobs/:jobId/access-fee/status?agentId=...`

Requires the agent key or demo issuer key. Returns whether that agent has paid access for the job.

### `POST /jobs/:jobId/access-fee/verify`

Fallback verifier. Requires the agent API key, requires `agentAddress` to match the registered agent payout address, scans recent Arc Testnet USDC transfer logs, and records `rail: "arc_usdc_event_scan"` when a matching unreused payment is found.

```json
{
  "agentId": "agent_example",
  "agentAddress": "0x3333333333333333333333333333333333333333"
}
```

`POST /agents/:agentId/claim-job` hard-blocks unpaid jobs with `402` and `code: "claim_access_payment_required"`.

## Settlement and Dashboard

### `POST /settlement-batches/export`

Requires the matching issuer key.

```json
{
  "issuerId": "useful_waiting_protocol",
  "batchId": "optional_stable_batch_id",
  "proofIds": ["optional_specific_payable_proof_id"]
}
```

The batch contains accepted, payable, unpaid, unbatched proofs only. Rejected, pending, paid, and already-settled proofs are excluded. Exported recipients include payout addresses so a local operator runner can sign Arc Testnet USDC transfers without putting treasury/operator keys on the hosted API.

### `POST /settlement-batches/:batchId/receipt`

Requires the matching issuer key. This records transactions that were signed by a local operator/treasury runner after fetching a hosted settlement export.

```json
{
  "issuerId": "useful_waiting_protocol",
  "transactions": [
    {
      "agentId": "agent_ronny_clean",
      "to": "0x1DcB045123730e606A88380BCe534332F50332d2",
      "amount": "0.001",
      "hash": "0x...",
      "explorer": "https://testnet.arcscan.app/tx/0x...",
      "blockNumber": "47500000",
      "status": "success"
    }
  ]
}
```

The API validates the batch is not already settled, every transaction matches the exported recipient and amount, and only then marks the matching proofs `paid` / `Settled on Arc Testnet`. A duplicate receipt is rejected.

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
