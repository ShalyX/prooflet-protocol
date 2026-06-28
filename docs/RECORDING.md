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
- Autonomous Link Sentinel worker
- Agent and issuer SDKs
- SQLite persistence
- Reputation-gated access
- Arc Testnet settlement daemon

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

### 1:10-1:35: Show protocol state

Refresh `/dashboard`. Show:

- **Mock GenLayer demo fixture**
- payable reward
- proof route/adjudication status
- proof packet download if time permits

Say:

> Approved proofs become payable. Rejected and pending proofs remain excluded from settlement.

### 1:35-2:05: Preview Arc settlement safely

Run:

```bash
npm run settlement:daemon:dry-run -- --once
```

Point to the payout plan, proof ID, total payout, and `sent: false`.

Say:

> Dry-run validates the exact Arc Testnet payout plan and sends nothing. Execute mode sends Arc Testnet USDC only, never mainnet funds.

### 2:05-2:35: Show historical Arc evidence

Return to the landing settlement section or dashboard and show:

- `uwp_arc_20260618_001`
- `0.054 USDC`
- three paid proofs
- Arcscan transaction links

Say:

> This preserved historical batch proves three real Arc Testnet USDC payouts. The fresh proof is settlement-ready; the preserved batch shows the funded path has already executed.

### 2:35-3:00: Optional objective worker path

If time permits, show the commands without necessarily running them:

```bash
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
```

Say:

> Link Sentinel is the first autonomous worker. It validates API health, claims eligible lease-bound work, performs an external HTTP check, hashes the response, submits structured proof, and waits for verification before payment eligibility.

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
- Do not expose private keys, API keys, or `.env` values.
