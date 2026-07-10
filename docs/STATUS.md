# WarmPath — status, gaps, and the plan to win

Last updated during the build. This is the honest accounting: what's done, what was cut, what's broken, and what would move us from "qualifies" to "wins."

---

## 1. Where we actually are

**Deployed and working end-to-end.** Live at https://warmpath-glazed.butterbase.dev, repo at https://github.com/MohitBhimrajka/warmpath, 23/23 e2e assertions passing against the live system, a real Stripe test payment completed and verified. The core loop — ask → rank experts on the graph → trace the warm path → request an intro → double-consent → reveal contact — works in a browser and has been driven there, not just asserted in tests.

**But it is not "perfect," and pretending otherwise would be the corner-cut.** There are three requirement risks, one real security bug, and a long list of things that would make it genuinely competitive rather than merely complete. All of it is below.

---

## 2. Mandatory requirements — compliance

| Requirement | State | Notes |
|---|---|---|
| **Neo4j load-bearing** | ✅ Strong | 80-person graph, `shortestPath` + degree centrality in core Cypher. The product *is* the path. This is our strongest pillar. |
| **RocketRide Cloud, called at runtime** | ✅ Good | 2 pipelines deployed to `api.rocketride.ai`, both invoked on every search. Plain-HTTP `fetch`, no localhost. |
| **Butterbase auth** | ✅ Done | Email/password, every route gated, RLS. |
| **Butterbase database** | ✅ Done | 4 tables, RLS user-isolation, double-consent enforced by policy. |
| **Butterbase payments** | ⚠️ **RISK** | The spec says "must actually go through Butterbase payments, not a mock." We use our **own** Stripe test key in a Butterbase function, **not** Butterbase's native billing API — because Butterbase's Connect platform is live-mode only (`livemode:true`) and can't take test card 4242. It's a real Stripe payment, stored in the Butterbase DB via a Butterbase function, but it is *not* Butterbase's billing product. A strict judge could dock this. **See §5 for the fix options.** |
| Live URL | ✅ | `*.butterbase.dev`, verified serving with correct MIME types. |
| Repo + README | ✅ | README has the architecture + graph model. No rendered diagram image yet (ASCII only). |
| Project description | ✅ drafted | In the spec; needs pasting into the submission. |
| Submission | ❌ **not done** | Blocked on your details (LinkedIn, phone) + a go/no-go on public repo (done) and payments framing. |

---

## 3. Spec deliverables — what was built vs. cut

| Deliverable | State |
|---|---|
| Pipeline 1 (query) | ✅ split into `warmpath-extract` + `warmpath-explain` |
| **Pipeline 2 (ingestion)** | ❌ **NOT built.** The spec wanted an AI pipeline that reads fake Slack/doc snippets, extracts `{person, skill, evidence}` triples, and MERGEs them into Neo4j — proving the graph is AI-built. The plan's cut-list marked it droppable and I dropped it. **This is the biggest missing piece, and it's also the best live-demo moment we don't have** (see §6). |
| "Ingest new document" admin button | ❌ not built (depends on Pipeline 2) |
| Login screen | ✅ |
| Search + results screen | ✅ (the hero) |
| Intro request + consent inbox | ✅ full double-consent, two real accounts |
| Paywall modal | ✅ |
| Consent flow | ✅ RLS-enforced, better than the spec's "simplified" ask |
| Cognee (stretch, bonus prize track) | ❌ not attempted |

---

## 4. Known bugs & gaps (by severity)

### ✅ FIXED — identity hijack + pipeline fragility
1. **`me.ts` identity hijack — FIXED.** Identity is now bound **server-side** by an `on-auth` hook (a Butterbase auth hook) using the email the hook receives — the client can no longer choose `person_id` at all. Verified: an attacker account POSTing `{personId:'p-chen'}` stays `p-maya`. Demo accounts are pre-bound and self-heal on every login.
2. **RocketRide stale-token 502 — FIXED (bonus).** RocketRide terminates idle tasks, which had 502'd the whole search. Pipeline specs now live in a `pipeline_state` table; `search`/`explain` transparently recreate a dead pipeline and retry, and the warm cron keeps both alive every 3 min. Verified by deleting a live pipeline mid-run — search recovered and rotated the token with zero user-facing error.

### 🟡 Requirement risk
2. **Payments don't use Butterbase's billing product** (see §2 / §5).

### 🟢 Polish / completeness (each is a "we could have" not a "broken")
3. Fonts are still render-blocking Google Fonts (perf agent: ~100–300 ms LCP + font-swap CLS). Self-hosting fixes it.
4. No KV caching of `(question → skill)` or `(skill → experts)` — repeat demo queries pay full LLM latency every time. Pre-warming the 3 example chips would make demo replays near-instant.
5. README architecture is ASCII; a rendered diagram (Mermaid or an image) reads better to judges.
6. A genuinely new signup silently becomes "Maya Rodriguez" — coherent for the demo, incoherent as a product (ux agent flagged).
7. No demo video.

---

## 5. The payments decision (resolve before submitting)

Butterbase's app-level billing is Stripe **Connect** and the platform account is **live-mode** (`livemode:true`, verified). `POST /billing/subscribe` fails with *"you must set an account or business name"* and test card 4242 is rejected. So native Butterbase billing cannot be exercised with test money.

