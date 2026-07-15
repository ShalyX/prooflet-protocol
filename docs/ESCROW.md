# Prooflet Escrow

Open marketplace escrow funding requires ProofletEscrowV2.

Prooflet currently has two escrow boundaries:

- **Escrow V1** — deployed and proven on Arc Testnet for a controlled/pre-assigned demo lifecycle.
- **ProofletEscrowV2** — required before open external issuer jobs can be funded before an agent is known and become claimable in the marketplace.

## Escrow V1 — Deployed Arc Testnet Demo Escrow

Escrow V1 is real and proven on Arc Testnet, but it is intentionally narrow. It supports a pre-assigned demo escrow where the paying issuer already knows the agent address at deposit time.

| Field | Value |
|---|---|
| Contract | `0xb3397ce196ebf553b8e951abaf75c18785c7e69a` |
| Network | Arc Testnet, chain ID `5042002` |
| USDC | `0x3600000000000000000000000000000000000000` |
| Solidity file | `contracts/Escrow.sol` |

### V1 functions

| Function | Who calls it | What it does |
|---|---|---|
| `deposit(jobId, agent, amount)` | Issuer | Locks USDC for a specific job and already-known agent |
| `release(jobId)` | Settlement operator | Releases USDC to the pre-assigned agent after proof approval |
| `refund(jobId)` | Settlement operator | Returns USDC to the issuer after rejection/cancellation |
| `getEscrow(jobId)` | Anyone | Reads escrow status |
| `transferOperator(newOp)` | Settlement operator | Changes who can release/refund |

### V1 limitation

Escrow V1 is not suitable for open marketplace jobs where an issuer funds before an agent is known. The V1 deposit path requires the agent address up front:

```solidity
deposit(jobId, agent, amount)
```

That makes V1 useful for a controlled/pre-assigned demo lifecycle, not the final external issuer marketplace funding flow.

## Verified V1 Lifecycle

Escrow V1 was deployed, funded, and released on Arc Testnet:

| Phase | TX | Arcscan |
|---|---|---|
| Deploy | `0xcbd471...1452d3a` | [View](https://testnet.arcscan.app/tx/0xcbd471ff0ce264a66583f710ecde3ee67774856e8ae395ace0f34f2151452d3a) |
| Fund | `0x2a81fb...4404d60` | [View](https://testnet.arcscan.app/tx/0x2a81fbf3064751319c171726b19eef08880611a49dbd95e500186f9c44404d60) |
| Release | `0xed7522...4626ef9` | [View](https://testnet.arcscan.app/tx/0xed7522a39b15bf9be0a1d94a9ee4d42cc69807d5f4108cb343bb44e514626ef9) |

- Contract: [`0xb3397ce196ebf553b8e951abaf75c18785c7e69a`](https://testnet.arcscan.app/address/0xb3397ce196ebf553b8e951abaf75c18785c7e69a)
- Job: `job_link_1782741166956_fb45ef65`
- Proof: `proof_agent_lynx_1782741794394_095f079b`
- Amount: `0.002 USDC`
- Agent: `0xC2094270dc7d17C1578a975dd1Aa50578c034Be4`

## ProofletEscrowV2 — Required Marketplace Escrow Boundary

ProofletEscrowV2 is the open-marketplace escrow for Arc Testnet USDC.

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

V2 lets an issuer fund a marketplace job **before any agent is known**, then release only to the approved agent after proof verification.

### V2 functions

| Function | Who | What |
|---|---|---|
| `fundJob(jobId, amount, expiresAt)` | Issuer | Locks USDC for a job with unknown agent |
| `release(jobId, proofId, agent, amount)` | Settlement operator | Pays approved agent after verification |
| `refundJob(jobId)` | Settlement operator | Returns USDC to issuer on reject/cancel |
| `refundExpired(jobId)` | Issuer | Reclaims funds after `expiresAt` if still funded |
| `getEscrow(jobId)` | Anyone | Reads escrow status |

Solidity: `contracts/EscrowV2.sol`
Artifacts: `contracts/out/EscrowV2.{abi,bin}`
Deployed Arc Testnet contract: [`0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9`](https://testnet.arcscan.app/address/0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9)
Deploy tx: [`0x1b30b1b110d5f4b4a4c93fe02f7c196845334b8a4a9b7b4fbe37bf72b84c5c29`](https://testnet.arcscan.app/tx/0x1b30b1b110d5f4b4a4c93fe02f7c196845334b8a4a9b7b4fbe37bf72b84c5c29)
Operator: `0x709F18F797347FbB8D53Fb60567892751dd14B11`
Deploy (optional, needs deployer key): `npm run escrow:v2:deploy`

### Protocol API (hosted)

- `GET /escrow/v2/config` — Arc Testnet V2 config (`mainnet: false`)
- `POST /jobs/:jobId/fund-escrow` — issuer reports Arc Testnet `fundJob` tx hash for a draft/`awaiting_wallet_funding` job

On successful fund receipt:

- `funding_rail` → `arc_usdc_escrow_v2`
- `funding_status` → `reserved`
- `status` → `open` (claimable under normal access rules)
- `escrow_status` → `funded`

### Expected V2 lifecycle

1. Issuer creates draft job with `fundingStatus: awaiting_wallet_funding`
2. Issuer calls on-chain `fundJob` (agent still unknown)
3. Issuer posts fund tx hash to `/jobs/:jobId/fund-escrow`
4. Agent claims + submits proof through Prooflet
5. Settlement operator calls on-chain `release` after approval (or `refundJob` on reject)

### Safety

- Arc Testnet only in protocol validation
- Mainnet funds not supported
- Hosted API does not custody issuer funds
- Operator-controlled release remains explicit
- No production audit

## Settlement Operator CLI for V1

```bash
# Check V1 escrow status
npm run escrow:operator -- --status=JOB_ID

# Release V1 funds to the pre-assigned agent after proof approval
npm run escrow:operator -- --release=JOB_ID

# Refund V1 funds to issuer
npm run escrow:operator -- --refund=JOB_ID
```

## Safety Notes

- V1 settlement is operator-controlled.
- V1 does not support unknown-agent marketplace funding.
- Hosted API does not custody issuer reward funds.
- Mainnet funds are not involved.
- No production audit has been performed.
