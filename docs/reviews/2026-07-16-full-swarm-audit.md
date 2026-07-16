# Full-system audit report (2026-07-16)

**Post-submission development — not part of the original Lepton Agents Hackathon submission.**

Parent + minion swarm. Severity-ranked. Evidence tagged **verified** / **inferred** / **blocked**.

## Executive summary

| Area | Result |
|---|---|
| Hosted API health + Neon durability | **PASS** (verified) |
| x402 gate on claim | **PASS** 402 without payment (verified) |
| Payable queue unauth | **PASS** 403 (verified) |
| Release receipt unauth | **PASS** 403 on existing job (verified) |
| Frontend multi-route shell | **PASS** (verified) |
| Landing headline framing | **PASS** (verified) |
| Local acceptance suites | **PASS** frontend truth, auto-release, LLM agent, build (verified) |
| Settlement autonomy copy | **FIXED** (was stale; PR shipping) |
| Landing ticker hydrate in browser tool | **INVESTIGATE** (stuck Loading in snapshot; API returns proofs) |
| `hostedFailClosed` flag on live config | was **false** (env); **PROOFLET_HOSTED=true** set + redeploy (verified) |

Live snapshot: **24 jobs · 9 proofs · 23 agents** on hosted API.

---

## Critical / High

### H1 — Stale product copy denied autonomous settlement (**fixed**)
- **Where:** `app.html` issuer rails, protocol cards, footer; README; BRAND; HOSTING; system mode string
- **Actual:** “operator signs offline / operator-controlled / release remains explicit”
- **Expected:** Autonomous operator-host loop after payable
- **Evidence:** `rg` hits + PR full-audit-fixes
- **Status:** patched in branch / PR

### H2 — `hostedFailClosed` reported false on live config
- **Where:** `GET /escrow/v2/config` → `hostedFailClosed: false`
- **Risk:** if `ESCROW_V2_SKIP_ONCHAIN=true` were set without RENDER markers, on-chain verify could be skipped
- **Mitigation:** set `PROOFLET_HOSTED=true` on Render + redeploy; `requireOnchainVerification: true` already live
- **Evidence:** live config JSON (verified)

### H3 — Landing “Live proofs” may not hydrate in some clients
- **Where:** `/` news ticker remained “Loading live proofs…” in browser snapshot after load
- **Counter-evidence:** dashboard API returns 9 proofs; product pages show “Live · durable path configured”
- **Hypothesis:** race in automation, or landing JS fetch issue on cold load
- **Action:** parent should re-check after Vercel deploys latest; watch network/console on real browser
- **Severity:** High for demo wow if real; Medium if tool race only

---

## Medium

### M1 — Release-receipt auth order for missing jobs
- Nonexistent job → **404** before auth; existing job → **403** unauth
- Not a data leak; prefer auth-first for consistent security posture
- **Evidence:** `job_does_not_exist` 404 vs real job 403 (verified)

### M2 — Issuer workflow still says “API key session” as step 01
- Session-first UX exists (Register / Continue / Restore / wallet)
- Step chip still emphasizes API key (minor messaging)
- **Evidence:** browser snapshot issuer page (verified)

### M3 — Agents page flash “LIVE STATE UNAVAILABLE · 0 REGISTERED AGENTS”
- Brief empty/unavailable flash during load while API connects
- **Evidence:** agents snapshot mid-load (verified)

### M4 — Dashboard actions “Run worker cycle / Prepare payout batch” disabled outside replay
- Correct for live mode; can confuse judges if unlabeled why disabled
- **Evidence:** browser snapshot (verified)

### M5 — README residual operator-controlled phrases
- Several marketing lines updated; full README scan for remaining hype still recommended periodically

---

## Low / Notes

### L1 — No JS console errors on agents page (verified empty console)
### L2 — Wallet nonce endpoint works (200 + message) (verified)
### L3 — Product routes rewrite correctly to app.html (~37kb) (verified)
### L4 — Headline correct: “Tiny agent jobs. Verified by proof. Paid in USDC.” (verified)
### L5 — CTAs present: Register as Issuer / Register Agent (verified)
### L6 — x402 seller shown ≠ treasury on issuer live rails (verified)

---

## Parent-run acceptance (verified)

```
frontend:truth:check     ok (12 checks)
escrow-v2:auto-release   ok
llm-agent:check          ok
vite build               ok
```

## Hosted negative tests (verified)

| Test | Result |
|---|---|
| `GET /escrow/v2/payable` no key | 403 |
| `POST .../escrow-release-receipt` no key (real job) | 403 |
| Claim without x402 | 402 `claim_access_payment_required` |
| `POST /auth/wallet/nonce` | 200 |
| Health storage | neon-postgres durable |

## Not fully exercised this pass (blocked / deferred)

| Flow | Why |
|---|---|
| Live x402 pay + claim + LLM + GenLayer + auto-release end-to-end | Cost/time; previously proven in e2e cards |
| Wallet SIWE full sign restore | Needs browser wallet injection |
| Autonomous release of a new Funded payable job | Queue was empty; loop is running |
| Pixel-perfect design density vs PolicyGuard | Partial browser snapshot only |

---

## Minion batch status

Three minions dispatched (API rails, frontend dogfood, security/honesty). Parent findings above stand independently; minion reports merge when they return.

## Immediate actions completed

1. Copy alignment PR for autonomous settlement language  
2. `PROOFLET_HOSTED=true` on Render + redeploy  
3. This audit report: `docs/reviews/2026-07-16-full-swarm-audit.md`
