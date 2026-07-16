# Hosted subjective GenLayer loop (2026-07-16)

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

## Result: PASS

End-to-end on **https://prooflet-api.onrender.com** (Neon + Render):

| Step | Result |
|---|---|
| Subjective `content_summary` job | created |
| Trusted agent + x402 access | paid |
| Claim | ok |
| LLM proof (gpt-4o-mini) | submitted → `pending_adjudication` |
| Auto-route GenLayer | submitted on Bradbury |
| Consensus | **approved** @ **0.9** |
| Funding | **payable** |
| Verification | `genlayer_approved` |

### Artifacts

| Field | Value |
|---|---|
| Job | `job_gl_host_mrn95rpw` |
| Proof | `proof_agent_gl_host_mrn95rpw_1784190852181` |
| Agent | `agent_gl_host_mrn95rpw` |
| Request | `glr_e75d37a5-2b86-49d7-bcc2-0803c28ad1cb` |
| GenLayer tx | `0xdf4d0d3ee351c9ba9ecaaded72b029d3e36998bda2b3c0d960c47bbb4bf680de` |
| Contract | `0x132fF41207B4E94172A0184A738a51EF39aEFbF6` |
| Decision | approved |
| Confidence | 0.9 |
| Reason | Summary accurately reflects Prooflet funding, x402 fee, LLM analysis, and GenLayer grading |

### Fix that unblocked hosted path

PR #31: GenLayer module now **awaits** Neon async `prepare().get/run`. Without that, hosted always returned `proof_not_pending_adjudication` even when the row was pending.

### Flow

```
register issuer → create subjective job → register agent (trusted)
→ x402 pay → claim → LLM proof → auto GenLayer adjudicate → payable
```
