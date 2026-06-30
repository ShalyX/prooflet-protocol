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

The dashboard workforce list is hydrated from `/dashboard` when the API is connected. The default database seeds demo agents, so the first connected view may look similar to fallback data until new agents register. The Agent Workforce panel shows `Source: API / registered agents` in connected mode, `Source: demo fallback data` in fallback mode, labels seeded agents separately from registered live agents, and labels agent payout source as `Circle wallet` or `Manual payout`.

Agent registration for the main demo should use `/agents/register-with-wallet`: it provisions a Circle wallet when Circle W3S is configured and uses the Circle wallet address as the agent payout address. `/agents/register` is the manual fallback path and does not create a Circle wallet.

Hosted API option:

```bash
$env:USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
```

The hosted API is suitable for public onboarding and dry-run batches. It runs settlement mode off and does not contain a treasury/operator private key.

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

> Tiny proofs are verified individually and become payable only after approval. Dry-run validates the exact payout plan but sends nothing. Execute mode can send real Arc Testnet USDC from an operator-controlled local environment; the hosted frontend/API does not auto-pay and no mainnet funds are involved.

### 5. Show historical evidence (5 seconds)

In the landing settlement section or dashboard, show:

- Batch `uwp_arc_20260618_001`
- `0.054 USDC` paid
- Three paid proofs
- Arc Testnet status and Arcscan links

## Full Demo Test Runner

For a broader non-recording acceptance pass, use:

```bash
npm run demo:full
```

This exercises API health, Circle config status, external issuer registration, wallet provisioning graceful-failure handling, external draft escrow jobs, unfunded claim blocking, compound jobs, all three reference workers, leaderboard/dashboard state, settlement dry-run, and production build.

## Optional Execute

Only use a funded Arc Testnet treasury and tiny amounts:

```bash
npm run settlement:daemon:execute -- --once
```

Execute still requires the explicit environment confirmation used by the daemon. It sends Arc Testnet USDC only. Rejected, pending, and already-paid proofs are excluded, and repeat scans cannot execute a settled batch twice.


## Issuer Workbench Demo Path

Use `/issuer` to show the final implemented issuer boundary:

1. Open `/issuer`.
2. Show **Prooflet Demo Issuer** mode as the working demo path.
3. Switch to **External Issuer** mode.
4. Register a fresh external issuer.
5. Show the generated issuer ID/API key, but do not expose the full API key in recordings or screenshots.
6. Show Circle issuer wallet provisioning when Circle W3S is configured, including the Circle wallet ID and separate `0x...` wallet address.
7. Show Arc Testnet USDC top-up instructions.
8. Create a draft external job.
9. Show the draft / awaiting wallet funding state and explain that it requires ProofletEscrowV2.
10. Say clearly: external draft jobs are not claimable until V2 funding exists.

External issuer onboarding, Circle issuer wallet provisioning, top-up readiness, and draft jobs are implemented. Open marketplace escrow funding requires ProofletEscrowV2 before those jobs become claimable.

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

## Escrow Lifecycle Demo (Arc Testnet)

Escrow V1 proven on Arc Testnet for a pre-assigned demo lifecycle — deploy → fund → verify → release. Open marketplace escrow funding requires ProofletEscrowV2:

| Phase | TX | Arcscan |
|---|---|---|
| Deploy | `0xcbd471...1452d3a` | [View](https://testnet.arcscan.app/tx/0xcbd471ff0ce264a66583f710ecde3ee67774856e8ae395ace0f34f2151452d3a) |
| Fund | `0x2a81fb...4404d60` | [View](https://testnet.arcscan.app/tx/0x2a81fbf3064751319c171726b19eef08880611a49dbd95e500186f9c44404d60) |
| Release | `0xed7522...4626ef9` | [View](https://testnet.arcscan.app/tx/0xed7522a39b15bf9be0a1d94a9ee4d42cc69807d5f4108cb343bb44e514626ef9) |

Contract: [`0xb3397ce196ebf553b8e951abaf75c18785c7e69a`](https://testnet.arcscan.app/address/0xb3397ce196ebf553b8e951abaf75c18785c7e69a) · Job: `job_link_1782741166956_fb45ef65` · Proof: `proof_agent_lynx_1782741794394_095f079b` · Amount: 0.002 USDC
