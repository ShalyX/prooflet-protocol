# Hosted LLM e2e demo card (2026-07-16)

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

## Result: PASS

Real OpenRouter `gpt-4o-mini` inference on hosted Prooflet API, after Circle Gateway x402 access payment.

| Field | Value |
|---|---|
| API | https://prooflet-api.onrender.com |
| Job | `job_d70e6c2625` |
| Type | `content_summary` |
| Reward | 0.005 USDC |
| Agent | `agent_611794a20f` |
| Issuer | `hosted_llm_1784168980060_uo8m` |
| x402 | paid · gateway tx `2ff9fa59-fb8b-493b-afe1-8a182f552833` |
| Gateway deposit | `0x99ebff26…9a8d` (0.02 USDC into GatewayWallet) |
| LLM | openai/gpt-4o-mini · 386 tokens · confidence 0.9 |
| Proof | `proof_agent_611794a20f_1784168995411_236387f8` |
| Outcome | **accepted** |
| Funding | **payable** |
| Route | `content_summary_schema_v0` |
| Profit gate | margin ≈ 0.95 (passed) |

## Flow executed

1. Deposit Arc USDC into Circle GatewayWallet (RPC via `arc-testnet.drpc.org` when primary RPC rate-limited)
2. Register issuer + agent (`content_summary` capability)
3. Create reserved `content_summary` job with source text
4. `gateway:pay-access` (seller ≠ payer)
5. `agent:llm --once` → plan → claim → infer → proof

## Not claimed here

- Escrow V2 fund/release (this demo used reserved funding rail for agent intelligence)
- GenLayer quality consensus (schema gate only; GenLayer remains opt-in deploy)

## Reproduce

```bash
export USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com
export PRIVATE_KEY=…              # funded Arc Testnet USDC EOA
export ARC_RPC_URL=https://arc-testnet.drpc.org
export LLM_API_KEY=…
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_MODEL=openai/gpt-4o-mini
export WORKER_CAPABILITIES=content_summary
# create job + agent, then:
npm run gateway:pay-access -- --job-id … --agent-id …
npm run agent:llm -- --once
```
