# Live GenLayer content_summary adjudicate (2026-07-16)

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

## Result: PASS

| Field | Value |
|---|---|
| Network | `testnet-bradbury` |
| Contract | `0x132fF41207B4E94172A0184A738a51EF39aEFbF6` |
| Deploy tx | `0x30d48eba80982ab1c2a015d18d5151601177010e4b7373626f6aa5d5e05729d6` |
| Request | `glr_cs_a368b2ce` |
| Adjudicate tx | `0x093fc688da33fba32c7220fbdb8c874e9aa81755de49dd59f75e473ec589c75f` |
| Job type | `content_summary` |
| Decision | **approved** |
| Confidence | **0.95** |
| Status | ACCEPTED / AGREE / FINISHED_WITH_RETURN |
| Network call | **true** (not mock_genlayer) |

Reason (validator consensus output):
> The summary accurately restates the key elements: funding and settling verified agent micro-work using Arc Testnet USDC, matching the source text.

## Hosted Render env (set on `prooflet-api`)

```
ADJUDICATION_MODE=genlayer
GENLAYER_NETWORK=testnet-bradbury
GENLAYER_CONTRACT_ADDRESS=0x132fF41207B4E94172A0184A738a51EF39aEFbF6
GENLAYER_PRIVATE_KEY=…   # server only
GENLAYER_ENABLED=true
```

## Reproduce

```bash
export GENLAYER_NETWORK=testnet-bradbury
export GENLAYER_CONTRACT_ADDRESS=0x132fF41207B4E94172A0184A738a51EF39aEFbF6
export GENLAYER_PRIVATE_KEY=0x…
npm run genlayer:check
# writeContract adjudicate + readContract get_decision
```
