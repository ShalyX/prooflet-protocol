# Post-submission Development

Everything after commit `298415b1bcca803436812327a07a93e77aadb590` is post-submission development and was not part of the original Lepton Agents Hackathon submission.

The immutable archival tag is `lepton-submission-2026-07-06`.

## Current hosted durability (Neon)

The free Render API is backed by **Neon Postgres** (not a paid Render disk):

- Live `/health` reports `storage.durable: true`, `mode: neon-postgres`, `dialect: postgres`
- Restart survival was proven with a unique issuer record surviving Render redeploy
- `PROOFLET_DURABILITY_PROVEN=true` is set only after that evidence

Secrets (`DATABASE_URL`) stay in Render; never commit connection strings.

## Escrow V2 open-market path (Arc Testnet)

- Contract: `0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9`
- Protocol: fund-before-agent → on-chain verify → claimable job → operator release
- Operator CLI: `npm run escrow:v2:operator`
- Issuer Workbench: **Record Escrow V2 fund tx**
- Release receipt: `POST /jobs/:jobId/escrow-release-receipt` (on-chain verified)

### Claim → proof acceptance

```bash
npm run escrow-v2:claim-proof:check
# fund → access payment gate → claim → deterministic proof → payable
```

Live (after UI fund):

```bash
JOB_ID=job_xxx AGENT_ID=agent_xxx PRIVATE_KEY=0x... npm run escrow:v2:live-claim
```

### Full live x402 e2e

```bash
USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
PRIVATE_KEY=0x... \
npm run escrow:v2:x402-e2e
```

Proven path: draft → fundJob → fund-escrow → **circle_gateway_x402** → claim → payable proof → release.

### Circle Gateway x402 note

Access fees use Circle Gateway x402. **Seller must not equal payer**:

- Set `CIRCLE_GATEWAY_SELLER_ADDRESS` to a dedicated fee recipient
- If it equals the agent payout / treasury used to sign payments, Gateway returns `self_transfer` (`Payment verification failed`)
- Fallback rail remains Arc USDC event scan to treasury

Mainnet remains unsupported. No production audit.

## P1 historical note

Earlier post-submission work added fail-closed storage validation, backup tooling for SQLite, operational health metadata, CORS/security headers, and CI. Hosted durability later moved from free `/tmp` SQLite to Neon while staying on free Render compute.

## Operations

```bash
npm run post-submission:check
```

Hosted smoke (expect durable after Neon cutover):

```bash
PROOFLET_SMOKE_URL=https://prooflet-api.onrender.com \
PROOFLET_EXPECT_DURABLE=true \
npm run smoke:hosted
```
