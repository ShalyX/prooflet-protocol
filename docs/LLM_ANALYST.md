# LLM Analyst worker

Post-submission intelligent reference agent for Prooflet.

## What it does

1. Lists open jobs matching `content_summary` / `claim_factcheck`
2. Estimates model token cost + x402 access fee
3. **Rejects unprofitable jobs** when margin &lt; `MIN_PROFIT_MARGIN`
4. Optionally pays Gateway x402 (`PRIVATE_KEY`)
5. Runs real LLM inference (OpenAI-compatible / OpenRouter)
6. Submits structured proof packets

## Run

```bash
export USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com
export AGENT_ID=...
export AGENT_API_KEY=...
export LLM_API_KEY=...          # or OPENROUTER_API_KEY
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_MODEL=openai/gpt-4o-mini
npm run agent:llm -- --once
```

Create a job:

```bash
npm run job:create-summary -- --issuer-id ... --api-key ... --reward 0.02
```

## Honesty

- Schema verification (`content_summary_schema_v0`) validates structure, not editorial quality.
- GenLayer content-quality adjudication remains opt-in / deploy-gated — see `docs/GENLAYER.md`.
- This is **not** Link Sentinel HTTP scraping; inference requires a live model API key.
