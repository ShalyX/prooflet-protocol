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

## Verified Lifecycle

Escrow contract deployed, funded, and released on Arc Testnet:

| Phase | TX | Arcscan |
|---|---|---|
| Deploy | `0xcbd471...1452d3a` | [View](https://testnet.arcscan.app/tx/0xcbd471ff0ce264a66583f710ecde3ee67774856e8ae395ace0f34f2151452d3a) |
| Fund | `0x2a81fb...4404d60` | [View](https://testnet.arcscan.app/tx/0x2a81fbf3064751319c171726b19eef08880611a49dbd95e500186f9c44404d60) |
| Release | `0xed7522...4626ef9` | [View](https://testnet.arcscan.app/tx/0xed7522a39b15bf9be0a1d94a9ee4d42cc69807d5f4108cb343bb44e514626ef9) |

- Contract: [`0xb3397ce196ebf553b8e951abaf75c18785c7e69a`](https://testnet.arcscan.app/address/0xb3397ce196ebf553b8e951abaf75c18785c7e69a)
- Job: `job_link_1782741166956_fb45ef65`
- Proof: `proof_agent_lynx_1782741794394_095f079b`
- Amount: 0.002 USDC
- Agent: `0xC2094270dc7d17C1578a975dd1Aa50578c034Be4`