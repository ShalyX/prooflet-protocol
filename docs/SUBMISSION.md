# Prooflet - Submission Summary

- Public GitHub repo: https://github.com/ShalyX/prooflet-protocol
- Demo video: `DEMO_VIDEO_URL_HERE`
- Live landing page: `LIVE_DEMO_URL_HERE`

## Short Pitch

Tiny agent jobs. Verified by proof. Paid in USDC.

Prooflet is a protocol for funding tiny AI-agent jobs, verifying their proof, adjudicating subjective work through a GenLayer-ready path, and settling approved work with Arc Testnet USDC.

## What We Built

- A public demo and live protocol console
- An issuer workbench with single-job and validated JSON/CSV upload flows
- An Express API backed by persistent SQLite migrations
- Agent and issuer registration with hashed API-key authentication
- Capability-gated claims, expiring leases, and structured proof packets
- Deterministic link and freshness verification with duplicate rejection
- Event-based reputation and access tiers
- Scoped manual adjudication plus an opt-in GenLayer contract and adapter path for context-compression quality
- Local ESM SDK packages for agents and issuers
- An autonomous Link Sentinel worker
- A dry-run-first Arc Testnet settlement daemon with locking and double-payment protection

## What Is Real

Link Sentinel performs real HTTP requests, measures response time, hashes response bodies, and submits proof through the API. Jobs, claims, proofs, reputation events, batches, transactions, and failures persist in SQLite. Approved proofs become payable; rejected and pending proofs are excluded. The settlement path has executed confirmed Arc Testnet USDC transfers.

## How Arc Is Used

Arc Testnet is the payment rail for approved micro-work. Rewards are denominated in USDC, and settlement validates Arc chain ID `5042002` plus Circle-issued testnet USDC at `0x3600000000000000000000000000000000000000`.

Arc matters because agent work can be tiny and constant. Stable USDC accounting, predictable fees, and fast finality make those small rewards understandable to issuers and practical to settle in batches.

## How Participants Connect

Issuers use the workbench, issuer SDK, or CLI to create reserved jobs with reward amounts, inputs, verification modes, and proof requirements. Autonomous agents use the agent SDK to validate identity, claim capability-matched work, honor leases, and submit proof.

Objective proofs pass deterministic checks for ownership, lease, input, required fields, job-specific results, and duplication. Subjective proofs remain pending and unpaid until the configured manual fallback or GenLayer-ready adjudication path decides them. Reputation events then update future job access.

## Agentic Behavior

The autonomous Link Sentinel worker discovers available work, validates API health, registers or validates its agent identity, checks capability eligibility, claims lease-bound work, performs external HTTP work, creates a structured proof packet, submits proof through the API, and waits for verification before payment eligibility.

Objective work is verified deterministically. Subjective work can route through the GenLayer-ready adjudication path. Only approved proofs become payable; rejected and pending proofs remain excluded from settlement.

## How Payouts Happen

Accepted unpaid proofs become payable. The settlement daemon groups them by recipient, validates every proof and amount, and prints the payout plan in dry-run mode. Execute mode acquires an atomic batch lock, sends Arc Testnet USDC, records transaction hashes, and marks only confirmed proofs paid.

Rejected, pending, already-paid, or already-settled proofs cannot enter payout. Settled batch IDs cannot execute twice.

## Arc Testnet Settlement Evidence

| Field | Evidence |
| --- | --- |
| Batch ID | `uwp_arc_20260618_001` |
| Total paid | `0.054 USDC` |
| Network | Arc Testnet |
| Paid proofs | `3` |
| Status | Settled |

Original transaction hashes remain unchanged:

- `0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552`
- `0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d`
- `0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a`

Fresh demo settlement tx hash, if execute mode is intentionally run during recording: `FRESH_DEMO_TX_HASH_HERE`.

The historical batch is preserved. Dry-run sends nothing. Execute mode sends Arc Testnet USDC only and should only be run with explicit confirmation and tiny testnet amounts.

## Safety Properties

- Dry-run is the default and sends nothing.
- Execute is Arc Testnet-only and requires explicit confirmation.
- Treasury keys never enter frontend or SDK code.
- Issuer and adjudicator authority are separate.
- Pending and rejected proofs receive no payout.
- Paid proofs cannot return to payable through settlement recording.
- Atomic locks and stable batch IDs prevent double settlement.
- Failed transfers are recorded and never marked paid.

This is testnet software and has not been production audited.

`mock_genlayer` is the local acceptance/demo path and makes no GenLayer network call. Real `genlayer` mode is opt-in and was not executed unless explicitly configured with a deployed contract and server-side credentials, so this submission does not claim a live GenLayer adjudication receipt.

## Demo Commands

```bash
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
npm run settlement:daemon:dry-run -- --once
```

For the subjective fixture path, `npm run demo:seed` safely creates a uniquely labeled mock GenLayer proof without deleting historical evidence.

Optional funded Arc Testnet execution:

```bash
npm run settlement:daemon:execute -- --once
```

## Verification

```bash
npm run submission:check
npm audit
```

The submission check exercises SDKs, reputation, manual adjudication, mock_genlayer local acceptance, uploads, settlement invariants, API behavior, autonomous job creation/worker execution, and the production frontend build without executing live settlement or live GenLayer writes.
