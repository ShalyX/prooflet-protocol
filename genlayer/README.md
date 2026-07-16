# GenLayer adjudicator (opt-in)

Post-submission: this Intelligent Contract can adjudicate **LLM quality** jobs in addition to the original compression fixture.

## Supported `jobType` values

| jobType | What validators grade |
|---|---|
| `content_summary` / `content_summary_quality` | Summary faithfulness / coverage |
| `claim_factcheck` / `claim_factcheck_quality` | Verdict justified by source |
| `context_compression_quality` | Meaning preserved |
| `sentiment_toxicity_tagging` | Sentiment/toxicity correctness |

Equivalence is on **decision + confidence band** (low/mid/high), not raw prose.

## Modes (honest)

| Mode | Behavior |
|---|---|
| `ADJUDICATION_MODE=manual` | Default. No GenLayer network calls. |
| `mock_genlayer` | Local deterministic acceptance shape only. |
| `genlayer` | Live network — requires deployed contract + `GENLAYER_PRIVATE_KEY` server-side. |

Schema verifiers on `content_summary` / `claim_factcheck` can accept structure without GenLayer. Use GenLayer when you want **subjective quality consensus**.

## Commands

```bash
npm run genlayer:check
npm run genlayer:demo                 # mock path, no funds
npm run genlayer:deploy               # needs GENLAYER_PRIVATE_KEY + GENLAYER_NETWORK
npm run genlayer:submit-fixture -- --proof-id <pending-proof-id>
npm run genlayer:poll-decision -- --request-id <request-id>
```

Contract source: `genlayer/contracts/useful_waiting_adjudicator.py`
Runner pin: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

## Config

```bash
export ADJUDICATION_MODE=genlayer
export GENLAYER_NETWORK=testnet-bradbury   # or studionet / localnet
export GENLAYER_CONTRACT_ADDRESS=0x…
export GENLAYER_PRIVATE_KEY=0x…            # server only — never browser
export ADJUDICATOR_API_KEY=…               # scoped key
```

If deploy credentials are missing, leave mode `manual` and keep shipping schema-verified LLM demos.

## Deployment (post-submission, 2026-07-16) — LIVE LLM ADJUDICATE

| Field | Value |
|---|---|
| Network | `testnet-bradbury` |
| Deploy tx | `0x30d48eba80982ab1c2a015d18d5151601177010e4b7373626f6aa5d5e05729d6` |
| Status | **ACCEPTED** / AGREE / FINISHED_WITH_RETURN |
| Contract address | **`0x132fF41207B4E94172A0184A738a51EF39aEFbF6`** |
| Live adjudicate | `content_summary` → **approved** @ 0.95 |
| Adjudicate tx | `0x093fc688da33fba32c7220fbdb8c874e9aa81755de49dd59f75e473ec589c75f` |
| Record | `genlayer/deployment.json` · `docs/GENLAYER_LIVE_LLM.md` |

Hosted Render `prooflet-api` env set to this contract with `ADJUDICATION_MODE=genlayer`.
