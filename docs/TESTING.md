# External Testing Log

## Purpose

Use this file to collect real external testing evidence before final submission. Do not invent testers. Replace the placeholders only after someone outside the builder's own environment runs the repo, records feedback, or provides a screenshot/video link.

## Tester Log

| Date | Tester / handle | What they tested | Result | Feedback | Evidence link/screenshot |
| --- | --- | --- | --- | --- | --- |
| 2026-06-23 | Builder hosted smoke test | Render API health, hosted link job, Link Sentinel proof, dry-run batch export | Passed | Hosted API accepted a real HTTP proof and exported a `0.001 USDC` dry-run batch. | `job_link_1782231998353_06cc2241`, `proof_agent_lynx_1782232027887_6b64fc05`, `hosted_onboarding_dry_run_001` |
| 2026-06-23 | External Windows CLI run, handle pending | Cloned repo, installed dependencies, pointed CLI at hosted Render API, created link job, ran Link Sentinel once | Passed | First attempt hit Render cold-start timeout; rerun connected, claimed work, checked `https://docs.arc.network`, and produced a payable proof. | `job_link_1782248660597_83e390c3`, `proof_agent_lynx_1782248681573_25948009`, `fundingStatus: payable` |
| `DATE_HERE` | `TESTER_HANDLE_1` | `FLOW_TESTED_HERE` | `RESULT_HERE` | `FEEDBACK_HERE` | `EVIDENCE_LINK_HERE` |
| `DATE_HERE` | `TESTER_HANDLE_2` | `FLOW_TESTED_HERE` | `RESULT_HERE` | `FEEDBACK_HERE` | `EVIDENCE_LINK_HERE` |
| `DATE_HERE` | `TESTER_HANDLE_3` | `FLOW_TESTED_HERE` | `RESULT_HERE` | `FEEDBACK_HERE` | `EVIDENCE_LINK_HERE` |

## Suggested Flows

External tester packet:

```bash
docs/EXTERNAL_RUN.md
```

```bash
npm run demo:seed
npm run settlement:daemon:dry-run -- --once
```

```bash
npm run job:create-link -- --url https://docs.arc.network --reward 0.001
npm run agent:link -- --once
```

Ask testers to note whether the landing page, dashboard, proof packet, and dry-run payout plan were understandable without private context.

## Pending Settlement Evidence

External hosted run evidence has been received. Remaining items before claiming paid external usage:

- Tester / handle: `TESTER_HANDLE_HERE`
- Agent payout wallet: `TESTER_ARC_TESTNET_ADDRESS_HERE`
- Confirm whether `agent_lynx` should receive the tiny payout or whether the tester will rerun with their own registered wallet.
- Optional after proof is payable: tiny Arc Testnet USDC execute from local treasury, then replace `FRESH_DEMO_TX_HASH_HERE` in submission docs.
