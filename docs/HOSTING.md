# Hosted API Notes

Prooflet's public API runs on Render's free/ephemeral profile. The paid persistent-disk rollout is intentionally deferred; `render.yaml` remains free-tier configuration.

Hosted API: `https://prooflet-api.onrender.com`

## Render API

The Blueprint deploys one service:

- Service: `prooflet-api`
- Runtime: Node
- Plan: Free
- Instances: one API writer
- Start command: `node --no-warnings server/api.mjs`
- Health check: `/health`
- Settlement mode: `off`
- Database path: `/tmp/prooflet.sqlite` (ephemeral)

This is intentionally safe for public onboarding:

- No treasury/operator private key is configured.
- No Arc Testnet execute flow runs on Render.
- The API can register issuers/agents, attempt Circle W3S wallet provisioning when configured, create jobs, require Circle Gateway x402 access fees before claims, submit proofs, and export dry-run settlement batches.

The current service deliberately reports `storage.durable: false`. Registrations, jobs, proofs, and access records can disappear after a restart or deploy. The post-submission code includes fail-closed persistent-path validation and backup/restore tooling for a future durable profile, but no paid disk is configured.

The free hosted profile can be checked with:

```bash
PROOFLET_SMOKE_URL=https://prooflet-api.onrender.com \
npm run smoke:hosted
```

This check must continue to report `storage.durable: false` on the free profile. If a durable profile is approved later, configuration alone is still insufficient: a unique record must survive an actual restart/redeploy before durability is claimed.

For a future persistent-disk deployment, the disk remains a single failure domain. Online backups would also need to be copied off-service.

## Deferred paid-disk cutover reference

Do not execute this section while the project is staying on the free plan. A future cutover requires explicit approval for paid compute, disk, and a maintenance window.

1. Record fresh `/dashboard`, `/agents`, `/jobs`, and `/proofs` inventories and stop public writes.
2. Compare them with the audited submission fixtures (4 agents, 6 jobs, 4 proofs). If any non-fixture record exists, stop the cutover and export it before changing the database path.
3. If the ledger is fixture-only, intentionally start the durable ledger clean. Do not copy the known development credentials or synthetic settlement history into production.
4. Apply the Blueprint, paid plan, and `/var/data` disk.
5. Confirm migration 13 is present, production seeding is false, and no source-visible development key authenticates.
6. Run the hosted configuration smoke check and create a uniquely identified test record.
7. Restart/redeploy Render and verify that record plus all post-cutover counts survive unchanged.
8. Create a manifest-backed backup, copy both files off-service, and retain a rollback record of the pre-cutover inventory.

Rollback before accepting new writes means restoring the previous service configuration and acknowledging that its `/tmp` ledger is ephemeral. After accepting new writes, rollback must preserve the durable database; never point the service back to `/tmp` as if it contained the authoritative ledger.

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
2. Create a pre-assigned V1 link job.
3. Register agent.
4. Check `/nanopayment/config` and pay the Circle Gateway x402 access fee before claim.
5. Run Link Sentinel against the hosted API.
6. See an accepted proof become payable under the V1 operator-controlled flow.
7. Export the hosted settlement batch.
8. Sign/send Arc Testnet USDC locally from the operator wallet if execute is intentionally enabled.
9. Post the settlement receipt back to the hosted API.

Workers should point `USEFUL_WAITING_API_URL` at the Render API URL.

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

Create a pre-assigned V1 link job using the returned issuer API key:

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

Check Circle Gateway x402 access-fee config:

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
