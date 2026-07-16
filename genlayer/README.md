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

## Deployment (post-submission, 2026-07-16) — FINALIZED

| Field | Value |
|---|---|
| Network | `testnet-bradbury` |
| Deploy tx | `0x7df8da92ea39c91a692320b14b050feaa8da400e15e806f99ae2e6adb66ff819` |
| Status | **FINALIZED** (`status_name: FINALIZED`, `resultName: AGREE`) |
| Contract address | **`0x3bF4b60176F8FAbA367bfC129C0529aeF462E397`** |
| Record | `genlayer/deployment.json` |
| Previous env address | `0xFF413C5cC01ffc8070BC8E4C0365bA1A33F013Bb` (superseded for new LLM quality code) |

Set hosted:

```bash
ADJUDICATION_MODE=genlayer
GENLAYER_NETWORK=testnet-bradbury
GENLAYER_CONTRACT_ADDRESS=0x3bF4b60176F8FAbA367bfC129C0529aeF462E397
GENLAYER_PRIVATE_KEY=…   # server only
```

Do **not** claim live GenLayer quality consensus on hosted until Render env is updated and a subjective proof is submitted through the live path.
