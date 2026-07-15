# Free Neon Durable Core Implementation Plan

> **For Hermes:** Execute with strict RED→GREEN→REFACTOR slices and independent review gates. Every change after an asynchronous review invalidates that review.

**Goal:** Move Prooflet's hosted protocol state from ephemeral SQLite on free Render to free Neon Postgres, preserve SQLite for local/original-submission verification, make live-versus-archived frontend state truthful, and establish the persistence/concurrency foundation required before open-market Escrow V2.

**Architecture:** Introduce an asynchronous storage contract rather than emulating `DatabaseSync`. Keep the existing SQLite implementation and original submission checks intact. Add a Postgres implementation selected by `DATABASE_URL`, with one bounded pool per process, versioned transactional migrations, parameterized SQL, and explicit transactional methods for claim/proof/payment/settlement invariants. Migrate vertical flows behind repositories; do not mix SQLite and Postgres within one hosted process.

**Tech Stack:** Node 22/24 ESM, Express 5, existing `node:sqlite`, `pg@^8.22.0` with one lazy bounded process-wide pool, Neon Postgres pooled runtime URL, Vite frontend, GitHub Actions.

**Boundary:** Everything here is **Post-submission development — not part of the original Lepton Agents Hackathon submission.** Immutable boundary: `298415b1bcca803436812327a07a93e77aadb590` / `lepton-submission-2026-07-06`.

---

## Acceptance gates before Escrow V2

1. Hosted state uses Postgres and `/health` reports backend/configuration without exposing a connection string.
2. Issuer, agent, job, claim, access-payment, proof, adjudication, reputation, batch, and settlement records survive an actual Render redeploy.
3. Two concurrent agents cannot acquire the same job lease.
4. Duplicate proof fingerprints and duplicate payment/settlement transaction identifiers fail atomically.
5. A settlement batch cannot be executed twice.
6. Production contains no fixture identities or source-visible credentials.
7. The frontend never presents archived submission evidence as current live state.
8. SQLite submission checks and the complete post-submission suite remain green.
9. Final candidate passes CI, dependency audit, secret scan, browser/API smoke, and fresh independent review.

---

### Task 1: Freeze the post-submission branch and baseline

**Files:**
- Create branch: `post-submission/neon-durable-core`
- Create/update: `.hermes/plans/2026-07-14_175444-free-neon-durable-core.md`

**Steps:**
1. Branch from `origin/main`; verify the submission tag still resolves to `298415b...`.
2. Run `npm ci`, `npm run post-submission:check`, `npm audit --omit=dev --audit-level=high`.
3. Record the current live `/health`, `/dashboard`, and canonical frontend route behavior.
4. Commit no production changes until the architecture review resolves driver/pool/migration choices.

### Task 2: Truthful live-versus-archive frontend slice

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `src/styles.css` only if needed for explicit state labels
- Create: `scripts/frontend-truth-acceptance.mjs`
- Modify: `package.json`
- Update: `README.md`, `docs/DEMO.md`, `docs/API.md`, `docs/LIMITATIONS.md`

**RED:** Add source/build acceptance checks proving:
- connected empty API renders zero/empty live state;
- disconnected API is labeled unavailable, not live;
- historical batch `uwp_arc_20260618_001` appears only in an explicitly archived/submission-evidence region;
- fallback demo agents/jobs/proofs are never merged into a connected API response;
- canonical `/dashboard` has no fatal browser errors.

**GREEN:** Split state into `liveState`, `archivedSubmissionEvidence`, and `connectionState`. Remove connected-mode fallback merging. Replace “Last payout/demo batch” live labels with explicit current-ledger empty states. Keep historical evidence on the landing/replay surface with an “Archived submission evidence” label.

**Verify:** Run focused truth acceptance, Vite build, preview browser smoke, then full suite.

### Task 3: Define the async storage contract

**Files:**
- Create: `server/storage/index.mjs`
- Create: `server/storage/contracts.mjs`
- Create: `server/storage/sqlite.mjs`
- Create: `scripts/storage-contract-acceptance.mjs`
- Modify: `server/db.mjs` only as an adapter boundary; preserve existing exports for submission tests

**RED:** Write a backend-agnostic contract suite for clean initialization, health, transaction commit/rollback, parameter binding, duplicate-key classification, and close semantics.

**GREEN:** Implement the contract over existing SQLite first. Do not change API routes yet. Contract methods return Promises even when SQLite executes synchronously.

**Interface requirements:**
- `initialize()`, `health()`, `close()`;
- `transaction(operation, { isolation })`;
- typed repository groups rather than generic raw-query access;
- stable conflict/not-found/storage error classes;
- timestamps normalized to ISO strings, monetary values preserved as decimal strings, JSON returned as objects.

### Task 4: Add Postgres connection and migration spine

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `server/storage/postgres.mjs`
- Create: `server/postgres/migrations/index.mjs`
- Create: `server/postgres/migrations/001_protocol_core.sql` (or equivalent versioned JS/SQL files)
- Create: `scripts/postgres-migration-acceptance.mjs`
- Modify: `.env.example`

