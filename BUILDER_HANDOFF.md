# Prooflet Builder Handoff

Last updated: 2026-06-26

This file is for the next builder agent or human continuing Prooflet while the original Codex thread is paused. It is intentionally detailed. Read it before changing code, running settlement, or recording the final hackathon demo.

## Product Identity

- Public name: Prooflet
- Tagline: Tiny agent jobs. Verified by proof. Paid in USDC.
- Working/internal legacy name: Useful Waiting Protocol
- Package name is still `useful-waiting` for compatibility.
- Some identifiers intentionally keep `useful-waiting`, `useful_waiting_protocol`, or `uwp` prefixes. Do not deep-refactor them before submission.

Core description:

Prooflet lets issuers fund tiny AI-agent jobs, lets autonomous agents complete them, verifies objective proofs with code, routes subjective proofs through a GenLayer-ready adjudication path, and settles approved work with Arc Testnet USDC.

## Public Links

- Public GitHub repo: https://github.com/ShalyX/prooflet-protocol
- Live landing page: https://prooflet-protocol.vercel.app
- Hosted API: https://prooflet-api.onrender.com
- Render service name: `prooflet-api`
- Suggested repo name already used: `prooflet-protocol`

## Current Git State

At handoff time:

- Branch: `master`
- Remote: `origin/master`
- Working tree: clean
- Latest pushed commits:
  - `5b76d2c` Add remote settlement receipt flow
  - `78edde1` Record external hosted agent evidence

If continuing elsewhere:

```bash
git clone https://github.com/ShalyX/prooflet-protocol.git
cd prooflet-protocol
npm install
```

## Architecture Snapshot

Frontend:

- Vite app
- Public landing page at `/`
- Protocol dashboard at `/dashboard`
- Issuer workbench at `/issuer`
- Dark protocol-console visual style
- Hosted frontend points at `https://prooflet-api.onrender.com`
- Local dev defaults to `http://127.0.0.1:8787`

Backend:

- Express API v0
- SQLite persistence
- Migrations exist under `server/migrations/`
- Seeded issuer: `useful_waiting_protocol`
- Seeded issuer API key is intentionally a dev key in `server/seed.mjs`
- API-key auth is hashed in SQLite

Workers and scripts:

- Link Sentinel autonomous worker: `workers/link-sentinel.mjs`
- Settlement daemon: `workers/settlement-daemon.mjs`
- Manual Arc settlement runner: `scripts/arc-settle-batch.mjs`
- Remote hosted settlement runner: `scripts/remote-settle-batch.mjs`
- Agent registration CLI: `scripts/register-agent.mjs`
- Link job creation CLI: `scripts/create-link-job.mjs`

SDKs:

- `packages/sdk-core`
- `packages/agent-sdk`
- `packages/issuer-sdk`
- ESM packages with handwritten declarations/JSDoc. No TypeScript build step.

GenLayer path:

- Manual, `mock_genlayer`, and opt-in real `genlayer` modes exist.
- `mock_genlayer` is local acceptance only.
- Do not claim live GenLayer adjudication unless real `genlayer` mode is configured and executed.

## Critical Guardrails

Do not break these.

- Do not expose treasury/operator private keys, Circle entity secrets, or real API keys in frontend, docs, API responses, logs, uploads, screenshots, or commits.
- Do not commit `.env`.
- Do not reset the database as an upgrade path.
- Do not alter historical batch `uwp_arc_20260618_001`.
- Do not alter historical tx hashes.
- Do not change settlement behavior to execute by default.
- Dry-run must remain the default for settlement.
- Paid proofs must never become payable again.
- Rejected proofs must never be paid.
- Pending adjudication proofs must never enter settlement.
- Remote settlement must still require issuer auth and local operator confirmation.
- Arc settlement is Arc Testnet only, chain ID `5042002`, USDC `0x3600000000000000000000000000000000000000`.
- No mainnet funds are supported or represented.

## Historical Arc Testnet Evidence

Preserve exactly:

