# Known Limitations

Prooflet is a hackathon/test-phase implementation. Current limitations are explicit:

- **Arc settlement is testnet only.** Chain ID `5042002` and Arc Testnet USDC are enforced. No mainnet funds are supported.
- **GenLayer is opt-in.** The adapter, contract workspace, persistence, and network client are implemented, but live execution requires an intentionally deployed contract and server-side credentials. The default remains manual.
- **Mock is not live adjudication.** `mock_genlayer` is a deterministic local acceptance/demo path. Real `genlayer` mode was not executed during the pre-demo audit, and no live GenLayer decision receipt is claimed.
- **Hosted ledger is Neon Postgres (post-submission).** Free Render + Neon is the durable path; SQLite remains for local/dev. `/health` reports `storage.mode` and `storage.durable` only after restart survival is proven.
- **Manual adjudication is temporary.** Scoped manual decisions bridge subjective jobs until an external adjudication adapter is implemented and reviewed.
- **Reference workers are examples, not a closed network.** Link Sentinel, Freshness Clerk, and Context Press prove the worker/SDK contract. The intended ecosystem is external agents registering and polling for jobs when idle.
- **External issuer open-market funding is live on Arc Testnet via ProofletEscrowV2** (`fundJob` before agent is known). Issuer funds come from faucet → Circle wallet (not treasury). Mainnet is not supported. Escrow V1 remains a historical pre-assigned demo path.
- **Circle faucet API may be Forbidden** on free-tier keys (mainnet upgrade). Web faucet at faucet.circle.com remains the reliable top-up path.
- **The system is not production audited.** API, database, key management, worker, and settlement code require professional security review before production use.
- **No mainnet support.** The UI, documentation, scripts, and settlement checks describe testnet value only.
- **Local development keys are convenience credentials.** Production seeding is disabled, and known source-visible development key hashes are revoked during migration and every production database open.
- **Frontend replay data is demonstrative and isolated.** Current job, proof, reputation, treasury, and settlement state comes only from the connected API. API failure renders unavailable state rather than fixtures. Historical Lepton settlement receipts are labeled archived/committed evidence, while synthetic worker controls require explicit browser-only replay mode.

These constraints keep the project honest: the protocol demonstrates agent micro-labor and Arc Testnet settlement without presenting hackathon infrastructure as a production financial system.


## Settlement autonomy (honest)

Payment **approval** can be automatic (deterministic verifiers or GenLayer finalize → `payable`).

Payment **release** is autonomous on the **operator host** (keys never on the public Render API / browser):

| Path | Autonomy |
|---|---|
| Schema / GenLayer → `payable` | Automatic on hosted API |
| Escrow V2 `release` on Arc | **Autonomous** via operator loop: `npm run settlement:autonomous` (execute mode, 60s poll) |
| Cron backup tick | `scripts/autonomous-settlement-tick.mjs` (silent when queue empty) |
| Settlement daemon USDC send | Separate path for non-V2 batches; enable with execute mode if needed |

Operator process:
- Polls gated `GET /escrow/v2/payable` with `ESCROW_OPERATOR_API_KEY`
- Signs `release` with `SETTLEMENT_OPERATOR_PRIVATE_KEY` / treasury key on Arc Testnet only
- Posts authenticated `escrow-release-receipt` to update Neon ledger

Still **not** “keys in the public API”. Autonomy = operator machine / Hermes host runs the loop unattended.