**RED:** Tests must fail before implementation for backend selection, secret-safe health, one shared bounded pool, migration idempotency, concurrent migration initialization, rollback on migration failure, and prior-version upgrade.

**GREEN:**
- Select Postgres only when `DATABASE_URL` is configured; hosted production must not silently fall back to SQLite once Postgres is required.
- Use bracket environment access (`process.env["DATABASE_URL"]`) to avoid Hermes redaction corruption.
- Set conservative pool size/timeouts for Neon free tier and free Render.
- Use advisory locking plus a transaction for migration claims.
- Never log the connection string.

**Schema rules:**
- compatibility-first `TEXT` for ISO timestamps, monetary values, and JSON payloads during the initial cutover so existing API/serializer behavior is preserved;
- `SMALLINT CHECK (... IN (0,1))` for SQLite-compatible flags during the initial cutover;
- `INTEGER GENERATED BY DEFAULT AS IDENTITY` where generated numeric IDs remain within the JavaScript safe range;
- check constraints and foreign keys matching protocol state machines;
- exact unique constraints for key hashes, canonical fingerprint reservations, transaction hashes, Gateway transaction IDs, adjudication decisions, and access payments.

Modernize JSON/timestamp/money/boolean columns only in a later migration after parity is proven; do not combine a semantic type migration with the authoritative-store cutover.

### Task 5: Migrate identity and authentication vertical slice

**Files:**
- Create: `server/repositories/identity.mjs`
- Modify: `server/auth.mjs`
- Modify: identity registration/lookup routes in `server/api.mjs`
- Create: `scripts/postgres-identity-acceptance.mjs`

**RED→GREEN slices:**
1. Clean database issuer registration returns a one-time key; only hash/prefix persists.
2. Agent registration and wallet metadata round-trip.
3. Known source-visible development hashes are revoked on migration/startup.
4. Authentication rejects inactive/revoked/unknown keys.
5. Concurrent duplicate IDs/keys return stable 409 errors without partial rows.

### Task 6: Migrate jobs and atomic claim leasing

**Files:**
- Create: `server/repositories/jobs.mjs`
- Modify: job/create/list/claim routes in `server/api.mjs`
- Modify: `server/db.mjs` expiry adapter as needed
- Create: `scripts/postgres-claim-concurrency-acceptance.mjs`

**RED:** Launch concurrent claims for one job and assert exactly one succeeds. Test requested-job and candidate-job paths, expired lease recovery, capability/reputation gates, unpaid access rejection, and no stale `claimed_by` state.

**GREEN:** Use a single transaction with row locking (`FOR UPDATE SKIP LOCKED` where appropriate), conditional updates, and a partial unique index or equivalent invariant for one active claim per job.

### Task 7: Migrate Gateway x402 access payments

**Files:**
- Create: `server/repositories/access-payments.mjs`
- Modify: `server/circle-nanopayment.mjs`
- Modify: access routes in `server/api.mjs`
- Create: `scripts/postgres-access-payment-acceptance.mjs`

**RED→GREEN:** Prove one paid access record per job/agent, unique tx/Gateway IDs, payer/address checks, idempotent replay, and concurrent duplicate suppression. Do not treat a request ID as an idempotency key.

### Task 8: Migrate proof submission and verification atomically

**Files:**
- Create: `server/repositories/proofs.mjs`
- Modify: proof route in `server/api.mjs`
- Adapt: `server/verifiers.mjs` only where persistence is coupled
- Create: `scripts/postgres-proof-concurrency-acceptance.mjs`

**RED:** Concurrent submissions with the same proof ID or fingerprint yield one persisted proof. Invalid/duplicate proofs cannot leave claims/jobs in an inconsistent state. Accepted deterministic proofs atomically update proof, claim, job, and reputation event state.

**GREEN:** Keep deterministic verification pure; persist its outcome in one transaction. Because Prooflet intentionally stores duplicate-rejection proofs with the same fingerprint, serialize canonical duplicate detection with a transaction-level advisory lock or a dedicated fingerprint-reservation table rather than a blanket unique constraint on `proofs.fingerprint`.

### Task 9: Migrate reputation and adjudication

**Files:**
- Create: `server/repositories/reputation.mjs`
- Create: `server/repositories/adjudication.mjs`
- Modify: `server/reputation.mjs`
- Modify: `server/adjudication/index.mjs`
- Modify: `server/adjudication/genlayer.mjs`
- Create: Postgres acceptance scripts for both flows

**RED→GREEN:** Test deterministic rebuild, immutable event insertion, one decision per proof, pending proofs excluded from payout, concurrent decision suppression, GenLayer request idempotency, and explicit failure categories without raw upstream secrets.

### Task 10: Migrate settlement and operator flows

