# Security Model

Prooflet is a test-phase protocol and has not received a production security audit. These guardrails are part of the implementation, not a claim of production readiness.

## Secret Handling

- Never commit `.env`. It is ignored by Git; `.env.example` contains placeholders only.
- Never expose `TREASURY_PRIVATE_KEY`, escrow operator private keys, Circle entity secrets, or Circle API keys in frontend code, SDKs, logs, uploads, API responses, command arguments, screenshots, or support messages.
- Keep agent, issuer, and adjudicator keys server-side or in local session memory. The issuer workbench uses `sessionStorage`, not persistent `localStorage`.
- API keys are hashed before SQLite storage. Registration returns a raw key once.
- Public examples use dummy addresses. Real recipient mappings and settlement state files remain ignored.

## Scoped Authority

- Agent keys validate one agent, claim its eligible jobs, and submit its proofs.
- Issuer keys create and inspect that issuer's jobs. Issuer keys cannot adjudicate subjective proofs.
- Adjudicator keys require explicit `manual_adjudication:read` or `manual_adjudication:write` scope.
- GenLayer operators require explicit `genlayer:read` or `genlayer:write` scope. Issuer and agent keys cannot submit or sync network decisions.
- `GENLAYER_PRIVATE_KEY` is server-side only and must never enter frontend builds, SDK options, logs, or API responses.
- Adjudicator keys cannot create issuer jobs, access settlement/operator keys, execute settlement, or modify deterministic approvals.
- Settlement authority remains in a server-side/local operator environment and is not exposed by the hosted API or frontend.

## Settlement Safety

- The settlement daemon defaults to `dry-run`; it never defaults to execute.
- Dry-run sends no transaction.
- Execute mode targets Arc Testnet chain ID `5042002` and testnet USDC only. Mainnet is unsupported.
- Execute mode requires explicit confirmation in addition to the execute command.
- The runner validates network, token, operator/treasury identity, balances, recipients, proof states, and payout totals.
- Paid proofs cannot be modified back to payable by settlement recording.
- Rejected proofs cannot be included in payout.
- Pending subjective proofs cannot be included in payout.
- A proof with a transaction hash or `Settled on Arc Testnet` state cannot be paid again.
- A settled batch ID cannot execute twice.
- Atomic `prepared -> executing` locking prevents two processes from settling the same batch concurrently.
- A transfer failure never marks its proof paid. Ambiguous failures with a hash require review.

## Proof and Reputation Integrity

- Proof submission requires an active claim owned by the submitting agent.
- Expired leases reopen work and reject late proof submission.
- Proof input must exactly match job input.
- Required result fields must be present.
- Fingerprint-based duplicate detection remains active across jobs and rejects reused proof work.
- Reputation derives from immutable events and can be rebuilt for audit.
- Manual decisions are immutable and limited to proofs currently pending adjudication.
- GenLayer requests fail closed. Pending, submitted, failed, rejected, paid, and settled proofs cannot bypass the payable settlement predicate.

## Operational Practices

1. Review payout plans in dry-run before every execute session.
2. Use tiny Arc Testnet amounts and separately controlled recipient wallets.
3. Stop API, workers, and daemon before copying SQLite backups; copy the database with its `-wal` and `-shm` companions.
4. Rotate any API, Circle, treasury, or operator credential that appears in logs or screenshots.
5. Run `npm run submission:check` and `npm audit` before demos and releases.

Report a suspected issue privately to the project maintainers. Do not include private keys or raw API credentials in the report.
