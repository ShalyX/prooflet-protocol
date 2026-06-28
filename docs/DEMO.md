# Demo Runbook

This is the recommended one-minute hackathon path. It demonstrates funded work, autonomous execution, proof verification, reputation, and a safe Arc settlement preview without requiring a live transfer.

## Before the Demo

Install and initialize once:

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db
```

In PowerShell, use `Copy-Item .env.example .env`.

Keep these terminals open:

```bash
# Terminal 1
npm run api

# Terminal 2
npm run dev
```

Open the landing page, then keep `/dashboard` ready in the browser. Confirm the system strip says the API is connected. The seeded historical settlement remains available even if a live execute is not performed.

Hosted API option:

```bash
$env:USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
```

The hosted API is suitable for public onboarding and dry-run batches. It runs settlement mode off and does not contain a treasury private key.

## One-Minute Flow

### 1. Explain the loop (10 seconds)

Show `/` and say:

> Prooflet turns idle agent capacity into funded micro-work. Issuers reserve tiny testnet USDC rewards, autonomous agents submit measurable proof, and only accepted work reaches Arc settlement.

### 2. Create funded work (10 seconds)

```bash
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
```

Expected output includes:

```json
{
  "created": true,
  "fundedBy": "useful_waiting_protocol",
  "job": {
    "input": { "url": "https://docs.arc.network" },
    "rewardAmount": "0.001",
    "fundingStatus": "reserved",
    "status": "open"
  }
}
```

Show the new **Reserved** job in `/dashboard` or `/issuer`. Reserved means funded and not completed.

### 3. Run the autonomous agent (20 seconds)

```bash
npm run agent:link -- --once
```

Expected JSON log events:

- `api healthy`
- `agent ready`
- `claimed job`
- `task result` with HTTP status, response time, content hash, and checked time
- `proof created`
- `verification result` with `outcome: accepted`, `fundingStatus: payable`, and `settlementStatus: Awaiting Arc Testnet settlement`

Refresh `/dashboard`. Show the payable proof packet and explain that the URL was fetched by the worker, not completed through a UI button.

### 4. Preview settlement (15 seconds)

```bash
npm run settlement:daemon:dry-run -- --once
```

Expected output shows an Arc Testnet connection, excluded rejected/paid counts, batch ID, recipient, and total payout. It ends without sending a transaction.

Say:

> Tiny proofs are verified individually and settled in batches. Dry-run validates the exact payout plan but sends nothing. Execute mode can send real Arc Testnet USDC from the treasury; no mainnet funds are involved.

### 5. Show historical evidence (5 seconds)

In the landing settlement section or dashboard, show:

- Batch `uwp_arc_20260618_001`
- `0.054 USDC` paid
- Three paid proofs
- Arc Testnet status and Arcscan links

## Optional Execute

Only use a funded Arc Testnet treasury and tiny amounts:

```bash
npm run settlement:daemon:execute -- --once
```

Execute still requires the explicit environment confirmation used by the daemon. It sends Arc Testnet USDC only. Rejected, pending, and already-paid proofs are excluded, and repeat scans cannot execute a settled batch twice.

## Subjective Adjudication Talking Point

Say:

> Objective jobs use deterministic verifiers. Subjective jobs enter a pending state with no payout. Manual review remains the default; the GenLayer-ready adjudication path handles `context_compression_quality` only when real `genlayer` mode is intentionally configured. Pending or failed network requests never become payable, and Arc pays only after approval.

Safe local proof of the GenLayer-shaped lifecycle:

```bash
npm run demo:seed
```

This uses `mock_genlayer` locally and performs no GenLayer network call. It must not be presented as live GenLayer adjudication. Real `genlayer` mode is opt-in and was not executed unless explicitly configured with a deployed contract and server-side credentials.

If useful, show the proof review states in `/issuer`; do not expose the adjudicator key.

## Fallback When Execute Is Not Run Live

Do not improvise a funded transfer. Use the dry-run payout plan and historical receipts:

1. Show that the new proof is `Payable`.
2. Show the dry-run recipient and exact total.
3. Show historical batch `uwp_arc_20260618_001` and its three unchanged Arcscan transaction hashes.
4. Explain that execute is withheld during judging to avoid key exposure or faucet dependence.

This fallback still demonstrates the full protocol boundary: verified work becomes settlement-ready, while prior testnet payouts prove the execution path.

The demo seed is repeatable and non-destructive: every run uses unique, clearly labeled IDs and preserves historical batch `uwp_arc_20260618_001`. Never use `npm run db:reset` before judging.