**Files:**
- Create: `server/repositories/settlement.mjs`
- Modify: `server/settlement.mjs`
- Modify: `workers/settlement-daemon.mjs`
- Modify: `scripts/export-settlement-batch.mjs`, `scripts/arc-settle-batch.mjs`, `scripts/remote-settle-batch.mjs`
- Create: `scripts/postgres-settlement-concurrency-acceptance.mjs`

**RED:** Prove a batch is prepared once, executing lock is acquired once, transaction hash is unique, paid proofs cannot be re-batched, partial failures remain auditable, and receipt replay is idempotent/conflict-safe.

**GREEN:** Use explicit state-transition predicates plus row locks. Keep hosted settlement mode `off`; signer/private key stays outside Render. Before any execute-mode use, persist a stable transfer-attempt/idempotency key before the external send and reconcile ambiguous send outcomes after restart instead of automatically resending or releasing proofs.

### Task 11: Migrate uploads and compound jobs

**Files:**
- Create repositories for `issuer_uploads`, `issuer_upload_rows`, and `compound_jobs`
- Modify: `server/uploads.mjs`, `server/compound-jobs.mjs`
- Add Postgres acceptance coverage

**RED→GREEN:** Preserve strict/valid-only upload atomicity, row validation, confirmation idempotency, sub-job linkage, and parent completion/failure transitions.

### Task 12: Backend-aware API startup, health, and scripts

**Files:**
- Modify: `server/api.mjs`
- Modify: `scripts/server.mjs`, DB/admin scripts, and hosted smoke script
- Modify: `render.yaml` only after Neon credentials are configured in Render
- Update: `.github/workflows/post-submission-ci.yml`

**Requirements:**
- async startup completes migrations before listening;
- graceful shutdown drains the pool;
- `/health` reports `backend: postgres`, connectivity, migration version, and no paths/secrets;
- mutating endpoints wait for durable storage and return stable sanitized errors;
- SQLite-only backup/restore commands fail clearly when Postgres is selected;
- CI runs SQLite suite plus Postgres integration suite against a disposable service/container.

### Task 13: Configure Neon and deploy without exposing secrets

**External steps:**
1. Create/select a Neon free project through the user's authenticated browser when available.
2. Put `DATABASE_URL` directly in Render's secret manager; never paste it into chat, logs, files, or GitHub.
3. Use the Neon pooled (`-pooler`) URL for runtime and one direct URL only for migrations/dumps when required; never disable TLS verification.
4. Set `DB_DIALECT=postgres`, `PGPOOL_MAX=3`, and a fail-closed production backend requirement.
5. Deploy to a preview/feature service if available; otherwise use a controlled main cutover because the current ledger is clean/empty.
6. Verify migrations and clean production state.

**Blocker rule:** If authenticated Neon/Render access or credentials are unavailable, stop at a fully tested undeployed adapter. Do not remove the working free SQLite profile or claim the cutover happened.

### Task 14: Hosted persistence and concurrency proof

**Verification:**
1. Register uniquely named issuer and agent records without printing one-time credentials.
2. Create a unique job and exercise payment/claim/proof paths where testnet prerequisites allow.
3. Fetch record-specific API responses and save only non-secret IDs/counts.
4. Trigger a real Render redeploy/restart.
5. Refetch the exact records and assert equality.
6. Run concurrent claim/proof/payment/settlement tests against hosted or a controlled integration environment.
7. Browser-smoke `/`, `/dashboard`, `/issuer`, `/agents`, `/protocol`; require no fatal errors and truthful live/archive labels.

### Task 15: Final review, CI, merge, and Escrow V2 gate

**Steps:**
1. Stage the complete candidate, record its diff digest, and freeze it.
2. Run full SQLite and Postgres suites, build, audit, syntax/YAML checks, and secret scan.
3. Dispatch independent security/data-integrity and operations/frontend reviewers against the frozen digest.
4. Fix findings with new failing tests; re-freeze and re-review after any change.
5. Commit/push PR, verify GitHub CI, merge only when clean.
6. Deploy, rerun hosted persistence/browser proof, and document exact evidence.
7. Mark the Escrow V2 gate open only if every acceptance gate at the top of this plan passes.

---

## Risks and tradeoffs

- This is a broad async refactor; a compatibility wrapper that parses/re-writes SQLite SQL is explicitly rejected.
- Dual backends can drift. The shared behavior suite is mandatory, and production-only invariants must be database-enforced.
- Neon free compute can suspend; pool/connect timeout behavior must be tested and surfaced as unavailable, not data loss.
- JSON, booleans, timestamps, numeric amounts, `INSERT OR IGNORE`, `AUTOINCREMENT`, `PRAGMA`, `BEGIN IMMEDIATE`, `USING(...)`, and SQLite placeholder syntax require deliberate conversion.
- The current hosted ledger is clean and empty, so there is no data migration requirement. If records appear before cutover, stop and inventory/export them rather than silently discarding them.
- Open-market Escrow V2 stays out of scope until durable persistence and concurrency proofs are complete.