**Three ways to satisfy "must go through Butterbase payments":**

- **A. Keep the current fallback, frame it honestly.** Own `sk_test_` in a Butterbase function → real Stripe Checkout → state in Butterbase DB. It *is* a real payment orchestrated by Butterbase infrastructure. Lowest risk of breakage, some risk a strict judge calls it not-native. **Current state.**
- **B. Complete live Connect onboarding.** Real bank/identity + a real $3 charge on a real card. Genuinely native, but real money and slow onboarding for a throwaway demo. Not recommended.
- **C. Re-investigate a Butterbase test path.** The research agent is checking whether Butterbase exposes any sandbox/test-mode for app billing that we missed. If it exists, switch to native and this risk evaporates.

**RESOLVED — native billing is blocked on Butterbase's side, not ours.** Probed definitively:
- `GET /billing/connect/status` → `chargesEnabled:false, detailsSubmitted:false` — the platform's Connect account was never onboarded.
- `POST /billing/subscribe` → `500 "In order to use Checkout, you must set an account or business name at dashboard.stripe.com/account"` — a **platform-level** Stripe setting only Butterbase can fix on their own dashboard.
- The platform application is **live-mode**, so test card 4242 can't work even if onboarding completed.

No developer can exercise native app billing today. **Decision: keep A**, but make it maximally native — the Pro plan is defined via Butterbase's native `/billing/plans` API (real Butterbase billing object), the freemium gate and subscription state live entirely in Butterbase, and only the Checkout *session* uses our test key because the platform's Connect isn't operational. Documented in README + raised in the organizer feedback (it's a real platform bug worth their attention).

---

## 6. The plan to actually win

The mandatory bar is "all three platforms load-bearing + it works." We clear that. Winning needs a **wow moment**, **visible depth**, and **maxed scoring surface**. Ranked by impact-per-hour:

### Tier 1 — highest leverage
1. **Build Pipeline 2 (ingestion) + a live "watch the graph grow" demo.** Paste a Slack line → RocketRide LLM extracts `{person, skill, evidence}` → MERGE into Neo4j → the new expertise appears in the next search. This (a) closes the biggest spec gap, (b) makes RocketRide *visibly* load-bearing with two live pipelines, (c) is the single most memorable demo beat we could add. ~2–3 h.
2. **A real graph visualization.** Today the path is a linear chip chain. A force-directed neighborhood view with the shortest path highlighted turns "we use Neo4j" into "look at the graph." For a graph-sponsored hackathon this is the money shot. ~2–3 h (self-contained SVG/canvas, no heavy lib).
3. **Fix the `person_id` security bug** (§4.1). Cheap, and it protects the one claim judges will poke at. ~30 min.

### Tier 2 — scoring surface + demo reliability
4. **Realtime consent inbox.** `manage_realtime` on `intro_requests` → when Chen accepts, Maya's inbox updates live on stage. Adds the "realtime" measured-usage category *and* removes the "requester has to refresh" wart the UX agent flagged. High points-per-effort. ~1–2 h.
5. **Butterbase storage** — a cheap measured-usage category. E.g. export the drafted intro as a file, or store a generated graph snapshot. ~1 h.
6. **KV caching + pre-warm the demo queries** so live replays are instant and the ~13 s wait never bites on stage. ~1 h.
7. **Google/GitHub OAuth login** — one `manage_oauth` call adds the OAuth measured-usage category and makes login feel real. ~30 min.

### Tier 3 — presentation
8. **A 2–3 minute demo video** (structure pending research; likely required or strongly rewarded).
9. **Rendered architecture diagram** in the README.
10. **Cognee stretch** for the bonus track (only if everything above is done).

*(Effort estimates and the exact scoring mechanics will be refined by the research agent that's running now.)*

---

## 7. Submission mechanics

**Deadline: 2026-07-11 07:23:00 UTC** (~26 h from the build). Re-submitting updates and version-bumps, so we can submit a draft early and refine.

**Tool:** `mcp__butterbase__prep_and_submit_hackathon_entry`
- `action: "prep"` with `submission_code: "ENJOY0707"` → returns the field schema (done; captured below).
- `action: "submit"` with `hackathon_slug: "HackwithBay-0707"`, `app_id: "app_zbw633lk53dq"` (worth up to 50 scoring points — always pass it), and `data`.

**Required fields and our values:**

| Field | Value | Status |
|---|---|---|
| `project_title` | WarmPath | ✅ |
| `team_members_names_all` | Mohit Bhimrajka | ⚠️ confirm solo |
| `team_members_emails_all` | mohitbhimrajka5@gmail.com | ✅ |
| `team_members_linkedin` | — | ❌ **need from you** |
| `deployed_project_url` | https://warmpath-glazed.butterbase.dev | ✅ |
| `phone_number` | — | ❌ **need from you** |
| `github_repo` | https://github.com/MohitBhimrajka/warmpath | ✅ |
| `demo_presentation` (optional) | demo video link | ❌ TBD |
| `feedback` (required) | drafted (RocketRide docs vs API, prompt-node state bug, Butterbase live-mode billing, Neo4j db-name gotcha) | ✅ drafted |

**Still to confirm (research agent is checking):** whether there's ALSO a Devpost/Devfolio form, a required demo video length, or a required social post tagging the sponsors. Many hackathons require a video + public post; we must not miss that.
