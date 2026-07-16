# Autonomous settlement (operator host)

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

## Status: ON

| Component | State |
|---|---|
| Hosted path to `payable` | Automatic |
| Escrow V2 release loop | **Running** on operator host (`execute`, 60s) |
| Cron backup tick | every 2m via Hermes (`autonomous-settlement-tick.mjs`) |
| Human in the loop | **Not required** for release after payable |

## Commands

```bash
npm run settlement:autonomous        # continuous
npm run settlement:autonomous:once   # one pass
npm run settlement:autonomous:tick   # silent unless release/error
```

## Guarantees / non-guarantees

- Guarantees: unattended poll → on-chain release when Funded + payable + amount match
- Non-guarantees: RPC outages, operator host downtime, zero treasury gas, amount mismatch skips
- Keys never in browser or public frontend bundle
