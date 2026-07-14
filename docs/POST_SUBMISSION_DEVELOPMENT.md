# Post-submission Development

Everything after commit `298415b1bcca803436812327a07a93e77aadb590` is post-submission development and was not part of the original Lepton Agents Hackathon submission.

The immutable archival tag is `lepton-submission-2026-07-06`.

## P1: Durability tooling and hosted hardening

This phase keeps Prooflet on Arc Testnet and keeps settlement signing outside the hosted API. It adds fail-closed persistent-path validation, restart-survival checks, online backup and integrity-checked restore tooling, operational health metadata, request correlation, stricter CORS, security headers, hosted smoke checks, and CI. The public Render service remains on the free ephemeral profile for now.

This is a durability and operations milestone. It does not make Prooflet audited, mainnet-ready, horizontally scalable, or capable of open-market Escrow V2 funding.

## Deployment boundary

The current Render profile remains free and uses `/tmp/prooflet.sqlite`; `/health` therefore reports `storage.durable: false`. A future approved persistent-disk profile would set:

- `UWP_DB_PATH=/var/data/prooflet.sqlite`
- `PROOFLET_STORAGE_DURABILITY=persistent-disk`
- `PROOFLET_PERSISTENT_MOUNT_PATH=/var/data`
- `PROOFLET_DURABLE_STORAGE_REQUIRED=true`

The API refuses to start in production when durable storage is required but the database path is ephemeral or the persistence mode is not explicitly configured.

Production seeding is disabled at the application layer, migration 13 revokes every source-visible development API key, and settlement/operator scripts never seed the database. Demo fixtures are restricted to explicit non-production test databases.

A Render persistent disk requires a paid service plan and prevents zero-downtime deploys. That rollout is deferred. If reconsidered, obtain billing and maintenance-window approval before changing `render.yaml`. `/health` reports configured storage state only; actual durability requires a write → Render restart/redeploy → read survival test.

The audited pre-cutover hosted counts match the public submission fixtures (4 agents, 6 jobs, 4 proofs); no external hosted records were identified. Do not silently assume that remains true. Immediately before cutover, freeze writes and compare a fresh inventory. If any non-fixture record exists, stop and export it before switching from `/tmp/prooflet.sqlite` to `/var/data/prooflet.sqlite`. Otherwise, start the durable ledger clean rather than reintroducing source-visible fixture credentials or synthetic settlement history.

## Operations

Run all post-submission checks:

```bash
npm run post-submission:check
```

For a future persistent SQLite deployment, create a unique online backup plus checksum manifest (existing artifacts are never overwritten):

```bash
npm run db:backup -- --output /var/data/backups/prooflet.sqlite
```

A backup on `/var/data` protects against application-level corruption and supports restore drills, but it is not an off-site backup. Production requires an explicit output path. Copy both the `.sqlite` artifact and its `.manifest.json` to separately controlled storage. Retain daily backups for 14 days and a weekly backup for 8 weeks; complete a restore drill at least monthly. This policy is an operator requirement, not automation provided by this repository.

Restore accepts only manifest-backed artifacts created by `db:backup`. Restore only during an approved maintenance window while the API, workers, and settlement processes are stopped:

```bash
npm run db:restore -- --input /var/data/backups/prooflet.sqlite --confirm-api-stopped
```

After a future durable profile is approved and applied, smoke-test the configured hosted environment:

```bash
PROOFLET_SMOKE_URL=https://prooflet-api.onrender.com \
PROOFLET_EXPECT_DURABLE=true \
npm run smoke:hosted
```

Then create a uniquely identified probe through the API, restart/redeploy the Render service, and verify the same record and counts remain. Only that remote restart test is evidence that the disk survives a platform lifecycle event.

## Acceptance evidence

The automated production-core acceptance check proves:

- health reports database connectivity and migration version without exposing paths;
- configured frontend origins are allowed without reflecting arbitrary origins;
- unexpected server failures return a request ID and do not expose raw error details;
- production can fail closed on ephemeral storage;
- committed state survives local close/reopen;
- backup and restore preserve state, require a manifest/checksum, validate the Prooflet schema, and pass SQLite integrity checks.

Existing submission checks continue to cover API authentication, x402 access records, lease expiry, structured proof-packet validation, duplicate rejection, settlement exclusion, receipt replay protection, and batch locking.
