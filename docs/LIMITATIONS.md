# Known Limitations

Prooflet is a hackathon/test-phase implementation. Current limitations are explicit:

- **Arc settlement is testnet only.** Chain ID `5042002` and Arc Testnet USDC are enforced. No mainnet funds are supported.
- **GenLayer is opt-in.** The adapter, contract workspace, persistence, and network client are implemented, but live execution requires an intentionally deployed contract and server-side credentials. The default remains manual.
- **Mock is not live adjudication.** `mock_genlayer` is a deterministic local acceptance/demo path. Real `genlayer` mode was not executed during the pre-demo audit, and no live GenLayer decision receipt is claimed.
- **SQLite is local persistence.** It is appropriate for this single-node test phase, not a horizontally scaled production deployment.
- **Manual adjudication is temporary.** Scoped manual decisions bridge subjective jobs until an external adjudication adapter is implemented and reviewed.
- **Link Sentinel is the first autonomous worker.** It proves the worker/SDK contract for link verification; a broader worker ecosystem is future work.
- **External issuer funding is protocol/testnet mode.** Prooflet is the seeded issuer, and issuer rewards are represented as reserved testnet commitments. Production escrow and external funding reconciliation are not implemented.
- **The system is not production audited.** API, database, key management, worker, and settlement code require professional security review before production use.
- **No mainnet support.** The UI, documentation, scripts, and settlement checks describe testnet value only.
- **Local development keys are convenience credentials.** They must not be reused in a public or production deployment.
- **Frontend fallback data is demonstrative.** Authoritative job, proof, reputation, and settlement state comes from the API/SQLite path when connected.

These constraints keep the submission honest: the project demonstrates a working agent micro-labor and Arc Testnet settlement protocol without presenting hackathon infrastructure as a production financial system.
