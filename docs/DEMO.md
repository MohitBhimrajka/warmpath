# WarmPath — demo script (2:00–2:30)

Record at 1440px, dark theme, voice-over. **Run `node scripts/reset-demo.js` first** so the graph is clean and Maya has 3 free searches. Keep it one real, unedited run — judges reward live reliability.

Login is pre-filled with `maya.demo@warmpath.dev`. Have a second browser/tab signed in as `chen.demo@warmpath.dev` ready for the consent beat.

---

**0:00–0:15 — Hook.** *(on the search screen)*
> "In every company, the answer to 'who actually knows about X' is trapped in someone's head. Directories list job titles, not expertise — and cold-messaging a stranger rarely works. WarmPath finds who really knows, and the shortest *trusted* path to reach them."

**0:15–0:45 — The graph is the product.** Click the **"Who knows about SAP integration?"** chip.
> "I ask in plain language. A RocketRide Cloud pipeline pulls out the skill, and Neo4j does the real work — ranking experts and tracing the shortest collaboration path from me."

When results land, point at the **graph visualization**:
> "This is the collaboration graph around my question. Chen Wei is the top expert — he built our SAP connector — but look: he's barely connected. The one warm route to him threads through Priya, who I already co-led a project with. That's the trust path, lit through the network."

Tap another expert node:
> "Tap anyone and it re-routes the introduction live."

**0:45–1:15 — Ranking that only a graph can do.** Search **"we keep having pod evictions in prod."**
> "Two people are equally expert on Kubernetes. WarmPath breaks the tie by collaboration centrality — Arjun works with twelve people, Tomas with three — so Arjun is both more expert *and* more reachable. That's graph reasoning you can't get from flat rows."

**1:15–1:45 — Watch the graph grow (the AI-built graph).** Go to **"Grow the graph."** Paste the Chen quantum sample, click **Read into the graph.**
> "The graph isn't static. I paste a Slack message about Chen's quantum side-project — a second RocketRide pipeline extracts the fact and writes it straight into Neo4j."

Click **"Search for Quantum Error Correction →."**
> "And now he's instantly findable on it, with a warm path. The graph learns from natural language."

**1:45–2:10 — Double consent + realtime + payments.** Click **Ask for an intro** on an expert.
> "Reaching out is double-consent — I ask, but Chen's contact stays hidden until *he* says yes. That's enforced in the database, not just the UI."

Switch to the Chen tab, **Accept.** Switch back to Maya — the inbox has updated **live**:
> "He accepts, and my inbox updates in real time over a WebSocket. Only now is his contact released, with an AI-drafted introduction I can download and send."

*(If showing the paywall:)* "Three free searches, then a real Stripe checkout — test card, real payment, verified server-side."

**2:10–2:25 — Architecture + impact.**
> "Three platforms, each load-bearing: **Neo4j** is the relationship graph and the pathfinding; **RocketRide Cloud** runs three live pipelines that turn language into graph operations; **Butterbase** is auth, the database, realtime, storage, payments, and the whole app. WarmPath turns 'who knows X' from days of Slack archaeology into one warm introduction."

---

### Fallbacks if something is slow
- First search after idle can take a few seconds — the warm cron keeps it hot, but pause on the graph viz while it loads.
- If a pipeline was terminated, the first call self-heals (recreates + retries) — it just adds ~2s, no error.
- Keep the Chen tab already signed in so the consent beat is instant.
