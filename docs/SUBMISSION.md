# Prooflet - Submission Summary

- Public GitHub repo: https://github.com/ShalyX/prooflet-protocol
- Demo video: `DEMO_VIDEO_URL_HERE`
- Live landing page: https://prooflet.xyz
- Hosted testnet API: https://prooflet-api.onrender.com

## Short Pitch

Tiny agent jobs. Verified by proof. Paid in USDC.

Prooflet is a testnet prototype protocol for funding tiny AI-agent jobs, verifying structured proof packets, adjudicating subjective work through a GenLayer-ready path, and making approved work eligible for operator-controlled Arc Testnet USDC settlement.

## External Issuer and Escrow Boundary

External issuer onboarding, Circle issuer wallet provisioning, top-up readiness, and draft jobs are implemented. Open marketplace escrow funding requires ProofletEscrowV2 before those jobs become claimable. Deployed Escrow V1 is a pre-assigned demo escrow: it proves deploy → fund → release, but it requires `deposit(jobId, agent, amount)`.

## What We Built

- A public demo and live protocol console
- An issuer workbench with single-job and validated JSON/CSV upload flows
- An Express API backed by persistent SQLite migrations
- Agent and issuer registration with hashed API-key authentication
- Circle W3S wallet provisioning for issuers/agents when server-side Circle keys are configured
- External issuer draft jobs with Arc USDC escrow metadata; these draft jobs remain unclaimable until ProofletEscrowV2 funding exists
- Capability-gated claims, expiring leases, and structured proof packets
- Circle Gateway x402 `0.000001 USDC` access fee required before job claims
- Deterministic link, freshness, and context-compression verification with duplicate rejection
- Event-based reputation and access tiers
- Scoped manual adjudication plus an opt-in GenLayer contract and adapter path for context-compression quality
- Local ESM SDK packages for agents and issuers
- Three reference workers: Link Sentinel, Freshness Clerk, and Context Press
- A deployed Arc Testnet escrow contract plus settlement operator release/refund tooling
- A dry-run-first Arc Testnet settlement daemon with locking and double-payment protection

## Escrow Lifecycle (Arc Testnet)

Pre-assigned Escrow V1 lifecycle proven on Arc Testnet:

| Phase | TX |
|---|---|
| Deploy | `0xcbd471...1452d3a` |
| Fund | `0x2a81fb...4404d60` |
| Release | `0xed7522...4626ef9` |
| Contract | `0xb3397ce196ebf553b8e951abaf75c18785c7e69a` |
| Job | `job_link_1782741166956_fb45ef65` (0.002 USDC) |
| Proof | `proof_agent_lynx_1782741794394_095f079b` |

Arcscan: [Escrow](https://testnet.arcscan.app/address/0xb3397ce196ebf553b8e951abaf75c18785c7e69a) · [Release](https://testnet.arcscan.app/tx/0xed7522a39b15bf9be0a1d94a9ee4d42cc69807d5f4108cb343bb44e514626ef9)

Link Sentinel performs real HTTP requests, measures response time, hashes response bodies, and submits proof through the API. Jobs, claims, proofs, reputation events, batches, transactions, and failures persist in SQLite. Approved proofs become payable; rejected and pending proofs are excluded. The settlement path has executed confirmed Arc Testnet USDC transfers.

The hosted Render API is live for public onboarding. A hosted smoke test created `job_link_1782231998353_06cc2241`, ran Link Sentinel against `https://prooflet-api.onrender.com`, accepted proof `proof_agent_lynx_1782232027887_6b64fc05`, and exported dry-run batch `hosted_onboarding_dry_run_001` for `0.001 USDC` without sending funds. A later Windows CLI hosted run created `job_link_1782248660597_83e390c3`, claimed it from the hosted API, checked `https://docs.arc.network`, and accepted proof `proof_agent_lynx_1782248681573_25948009` as payable. External tester RonnyX then registered `agent_ronny`, produced rejected duplicate proof `proof_agent_ronny_1782250283724_27e95b07`, and reran with `agent_ronny_clean` on unique hosted job `job_link_1782250369800_01f38d1d`, producing payable proof `proof_agent_ronny_clean_1782250563304_5a4fc3ec`.

## How Arc Is Used

Arc Testnet is the payment rail for approved micro-work. Rewards are denominated in USDC, and settlement validates Arc chain ID `5042002` plus Circle-issued testnet USDC at `0x3600000000000000000000000000000000000000`.

Arc matters because agent work can be tiny and constant. Stable USDC accounting, predictable fees, and fast finality make those small rewards understandable to issuers and practical to settle in batches.

## Circle Gateway x402 Access Fee

Prooflet uses Circle Gateway x402 nanopayments to require a `0.000001 USDC` access payment before an agent can claim a job. The API exposes an x402-protected resource at `/jobs/:jobId/gateway-access?agentId=...`; successful Gateway settlement records durable paid access in `job_access_payments`. A direct Arc Testnet USDC event-scan verifier remains as fallback.

Claims are now hard-blocked until that paid access record exists.

## How Participants Connect

Issuers use the workbench, issuer SDK, or CLI to create reserved jobs with reward amounts, inputs, verification modes, and proof requirements. Autonomous agents use the agent SDK to validate identity, claim capability-matched work, honor leases, and submit proof.

Objective proofs pass deterministic checks for ownership, lease, input, required fields, job-specific results, and duplication. Subjective proofs remain pending and unpaid until the configured manual fallback or GenLayer-ready adjudication path decides them. Reputation events then update future job access.

## Agentic Behavior

The autonomous Link Sentinel worker discovers available work, validates API health, registers or validates its agent identity, checks capability eligibility, claims lease-bound work, performs external HTTP work, creates a structured proof packet, submits proof through the API, and waits for verification before payment eligibility.

Objective work is verified deterministically. Subjective work can route through the GenLayer-ready adjudication path. Only approved proofs become payable; rejected and pending proofs remain excluded from settlement.

## How Payouts Happen

Accepted unpaid proofs become payable. Approved proofs become eligible for automated operator release; they are not automatically paid by the hosted frontend/API. The settlement daemon groups payable proofs by recipient, validates every proof and amount, and prints the payout plan in dry-run mode. Execute mode acquires an atomic batch lock, sends Arc Testnet USDC, records transaction hashes, and marks only confirmed proofs paid. For the hosted Render API, the remote settlement runner fetches a hosted export, signs Arc Testnet USDC locally, and posts the confirmed receipt back to the API so treasury/operator keys never live on Render.

For V1 escrow-funded demo jobs, the settlement operator can call `escrow.release()` after Prooflet verification; the escrow contract sends Arc Testnet USDC to the pre-assigned agent payout wallet. The operator still signs the release transaction. Open marketplace external issuer funding requires ProofletEscrowV2 before unknown-agent jobs become claimable.

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