- Batch ID: `uwp_arc_20260618_001`
- Total paid: `0.054 USDC`
- Paid proofs: 3
- Network: Arc Testnet
- Status: settled

Historical transaction hashes:

- `0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552`
- `0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d`
- `0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a`

These are documented in:

- `README.md`
- `docs/SUBMISSION.md`
- `docs/JUDGE_PACKET.md`

There is still a placeholder for a fresh demo tx hash:

`FRESH_DEMO_TX_HASH_HERE`

Only replace it after a real Arc Testnet execute run.

## Hosted External Run Evidence

Builder-hosted smoke test:

- Hosted API accepted a real HTTP proof.
- Job: `job_link_1782231998353_06cc2241`
- Proof: `proof_agent_lynx_1782232027887_6b64fc05`
- Dry-run batch: `hosted_onboarding_dry_run_001`
- Payout preview: `0.001 USDC`
- No transaction sent.

Windows CLI hosted run:

- Job: `job_link_1782248660597_83e390c3`
- URL: `https://docs.arc.network`
- Agent: `agent_lynx`
- Proof: `proof_agent_lynx_1782248681573_25948009`
- Result: accepted/payable

External tester RonnyX run:

- Agent: `agent_ronny`
- Payout wallet: `0x1DcB045123730e606A88380BCe534332F50332d2`
- Job: `job_link_1782249280167_3c1efd22`
- Proof: `proof_agent_ronny_1782250283724_27e95b07`
- Result: rejected duplicate proof
- Why this matters: duplicate-proof protection and reputation/risk gating worked.

External tester RonnyX clean run:

- Agent: `agent_ronny_clean`
- Payout wallet: `0x1DcB045123730e606A88380BCe534332F50332d2`
- Job: `job_link_1782250369800_01f38d1d`
- URL: `https://httpbin.org/anything/prooflet-ronny-20260623-2131`
- Proof: `proof_agent_ronny_clean_1782250563304_5a4fc3ec`
- Result: accepted/payable
- Settlement status at handoff: awaiting Arc Testnet settlement

Evidence files:

- `docs/TESTING.md`
- `docs/JUDGE_PACKET.md`
- `docs/SUBMISSION.md`
- `docs/EXTERNAL_RUN.md`

## Important Hosted API Status

Remote settlement receipt support was pushed to GitHub, but the hosted Render API had not redeployed at the moment it was probed.

Probe that was run:

```powershell
Invoke-WebRequest -Uri 'https://prooflet-api.onrender.com/settlement-batches/probe/receipt' `
  -Method POST `
  -ContentType 'application/json' `
  -Body '{"issuerId":"useful_waiting_protocol","transactions":[]}'
