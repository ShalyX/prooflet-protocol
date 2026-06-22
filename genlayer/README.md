# GenLayer adjudicator

This optional Intelligent Contract adjudicates only `context_compression_quality` proofs. Deterministic Prooflet jobs never reach it, and Arc Testnet remains the USDC settlement layer after an approved decision.

Keep `ADJUDICATION_MODE=manual` unless a GenLayer environment is intentionally configured. Contract deployment and writes use `GENLAYER_PRIVATE_KEY` only from the server-side environment; the key is never sent to the browser or SDK clients.

```powershell
npm run genlayer:check
npm run genlayer:demo
npm run genlayer:demo -- --decision rejected
npm run genlayer:deploy
npm run genlayer:submit-fixture -- --proof-id <pending-proof-id>
npm run genlayer:poll-decision -- --request-id <request-id>
```

`mock_genlayer` is deterministic test infrastructure. It creates the same stored request/decision shape but performs no network call. Live deployment uses the current `genlayer-js` client and the contract conventions from GenLayer Studio. Review the contract and test it on localnet before using Studio or Bradbury.

`mock_genlayer` is the local acceptance path. Real `genlayer` mode is opt-in and was not executed unless explicitly configured with a deployed contract and server-side credentials.

`genlayer:demo` creates a unique subjective compression fixture, proves the pending state, finalizes it through `mock_genlayer`, and prepares only an approved fixture for settlement dry-run. It never calls GenLayer or sends Arc funds.
