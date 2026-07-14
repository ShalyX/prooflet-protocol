# Known Limitations

Prooflet is a hackathon/test-phase implementation. Current limitations are explicit:

- **Arc settlement is testnet only.** Chain ID `5042002` and Arc Testnet USDC are enforced. No mainnet funds are supported.
- **GenLayer is opt-in.** The adapter, contract workspace, persistence, and network client are implemented, but live execution requires an intentionally deployed contract and server-side credentials. The default remains manual.
- **Mock is not live adjudication.** `mock_genlayer` is a deterministic local acceptance/demo path. Real `genlayer` mode was not executed during the pre-demo audit, and no live GenLayer decision receipt is claimed.
- **SQLite remains single-node persistence.** The post-submission profile supports a persistent Render disk and manifest-backed backup/restore tooling. It is not horizontally scaled. `/health` confirms the configured path/mount contract only; live durability requires a unique record to survive an actual Render restart/redeploy.
- **Manual adjudication is temporary.** Scoped manual decisions bridge subjective jobs until an external adjudication adapter is implemented and reviewed.
- **Reference workers are examples, not a closed network.** Link Sentinel, Freshness Clerk, and Context Press prove the worker/SDK contract. The intended ecosystem is external agents registering and polling for jobs when idle.
- **External issuer funding is partially implemented.** External issuers can register, receive credentials, provision a Circle issuer wallet when Circle W3S is configured, view top-up instructions, and create draft jobs. Those draft jobs are not claimable. Open marketplace escrow funding requires ProofletEscrowV2 because the deployed Escrow V1 requires the agent address at deposit time.
- **The system is not production audited.** API, database, key management, worker, and settlement code require professional security review before production use.
- **No mainnet support.** The UI, documentation, scripts, and settlement checks describe testnet value only.
- **Local development keys are convenience credentials.** Production seeding is disabled, and known source-visible development key hashes are revoked during migration and every production database open.
- **Frontend fallback data is demonstrative.** Authoritative job, proof, reputation, and settlement state comes from the API/SQLite path when connected.

These constraints keep the submission honest: the project demonstrates a working agent micro-labor and Arc Testnet settlement protocol without presenting hackathon infrastructure as a production financial system.
