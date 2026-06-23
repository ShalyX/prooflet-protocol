# Prooflet Judge Packet

## Project

- Project name: Prooflet
- One-line pitch: Tiny agent jobs. Verified by proof. Paid in USDC.
- Short description: Prooflet is a protocol for funding tiny AI-agent jobs, verifying their proof, adjudicating subjective work through a GenLayer-ready path, and settling approved work with Arc Testnet USDC.
- Public GitHub repo: https://github.com/ShalyX/prooflet-protocol
- Demo video: `DEMO_VIDEO_URL_HERE`
- Live landing page: https://prooflet-protocol.vercel.app
- Hosted testnet API: https://prooflet-api.onrender.com

## Local Run Instructions

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db
npm run api
npm run dev
```

Open `/` for the landing page, `/dashboard` for protocol state, and `/issuer` for the issuer workbench. Keep private keys in `.env` only; never paste them into the browser.

## Demo Commands

```bash
npm run agent:check
npm run demo:seed
npm run settlement:daemon:dry-run -- --once
```

Objective worker path:

```bash
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
npm run settlement:daemon:dry-run -- --once
```

## Arc Testnet Evidence

Historical batch `uwp_arc_20260618_001` remains preserved:

- Network: Arc Testnet
- Total paid: `0.054 USDC`
- Paid proofs: `3`
- Status: Settled
- `0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552`
- `0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d`
- `0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a`

Fresh demo settlement tx hash, if execute mode is intentionally run during recording: `FRESH_DEMO_TX_HASH_HERE`.

Dry-run sends nothing. Execute mode sends Arc Testnet USDC only and requires explicit confirmation.

## Hosted Onboarding Evidence

The Render-hosted API was smoke-tested on June 23, 2026:

- Hosted API health returned `{ "ok": true, "protocol": "Prooflet", "version": "v0" }`.
- `job:create-link` created `job_link_1782231998353_06cc2241` with `https://docs.arc.network` and `0.001 USDC`.
- Link Sentinel claimed the hosted job, performed a real HTTP check, hashed the response body, and submitted proof `proof_agent_lynx_1782232027887_6b64fc05`.
- The API verified the proof as `accepted` and marked it `payable`.
- Hosted settlement batch export produced `hosted_onboarding_dry_run_001` with `totalPayout: "0.001"` and no transaction sent.
- A later Windows CLI hosted run created `job_link_1782248660597_83e390c3`, claimed it from the hosted API, checked `https://docs.arc.network`, and produced payable proof `proof_agent_lynx_1782248681573_25948009`.

External tester instructions are in `docs/EXTERNAL_RUN.md`. Tester handle and payout-wallet confirmation are still pending before claiming paid external-user settlement.

## GenLayer Path

Prooflet includes a GenLayer-ready adjudication path for subjective `context_compression_quality` proofs. `mock_genlayer` mode is the local acceptance/demo path and performs no GenLayer network call. Real `genlayer` mode is opt-in and was not executed unless explicitly configured with a deployed contract and server-side credentials.

## Known Limitations

- Arc settlement is testnet only.
- SQLite is local persistence for the hackathon test phase.
- Link Sentinel is the first autonomous worker; broader workers are future work.
- External issuer funding reconciliation is not production escrow.
- No production security audit has been performed.
- `mock_genlayer` is not a live GenLayer adjudication receipt.

## Verification Checks

```bash
npm run submission:check
npm run settlement:check
npm run adjudication:check
npm run genlayer:mock-check
npm run build
npm audit
```
