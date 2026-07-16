# Escrow V2 + LLM hosted e2e (2026-07-16)

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

## Result: PASS (full rails)

| Field | Value |
|---|---|
| Job | `job_llm_escrow_mrn7f5hk` |
| Proof | `proof_agent_llm_escrow_mrn7f5hk_1784187978279_cb4a4d08` |
| Agent | `agent_llm_escrow_mrn7f5hk` |
| Model | `openai/gpt-4o-mini` |
| Outcome | **accepted** → **payable** → **released** |
| Fund tx | [`0xaddc7d22…f313`](https://testnet.arcscan.app/tx/0xaddc7d22de703d38b64c077ff4a32b2024fcfbdee353b2b030f48cc16e7af313) |
| x402 | `e1623751-20f0-47a8-b3bf-7533f0052cad` |
| Release tx | [`0xb2db3abf…01af`](https://testnet.arcscan.app/tx/0xb2db3abf8f92ae12b814d2a7c210d1af20df738718979c2e53ef92543d3501af) |
| Escrow status | **released** |
| Reward | 0.003 USDC |
| Profit margin (estimate) | ~0.92 |

## Flow

1. draft job `content_summary` + Escrow V2 awaiting fund  
2. operator `fundJob` on Arc Testnet  
3. API `fund-escrow` on-chain verify  
4. Circle Gateway x402 access  
5. LLM analyst plan → claim → infer → proof  
6. operator release → release receipt  

Reproduce: `npm run escrow:v2:llm-e2e`
