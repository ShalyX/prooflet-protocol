# 2-3 Minute Recording Flow

## Before Recording

Start the API and frontend in separate terminals:

```bash
npm run api
npm run dev
```

Open `/`, `/dashboard`, and `/issuer` in browser tabs. Confirm **API connected** in the dashboard system strip. Keep a third terminal ready in the repository. Do not run `db:reset`; `demo:seed` is repeatable and preserves historical batch `uwp_arc_20260618_001`.

If execute mode is intentionally run after the dry-run, paste the fresh Arc Testnet tx hash into `README.md`, `docs/SUBMISSION.md`, and `docs/JUDGE_PACKET.md` where they say `FRESH_DEMO_TX_HASH_HERE`.

## Recording Script

### 0:00-0:20: Product setup

Show `/` and say:

> Prooflet turns tiny agent tasks into verified, payable work. Issuers fund micro-jobs, autonomous agents submit proof, objective work is verified deterministically, subjective work can route through a GenLayer-ready adjudication path, and only approved proofs become eligible for Arc Testnet USDC settlement.

Show the landing CTAs, protocol loop, and settlement proof section.

### 0:20-0:45: What is real

Stay on `/` and point to:

- API-backed job queue
- External issuer/agent registration path
- Three reference workers: Link Sentinel, Freshness Clerk, and Context Press
- Agent and issuer SDKs
- SQLite persistence
- Reputation-gated access
- Arc Testnet escrow + operator-controlled settlement tooling
- Circle Gateway x402 `0.000001 USDC` access fee before job claims

Say:

> This is not just a static demo page. The local API, worker, proof ledger, reputation checks, and settlement dry-run all participate in the demo flow.

### 0:45-1:10: Create a subjective Prooflet fixture

Run:

```bash
npm run demo:seed
```

Point to `decision: approved`, `fundingStatus: payable`, and `settlementStatus: Awaiting Arc Testnet settlement`.

Say:

> This fixture creates a subjective compression job, proves the pending state, and routes evidence through `mock_genlayer` mode for local acceptance. It does not call the live GenLayer network. Real GenLayer mode is opt-in and should only be claimed if it was explicitly configured and run.


### 1:10-1:45: Issuer Workbench and external issuer boundary

Open `/issuer` and show:

- **Prooflet Demo Issuer** mode as the working demo path.
- Switch to **External Issuer** mode.
- Register a fresh external issuer.
- Show the generated issuer ID/API key, but do not zoom into or expose the full API key in the final video.
- Show Circle issuer wallet provisioning when Circle W3S is configured: Circle wallet ID and separate `0x...` wallet address.
- Show Arc Testnet USDC top-up instructions.
- Create a draft external job.
- Show draft / awaiting wallet funding / requires ProofletEscrowV2.

Say:

> External issuer onboarding, Circle issuer wallet provisioning, top-up readiness, and draft jobs are implemented. External draft jobs are not claimable until ProofletEscrowV2 funding exists. Escrow V1 is a proven pre-assigned demo escrow, not unknown-agent marketplace funding.

### 1:45-2:05: Show protocol state

Refresh `/dashboard`. Show:

- **Mock GenLayer demo fixture**
- Agent Workforce source label: `Source: API / registered agents`
- seeded demo agent badges vs registered live agent badges
- payout source badges: `Circle wallet` when `circleWalletId` exists, `Manual payout` for fallback/manual registrations
- payable reward
- proof route/adjudication status
- proof packet download if time permits

Say:

> The workforce list is hydrated from `/dashboard`. Seeded demo agents remain in the database, so they can look like fallback data, but API-connected mode says `Source: API / registered agents`. Agent onboarding should use `/agents/register-with-wallet`: it provisions a Circle wallet when Circle W3S is configured and uses that Circle wallet address as the payout address. `/agents/register` is only the manual fallback path and does not create a Circle wallet.

### 2:05-2:30: Preview Arc settlement safely

Run:

```bash
npm run settlement:daemon:dry-run -- --once
```

Point to the payout plan, proof ID, total payout, and `sent: false`.

Say:

> Dry-run validates the exact Arc Testnet payout plan and sends nothing. Execute mode sends Arc Testnet USDC only, never mainnet funds.

### 2:30-2:50: Show historical Arc evidence

Return to the landing settlement section or dashboard and show:

- `uwp_arc_20260618_001`
- `0.054 USDC`
- three paid proofs
- Arcscan transaction links

Say:

> This preserved historical batch proves three real Arc Testnet USDC payouts. The fresh proof is settlement-ready; the preserved batch shows the funded path has already executed.

### 2:50-3:00: Optional objective worker path

If time permits, run the full local demo test after the recording or show the objective commands:

```bash
npm run demo:full
# or, for only the link worker path:
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
```

Say:

> Prooflet is open to external agents. The included workers are reference agents: Link Sentinel checks links, Freshness Clerk checks freshness metadata, and Context Press compresses traces. Each worker polls for eligible lease-bound work, performs the task, submits a structured proof packet, and waits for verification before payment eligibility.

## Optional Rejection Clip

Outside the main recording, demonstrate exclusion with:

```bash
npm run demo:seed -- --decision rejected
```

The summary must show `rejected_by_mock_genlayer`, `Rejected · No payout`, and `excluded: no payout`.

## Claims To Avoid

- Do not claim live GenLayer adjudication unless real `genlayer` mode was explicitly configured and executed.
- Do not claim mainnet funds.
- Do not claim dry-run sent a transaction.
- Do not claim audited/mainnet/production Gateway settlement; Gateway x402 is implemented for the access-fee endpoint, with direct Arc USDC event scan as fallback.
- Do not claim the hosted API pays automatically; approved proofs become eligible for operator-controlled release/settlement.
- Do not expose private keys, API keys, or `.env` values.
- Do not say external issuers can fully fund open marketplace jobs today.
- Do not say Escrow V1 supports unknown-agent marketplace funding.
- Do not expose API keys.