```

Observed result before redeploy: `404`

Expected result after redeploy: `401` without an issuer key. That means the route exists and is correctly auth-protected.

Next builder should trigger/check Render deploy before attempting remote settlement receipt posting.

## Remote Settlement Flow

This was the desired shape:

Render API stores payable proofs
-> local operator runner fetches settlement export
-> local runner signs/sends Arc Testnet USDC
-> local runner posts settlement receipt back to Render API

Implemented files:

- `scripts/remote-settle-batch.mjs`
- `server/api.mjs`
- `server/settlement.mjs`
- `scripts/api-acceptance.mjs`
- docs updates

New scripts:

```bash
npm run settlement:remote
npm run settlement:remote:dry-run
npm run settlement:remote:execute
```

Remote settlement dry-run for Ronny clean proof:

```bash
USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
ISSUER_ID=useful_waiting_protocol \
ISSUER_API_KEY=uwp_issuer_useful_waiting_protocol_dev \
REMOTE_SETTLEMENT_PROOF_IDS=proof_agent_ronny_clean_1782250563304_5a4fc3ec \
npm run settlement:remote:dry-run
```

Windows PowerShell equivalent:

```powershell
$env:USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
$env:ISSUER_ID="useful_waiting_protocol"
$env:ISSUER_API_KEY="uwp_issuer_useful_waiting_protocol_dev"
$env:REMOTE_SETTLEMENT_PROOF_IDS="proof_agent_ronny_clean_1782250563304_5a4fc3ec"
npm run settlement:remote:dry-run
```

Execute only after reviewing dry-run:

```bash
USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
ISSUER_ID=useful_waiting_protocol \
ISSUER_API_KEY=uwp_issuer_useful_waiting_protocol_dev \
TREASURY_PRIVATE_KEY=DO_NOT_COMMIT_REAL_KEY \
CONFIRM_ARC_TESTNET_USDC_SEND=true \
REMOTE_SETTLEMENT_PROOF_IDS=proof_agent_ronny_clean_1782250563304_5a4fc3ec \
npm run settlement:remote:execute
```

The remote runner:

- Requires issuer key
- Defaults to dry-run
- Requires `CONFIRM_ARC_TESTNET_USDC_SEND=true` for execute
- Uses local `TREASURY_PRIVATE_KEY`
- Checks Arc Testnet chain ID
- Validates recipients, payout addresses, and amounts
- Refuses rejected/non-payable/already-settled proofs
- Writes local settlement state to `settlement/settlement-state.json`
- Posts receipt back to hosted API

The receipt API:

- Endpoint: `POST /settlement-batches/:batchId/receipt`
- Requires matching issuer key
- Rejects already settled batch IDs
- Requires every tx to match exported recipient and amount
- Marks proofs paid only after successful receipt validation

## Current Known Gotchas

1. Render free API uses ephemeral SQLite.
   - It is fine for public onboarding and judging demos.
   - Records may reset after redeploy/restart.
   - For durable hosted usage, move to Postgres or attach a Render disk.

2. Render may sleep/cold-start.
   - First request can timeout.
   - Re-run usually works.

3. `agent_ronny` is now risk-flagged.
   - It submitted a duplicate proof.
   - Use `agent_ronny_clean` or another fresh agent for clean payable runs.

4. Duplicate protection is strict.
   - Reusing `https://docs.arc.network` can duplicate content hash and be rejected.
   - Use unique URLs for new demo link jobs, e.g. httpbin paths with unique suffixes.

5. Hosted receipt route may need Render redeploy.
   - If `/settlement-batches/probe/receipt` returns `404`, Render is still old.
   - If it returns `401`, route is live.

6. Public docs include seeded dev issuer key for demo convenience.
   - This is not a production auth model.
   - Do not put real treasury/operator keys on Render.

## Key Commands

Install:

```bash
npm install
```

Run local API:

```bash
npm run api
```

Run frontend:

```bash
npm run dev
```

Create hosted link job:

```bash
USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
npm run job:create-link -- --url https://httpbin.org/anything/prooflet-unique-url --reward 0.001
```

Register external agent:

```bash
USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
npm run agent:register -- --agent-id agent_example_clean --name "Example Link Sentinel" --payout-address 0x0000000000000000000000000000000000000012
```

Run worker with direct flags, safest for Windows:

```bash
npm run agent:link -- --once --api-url https://prooflet-api.onrender.com --agent-id agent_example_clean --agent-api-key PASTE_AGENT_KEY
```

Run local proof/adjudication demo:

```bash
npm run genlayer:demo
npm run genlayer:demo -- --decision rejected
```

Dry-run local settlement daemon:

```bash
npm run settlement:daemon:dry-run -- --once
```

Run full check suite:

```bash
npm run submission:check
```

Other useful checks:

```bash
npm run settlement:check
npm run adjudication:check
npm run genlayer:mock-check
npm run api:check
npm run build
npm audit
```

## Environment Variables

See `.env.example`. Do not commit `.env`.

Important:

- `USEFUL_WAITING_API_URL`
- `ISSUER_ID`
- `ISSUER_API_KEY`
- `AGENT_ID`
- `AGENT_API_KEY`
- `WORKER_CAPABILITIES`
- `ARC_RPC_URL`
- `ARC_CHAIN_ID=5042002`
- `ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000`
- `TREASURY_PRIVATE_KEY`
- `TREASURY_ADDRESS`
- `CONFIRM_ARC_TESTNET_USDC_SEND=false` by default
- `REMOTE_SETTLEMENT_BATCH_ID`
- `REMOTE_SETTLEMENT_PROOF_IDS`

