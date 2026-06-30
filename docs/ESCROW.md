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

ProofletEscrowV2 is the required next escrow contract for open external issuer funding.

V2 should let an issuer fund a marketplace job before any agent is known, then release only to the approved agent after proof verification.

Proposed V2 shape:

```solidity
fundJob(jobId, amount, expiresAt)
release(jobId, proofId, agent, amount)
refundJob(jobId)
```

Expected V2 behavior:

- issuer funds a job before agent assignment;
- job remains unclaimable until funding is confirmed;
- agent claims and submits proof through Prooflet;
- Prooflet verification/adjudication approves or rejects the proof;
- settlement operator releases to the approved agent only after approval;
- expired or rejected jobs can be refunded through `refundJob(jobId)`.

## Current External Issuer Boundary

External issuer onboarding, Circle issuer wallet provisioning, top-up readiness, and draft jobs are implemented. Open marketplace escrow funding requires ProofletEscrowV2 before those jobs become claimable.

Current external issuer jobs should remain `draft` / `awaiting_wallet_funding` and must not be exposed as claimable open marketplace jobs until V2 funding exists.

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
