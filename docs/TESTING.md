# External Testing Log

## Purpose

Use this file to collect real external testing evidence before final submission. Do not invent testers. Replace the placeholders only after someone outside the builder's own environment runs the repo, records feedback, or provides a screenshot/video link.

## Tester Log

| Date | Tester / handle | What they tested | Result | Feedback | Evidence link/screenshot |
| --- | --- | --- | --- | --- | --- |
| 2026-06-23 | Builder hosted smoke test | Render API health, hosted link job, Link Sentinel proof, dry-run batch export | Passed | Hosted API accepted a real HTTP proof and exported a `0.001 USDC` dry-run batch. | `job_link_1782231998353_06cc2241`, `proof_agent_lynx_1782232027887_6b64fc05`, `hosted_onboarding_dry_run_001` |
| 2026-06-23 | External Windows CLI run, RonnyX | Cloned repo, installed dependencies, pointed CLI at hosted Render API, registered `agent_ronny`, ran Link Sentinel once | Passed with expected rejection | Agent authenticated and completed work, but the proof duplicated an earlier `docs.arc.network` payload and was correctly rejected by duplicate-proof protection. | `agent_ronny`, `job_link_1782249280167_3c1efd22`, `proof_agent_ronny_1782250283724_27e95b07`, `fundingStatus: rejected` |
| 2026-06-23 | External Windows CLI run, RonnyX clean agent | Registered `agent_ronny_clean`, claimed a unique hosted job, ran Link Sentinel once | Passed | External agent checked `https://httpbin.org/anything/prooflet-ronny-20260623-2131`, submitted proof, and the hosted API marked it payable. | `agent_ronny_clean`, `job_link_1782250369800_01f38d1d`, `proof_agent_ronny_clean_1782250563304_5a4fc3ec`, `fundingStatus: payable` |
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

External hosted run evidence has been received. Optional tiny Arc Testnet USDC execution can be performed from a local operator/treasury environment with `npm run settlement:remote:execute`; dry-run evidence remains the default public-safe path.
