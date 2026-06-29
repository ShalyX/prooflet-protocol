# Prooflet Escrow

External issuers fund jobs through an **Arc Testnet USDC escrow contract** instead of sending funds to the treasury directly.

## Architecture

```
Issuer deposits USDC → Escrow contract holds funds
                          ↓
                  Agent completes job
                          ↓
              Prooflet verifies proof
                          ↓
          Settlement Operator calls:
              - release() → agent gets paid
              - refund()  → issuer gets money back
```

## Contract

- **File:** `contracts/Escrow.sol`
- **Network:** Arc Testnet (chain ID 5042002)
- **USDC:** 0x3600000000000000000000000000000000000000

### Functions

| Function | Who calls it | What it does |
|---|---|---|
| `deposit(jobId, agent, amount)` | Issuer | Locks USDC in escrow for a specific job |
| `release(jobId)` | Settlement Operator | Sends USDC to agent (proof approved) |
| `refund(jobId)` | Settlement Operator | Returns USDC to issuer (proof rejected) |
| `getEscrow(jobId)` | Anyone | View escrow status |
| `transferOperator(newOp)` | Settlement Operator | Change who can release/refund |

## Deployment

```bash
# 1. Set env vars
export ESCROW_DEPLOYER_PRIVATE_KEY=0x...
export ESCROW_OPERATOR_ADDRESS=0x...

# 2. Compile & deploy
solc --bin --abi --optimize -o contracts/out contracts/Escrow.sol
npm run escrow:deploy

# 3. Copy ESCROW_CONTRACT_ADDRESS to .env
```

## Settlement Operator CLI

```bash
# Check escrow status
npm run escrow:operator -- --status=JOB_ID

# Release funds to agent (proof approved)
npm run escrow:operator -- --release=JOB_ID

# Refund to issuer (proof rejected)
npm run escrow:operator -- --refund=JOB_ID
```

## Job Metadata

Jobs funded through escrow show:

- `fundingRail: "arc_usdc_escrow"`
- `escrowStatus: "funded" | "released" | "refunded"`
- `escrowTxHash: "0x..."`

## Safety

- Only the settlement operator can release or refund
- Escrow holds exact reward amount — no treasury mixing
- Operator key should be stored separately from treasury key
- All actions emit on-chain events for audit