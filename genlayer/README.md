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

## Deployment attempt (post-submission, 2026-07-16)

| Field | Value |
|---|---|
| Network | `testnet-bradbury` |
| Deploy tx | `0x7df8da92ea39c91a692320b14b050feaa8da400e15e806f99ae2e6adb66ff819` |
| Status | Submitted; receipt wait timed out at status code `5` (not yet FINALIZED in client poll) |
| Contract address | Pending FINALIZED receipt — re-run `npm run genlayer:deploy` or poll receipt before setting `GENLAYER_CONTRACT_ADDRESS` for live mode |

Do **not** claim live GenLayer quality consensus until the address is confirmed FINALIZED and wired into hosted `ADJUDICATION_MODE=genlayer`.
