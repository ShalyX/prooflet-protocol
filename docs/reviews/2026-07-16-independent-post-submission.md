# Independent review — Prooflet post-submission (origin/main `dca7592`)

**Date:** 2026-07-16
**Scope:** Post-boundary work after `298415b` (durable Neon, Escrow V2, x402, faucet, UI polish)
**Live API:** https://prooflet-api.onrender.com

## Verdict

**PASS with residual P2s** — no P0/P1 found that block Arc Testnet demos or indicate hosted key compromise. Safe to continue real demos.

## Live config (spot-check)

| Signal | Observed |
|---|---|
| Storage | `neon-postgres`, `durable: true` |
| Escrow V2 | `0x55bde7…eee9`, configured |
| On-chain fund verify | `requireOnchainVerification: true` |
| x402 seller | `0x8183…FE6c`, `selfSellerRisk: false` |
| Access fee | `0.000001` USDC Gateway |

## Security

### OK
- Issuer faucet + fund-from-circle-wallet require `authenticate(db, request, "issuer", issuerId)`.
- Job ownership: `SELECT … WHERE job_id = ? AND issuer_id = ?`.
- Fund-escrow requires tx hash shape + on-chain verify when V2 configured (live: required).
- Agent claim/proof require agent API key.
- Circle entity secret / API key only in env; not returned by public config endpoints.
- Operator auto-release is offline CLI (`--execute`), not hosted API.

### Residual (P2)
1. **Demo issuer key material in frontend source** (`useful_waiting_protocol` / `uwp_issuer_useful_waiting_protocol_dev`) — local DEV helper + demo connect button. Production should continue to **reject revoked** dev hashes (existing migration). Prefer removing hardcoded key from production bundle later.
2. **No rate limit on faucet endpoint** — authenticated only; free-tier Circle API already forbids drips, but manual spam could burn Circle rate limits.
3. **`acceptReportedFunding` defaults true** — gated by `requireOnchainVerification` when contract configured; live is safe. Document that mis-setting `ESCROW_V2_SKIP_ONCHAIN=true` on Render would open soft-fund path.
4. **Server-side Circle fund** uses host entity secret to spend **issuer’s** DCW — correct for product, but means Circle console compromise = spendable wallets. Acceptable for testnet DCW model; do not claim “non-custodial UI”.

## Logic / honesty

### OK
- UI metrics live vs replay separated (Open jobs vs worker cycles).
- Live rails panel hydrates from API.
- README V2-first; V1 archived.
- x402 seller ≠ treasury advertised via `selfSellerRisk`.

### Residual honesty gaps (non-blocking)
1. Protocol page still mentions settlement daemon language in places; operator release is the V2 path of record.
2. Circle programmatic faucet often **Forbidden** — product correctly falls back to web faucet; marketing must not claim “one-click API faucet always works”.
3. Historical submission docs (JUDGE_PACKET etc.) still V1-centric by design (immutable era).

## Postgres dual-connection

Prior PRs fixed reputation-after-commit and proof tx-scoped reads. No new outer-`db` inside transaction pattern spotted on fund-from-circle path (uses Circle then `fund-escrow` update outside nested reputation writes).

## Recommendations (next polish, not blockers)

1. Strip hardcoded demo API key from non-DEV production bundle.
2. Optional soft rate-limit on `/issuers/:id/faucet` (e.g. 1/min).
3. Assert on Render: `ESCROW_V2_SKIP_ONCHAIN` unset, `ESCROW_V2_ACCEPT_REPORTED_FUNDING` optional.
4. Keep independent review fresh after any payment-path change.

## Verdict (updated after live demos)

**PASS with residual P1/P2s** — auth gates sound; two dual-connection bugs found and fixed in this pass:

1. **P1 fixed:** `POST /jobs` funding_rail UPDATE used outer `db` inside transaction → Neon left rail as `direct_treasury`. Fixed by passing `fundingRail` into `createJob` INSERT.
2. **P1 fixed:** `claim-job` returned job via outer `db` before commit visibility → response showed `open` while row was `claimed`. Fixed by reading claimed job from `tx.jobs.getJob` and reputation after commit.
3. **P1 fixed:** `executeContract` dropped `idempotencyKey` from destructuring (ReferenceError).

### Live demo progress (2026-07-16)

| Step | Result |
|---|---|
| Independent review | Written `docs/reviews/2026-07-16-independent-post-submission.md` |
| Faucet-funded job still open | `job_faucet_live_mrmdqhdq` · fund `0xfae88603…` · **treasuryUsed=false** |
| x402 access | Succeeded earlier (gateway IDs recorded); later runs hit **insufficient_balance** on treasury Gateway deposit |
| Claim | Worked on-chain of record (`claimedBy` set); API response was stale until fix |
| Circle DCW write APIs | Currently return `API parameter invalid (2)` for transfer + contract execution — blocks new faucet→fundJob until Circle recovers/entity secret revalidated |
| Release | Blocked pending payable proof |

### Blockers for completing agent→release now

1. Treasury Gateway USDC insufficient for more x402 pays
2. Circle W3S mutation API rejecting writes (cannot top-up treasury from faucet wallet or fund new escrow jobs)

### Recommendation

Re-validate `CIRCLE_ENTITY_SECRET` / rotate if needed; top up Gateway buyer balance; re-run agent close on `job_faucet_live_mrmdqhdq` or a new faucet-funded job after Circle writes work again.