Never put `TREASURY_PRIVATE_KEY`, escrow operator private keys, Circle entity secrets, or real Circle API keys in frontend, Vercel, public docs, screenshots, or Render unless you are intentionally running server-side settlement there. Current intended model is local operator signing.

## Submission/Judging Files

High-priority:

- `README.md`
- `docs/SUBMISSION.md`
- `docs/JUDGE_PACKET.md`
- `docs/RECORDING.md`
- `docs/DEMO.md`
- `docs/TESTING.md`
- `docs/HOSTING.md`
- `docs/API.md`
- `docs/SECURITY.md`
- `docs/LIMITATIONS.md`
- `genlayer/README.md`

README placeholders/status to check before final:

- `FRESH_DEMO_TX_HASH_HERE`
- Demo video URL, if not already filled
- Live demo URL should stay `https://prooflet-protocol.vercel.app`
- GitHub URL should stay `https://github.com/ShalyX/prooflet-protocol`

## What To Do Next

Recommended next sequence:

1. Confirm Render deployed latest commit.
   - Probe `/settlement-batches/probe/receipt`.
   - Expected after deploy: `401`, not `404`.

2. Run remote settlement dry-run for Ronny clean proof.
   - Use `REMOTE_SETTLEMENT_PROOF_IDS=proof_agent_ronny_clean_1782250563304_5a4fc3ec`.
   - Confirm total payout is `0.001 USDC`.

3. If the operator/treasury wallet has Arc Testnet USDC and you intentionally want fresh proof:
   - Run `settlement:remote:execute`.
   - Capture tx hash.
   - Confirm hosted dashboard marks the proof paid.
   - Replace `FRESH_DEMO_TX_HASH_HERE` in README, `docs/SUBMISSION.md`, and `docs/JUDGE_PACKET.md`.
   - Update `docs/TESTING.md` with fresh settlement tx.
   - Run `npm run submission:check` and `npm audit`.
   - Commit and push.

4. Record 2-3 minute demo.
   - Follow `docs/RECORDING.md`.
   - Do not claim live GenLayer unless real GenLayer mode is actually run.
   - Say mock GenLayer is local acceptance.
   - Say dry-run sends nothing.
   - Say execute sends Arc Testnet USDC only.

5. Final submission packet:
   - GitHub URL
   - Live landing page URL
   - Demo video URL
   - Arcscan tx evidence
   - External tester evidence from RonnyX

## Demo Framing

Say this:

Prooflet turns tiny agent tasks into verified, payable work. Objective work is verified deterministically. Subjective work can route through a GenLayer-ready adjudication path. Only approved proofs become eligible for Arc Testnet USDC settlement.

For agentic behavior, emphasize:

- Worker discovers available work
- Validates API health
- Registers or validates agent identity
- Checks capability eligibility
- Claims lease-bound work
- Performs external HTTP work
- Hashes response body
- Creates structured proof
- Submits proof to API
- Waits for verification before payment eligibility

For Arc:

- USDC-denominated micro-rewards
- Arc Testnet chain ID enforced
- Dry-run by default
- Batches payable proofs
- Rejected/pending/paid proofs excluded
- Real historical Arc Testnet payout already exists

For traction:

- Public repo exists
- Public landing page exists
- Hosted API exists
- External Windows user ran worker against hosted API
- Duplicate proof rejection was observed
- Clean external proof became payable
- Fresh settlement is the remaining optional proof point

## Final Safety Reminder

This is a hackathon/testnet protocol. Keep language honest:

- Testnet USDC, not mainnet funds
- Hosted API free tier is not durable production infra
- `mock_genlayer` is not live GenLayer
- Real GenLayer is opt-in
- No private keys in browser or repo
- No automatic settlement by default

