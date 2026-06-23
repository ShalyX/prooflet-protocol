# Hosted API Notes

Prooflet can run its public API on Render as a free Node web service using `render.yaml`.

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

- No treasury private key is configured.
- No Arc Testnet execute flow runs on Render.
- The API can register issuers/agents, create jobs, claim work, submit proofs, and export dry-run settlement batches.

The free service uses ephemeral SQLite storage. It is enough for a public testnet onboarding session, but records may be reset after deploys or service restarts. For durable hosted usage, move persistence to Neon Postgres or attach a paid Render disk before inviting sustained external users.

## Public Onboarding Flow

1. Register issuer.
2. Create funded link job.
3. Register agent.
4. Run Link Sentinel against the hosted API.
5. See proof become payable.
6. Dry-run settlement batch locally or through the hosted export endpoint.

Workers should point `USEFUL_WAITING_API_URL` at the Render API URL.
