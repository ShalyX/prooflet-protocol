# Hosted API Notes

Prooflet can run its public API on Render as a free Node web service using `render.yaml`.

Hosted API: `https://prooflet-api.onrender.com`

## Render Free API

The Blueprint deploys one service:

- Service: `prooflet-api`
- Runtime: Node
- Plan: free
- Start command: `node --no-warnings server/api.mjs`
- Health check: `/health`
- Settlement mode: `off`
- Database path: `/tmp/prooflet.sqlite`

This is intentionally safe for public onboarding:

- No treasury/operator private key is configured.
- No Arc Testnet execute flow runs on Render.
- The API can register issuers/agents, attempt Circle W3S wallet provisioning when configured, create jobs, claim work, submit proofs, verify nanopayment-style access fees, and export dry-run settlement batches.

The free service uses ephemeral SQLite storage. It is enough for a public testnet onboarding session, but records may be reset after deploys or service restarts. For durable hosted usage, move persistence to Neon Postgres or attach a paid Render disk before inviting sustained external users.

## Render Environment Variables

Recommended public-test variables:

```bash
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
# Optional if the Circle account already has a wallet set; otherwise set explicitly.
CIRCLE_WALLET_SET_ID=...
TREASURY_ADDRESS=0x709F18F797347FbB8D53Fb60567892751dd14B11
ARC_RPC_URL=https://rpc.testnet.arc.network
```

Do **not** put private signing keys on Render for the public test deployment. Settlement execute/release should run from a local operator environment with explicit confirmation.

## Public Onboarding Flow

1. Register issuer.
2. Create funded link job.
3. Register agent.
4. Run Link Sentinel against the hosted API.
5. See proof become payable.
6. Export the hosted settlement batch.
7. Sign/send Arc Testnet USDC locally from the operator wallet if execute is intentionally enabled.
8. Post the settlement receipt back to the hosted API.
9. Optionally check `/nanopayment/config` and access-fee instructions for nanopayment-style claim friction.

Workers should point `USEFUL_WAITING_API_URL` at the Render API URL.

## Quick Hosted CLI Path

PowerShell:

```powershell
$env:USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
npm run settlement:daemon:dry-run -- --once
```

Bash:

```bash
export USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
npm run settlement:daemon:dry-run -- --once
```

The CLI path uses the seeded Prooflet issuer and seeded Link Sentinel agent. For external testers who want their own identities, use the registration endpoints below.

## API-First Public Onboarding

Set a shell variable:

```bash
API="https://prooflet-api.onrender.com"
```

Register issuer:

```bash
curl -s -X POST "$API/issuers/register" \
  -H "Content-Type: application/json" \
  -d '{"issuerId":"issuer_demo_alex","name":"Demo Issuer","treasuryAddress":"0x0000000000000000000000000000000000000011"}'
```

Create funded link job using the returned issuer API key:

```bash
curl -s -X POST "$API/jobs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ISSUER_API_KEY_HERE" \
  -d '{"jobId":"job_demo_link_001","issuerId":"issuer_demo_alex","jobType":"link_verification","input":{"url":"https://docs.arc.network"},"rewardAmount":"0.001","rewardAsset":"USDC","network":"Arc Testnet","fundingStatus":"reserved","status":"open","proofRequirements":{"requiredResultFields":["status","responseTimeMs","contentHash","checkedAt"]}}'
```

Register agent with the CLI. If Circle W3S is configured on the API, this provisions a Circle wallet and uses that wallet address as the payout address:

```bash
npm run agent:register -- --agent-id agent_demo_link --name "External Link Sentinel"
```

If Circle W3S is not configured, use an externally controlled Arc Testnet fallback payout address:

```bash
npm run agent:register -- --agent-id agent_demo_link --name "External Link Sentinel" --payout-address 0x3333333333333333333333333333333333333333
```

Or register agent with the API:

```bash
curl -s -X POST "$API/agents/register-with-wallet" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent_demo_link","name":"External Link Sentinel","capabilities":["link_verification"],"status":"idle"}'
```

`/agents/register` remains available only for manual payout-address fallback and does not create a Circle wallet.

Run Link Sentinel with the returned agent key:

```bash
USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com" \
AGENT_ID="agent_demo_link" \
AGENT_API_KEY="AGENT_API_KEY_HERE" \
npm run agent:link -- --once
```

Windows Command Prompt can avoid environment-variable mistakes by passing the credentials directly:

```bat
npm run agent:link -- --once --api-url https://prooflet-api.onrender.com --agent-id agent_demo_link --agent-api-key AGENT_API_KEY_HERE
```

Inspect payable proofs:

```bash
curl -s "$API/proofs"
```

Check nanopayment-style access-fee config:

```bash
curl -s "$API/nanopayment/config"
curl -s "$API/jobs/job_demo_link_001/access-fee?agentAddress=0x3333333333333333333333333333333333333333"
```

Dry-run settlement batch through the hosted export endpoint:

```bash
curl -s -X POST "$API/settlement-batches/export" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ISSUER_API_KEY_HERE" \
  -d '{"issuerId":"issuer_demo_alex","batchId":"demo_hosted_dry_run_001"}'
```

## Remote Settlement Runner

The hosted API never holds a treasury/operator private key. For real testnet payout, the local operator machine fetches the hosted batch, signs Arc Testnet USDC transfers, then posts the receipt back to Render.

Dry-run a hosted batch:

```bash
USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com" \
ISSUER_ID="useful_waiting_protocol" \
ISSUER_API_KEY="ISSUER_API_KEY_HERE" \
REMOTE_SETTLEMENT_PROOF_IDS="proof_agent_ronny_clean_..." \
npm run settlement:remote:dry-run
```

Execute only after reviewing the dry-run:

```bash
USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com" \
ISSUER_ID="useful_waiting_protocol" \
ISSUER_API_KEY="ISSUER_API_KEY_HERE" \
TREASURY_PRIVATE_KEY="TREASURY_PRIVATE_KEY_HERE" \
CONFIRM_ARC_TESTNET_USDC_SEND=true \
REMOTE_SETTLEMENT_PROOF_IDS="proof_agent_ronny_clean_..." \
npm run settlement:remote:execute
```

This sends Arc Testnet USDC only. The local runner refuses non-Arc chains, rejected proofs, already-paid proofs, and locally repeated batch IDs.
