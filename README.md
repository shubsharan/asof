# AsOf

AsOf is an acquisition-diligence app that keeps a living, time-versioned investment thesis for a small set of acquisition targets.

It answers three questions for an investment team:

1. **What do we know about this company right now?**
2. **What changed that should move our investment thesis?**
3. **What could we reasonably have known when we made an earlier decision?**

It uses four Exa products: Search, Agent, Monitor, and Snapshot.

## Who it's for

A middle-market private equity or corporate development team evaluating 2–3 acquisition targets over several weeks. The user is an investment associate or principal. Their job is to keep diligence current between first research and investment committee (IC).

The problem: diligence goes stale fast. Teams search for the same information over and over, they miss important outside developments, and afterward it's hard to separate what was knowable at the time from what only looks obvious now.

---

## Core concept

Every investment prospect is represented as a series of investment hypotheses:

| Hypothesis | Status | Confidence |
|---|---|---:|
| Enterprise adoption is accelerating | Supported | 82% |
| Product differentiation is defensible | Mixed | 67% |
| Management team can scale | Supported | 76% |
| Competitive moat is strengthening | At risk | 58% |

Each hypothesis depends on cited evidence for/against

**Evidence changes -> hypotheses change -> investment thesis changes.**

AsOf keeps the history of every one of those changes.

---

## Architecture

### 1. Search: investigate

Search handles research.

> Find evidence related to Acme's move upmarket, including enterprise customer wins, pricing changes, certifications, product launches, partnerships, and customer commentary.

Results show up as structured evidence:

```ts
type Evidence = {
  title: string;
  claim: string;
  url: string;
  publishedAt?: string;
  relevance: string;
  direction: "supports" | "contradicts" | "neutral";
};
```

### 2. Agent: evaluate

Agent runs deeper diligence when a hypothesis needs a real evaluation.

> Evaluate whether Acme is successfully moving upmarket. Research additional evidence as needed. Identify supporting evidence, contradictory evidence, unresolved questions, and recommend whether confidence in the hypothesis should increase or decrease.

The app turns the result into a thesis update:

```ts
type ThesisUpdate = {
  previousConfidence: number;
  currentConfidence: number;
  status: "supported" | "mixed" | "contradicted";
  reasoning: string;
  supportingEvidence: Evidence[];
  contradictingEvidence: Evidence[];
  openQuestions: string[];
};
```

### 3. Monitor: track assumptions

Monitor is the always-on layer. We don't create one generic "News about Acme" monitor. That's mostly noise. We create one monitor per assumption the deal depends on:

**Enterprise adoption**

> Find newly published evidence suggesting that Acme is gaining or losing enterprise adoption, including customer wins, churn, enterprise product capabilities, pricing changes, security certifications, implementation hiring, and partnerships.

**Management quality**

> Find executive hires, departures, reorganizations, board changes, or other evidence relevant to Acme's management team's ability to scale the company.

**Competitive moat**

> Find new competitor launches, product releases, partnerships, patents, technical advances, or customer comparisons that materially affect Acme's differentiation.

Monitor results feed a chronological stream of new evidence, each item tied to the hypothesis it affects.

### 4. Snapshot: rewind

This is the most interesting feature.

The user picks a past date and asks: what did the web look like when we made this decision? AsOf uses Exa's historical snapshot capability to search only information available by that date.

The user can then compare two points in time:

```text
MARCH 1, 2026                        TODAY

Competitive threat: LOW              Competitive threat: HIGH

Evidence available:                  New evidence:
- Competitor X had ~15 employees     - Series B announced
- No major enterprise customers      - Salesforce partnership
- Seed-stage funding                 - Enterprise launch
- SMB positioning                    - Multiple Fortune 100 customers
```

The result is a version-controlled investment thesis backed by a version-controlled web.

---

## Demo scope

The demo has one target company.

Flow:

```text
Portfolio → Target company → Investment hypotheses → Evidence timeline
→ Run diligence → New evidence appears → Hypothesis changes
→ Rewind to earlier date
```

### Screen 1: Portfolio

Three targets. Only Acme needs to work.

```text
Active Diligence

Acme Security     4 hypotheses | 2 changes this week
Northstar AI      5 hypotheses | 0 changes
Vector Systems    4 hypotheses | 1 change
```

### Screen 2: Target overview

The main demo screen. The thesis:

```text
ACME SECURITY — Investment thesis

Enterprise adoption          82%   Supported
Product differentiation      71%   Supported
Management scalability       76%   Supported
Competitive moat             58%   At risk
```

Next to it, recent evidence:

```text
TODAY        New competitor enterprise launch   – weakens competitive moat
2 DAYS AGO   New Fortune 500 customer           + supports enterprise adoption
5 DAYS AGO   VP Sales departure                 – weakens management confidence
```

### Screen 3: Hypothesis detail

Clicking **Enterprise adoption is accelerating** shows:

```text
Confidence: 74% → 86%

Why it changed
+ Enterprise pricing launched
+ 3 Fortune 500 customer announcements
+ SOC 2 investment

Remaining concern
? No strong evidence yet about enterprise retention
```

Cited evidence goes below. One button, **Run deeper diligence**, calls Agent.

### Screen 4: Rewind

The climax of the demo. A simple timeline:

```text
Jan 12      Mar 1       Jun 4       Today
   ●──────────●────────────●──────────●
```

Clicking March 1 shows a banner, *Viewing AsOf as of March 1, 2026*, and resets the thesis and evidence to what was available then.

**Compare with today** shows:

| | March 1 | Today |
|---|---:|---:|
| Competitive threat | Low | High |
| Confidence | 81% | 58% |
| Known competitors | 3 | 7 |
| Material evidence | 5 items | 14 items |

This is the screen that makes Snapshot obvious to the interviewer.

---

## Implementation

Keep it simple. The whole app runs on [Bun](https://bun.sh): one process, one command, no Vite, no Hono/Express.

- **Server:** `Bun.serve()` with its built-in `routes` (methods and path params included)
- **Front end:** Bun HTML imports. `index.html` is imported into the server and Bun bundles the React/TSX (HMR in dev)
- **Storage:** `bun:sqlite`, built in
- **Dependencies:** `react`, `react-dom`, `exa-js`

```ts
// server.ts
import index from "./index.html";
import { Database } from "bun:sqlite";

const db = new Database("asof.sqlite");

Bun.serve({
  routes: {
    "/*": index, // React app
    "/api/research/search": { POST: async (req) => Response.json(await search(await req.json())) },
    "/api/research/agent":  { POST: async (req) => Response.json(await runAgent(await req.json())) },
    "/api/monitor/create":  { POST: async (req) => Response.json(await createMonitor(await req.json())) },
    "/api/monitor/events":  { GET: () => Response.json(listMonitorEvents()) },
    "/api/snapshot":        { POST: async (req) => Response.json(await snapshot(await req.json())) },
  },
  development: { hmr: true, console: true },
});
```

```bash
bun install
bun --hot server.ts
```

### Front end

React, bundled by Bun from `index.html` → `src/main.tsx`. Components:

```text
Portfolio
TargetOverview
HypothesisCard
EvidenceFeed
HypothesisDetail
Timeline / Rewind
```

### Back end

The same `Bun.serve()` process, under `/api` so the routes don't collide with the front end:

```text
POST /api/research/search
POST /api/research/agent
POST /api/monitor/create
GET  /api/monitor/events
POST /api/snapshot
```

State lives in SQLite via `bun:sqlite`.

### Out of scope

- Authentication
- Multi-tenancy
- Queues
- Sophisticated agent orchestration
- Production scheduling
- Vector databases
- A real investment model

### Seeded vs. live

Don't rely on every part of the demo running live.

**Seed:**

- The company
- Four hypotheses
- Historical confidence values
- Several existing evidence items
- One or two historical Monitor events

**Run live on Exa:**

1. Search investigation
2. Agent diligence
3. Snapshot historical search

Monitor can be configured for real ahead of time, or shown using results we collected earlier. Either way the demo stays reliable and still shows real APIs.

### Data model

```ts
type Company = {
  id: string;
  name: string;
  description: string;
  hypotheses: Hypothesis[];
};

type Hypothesis = {
  id: string;
  statement: string;
  status: "supported" | "mixed" | "at-risk" | "contradicted";
  confidence: number;
  evidence: Evidence[];
  history: HypothesisVersion[];
};

type HypothesisVersion = {
  date: string;
  confidence: number;
  status: string;
  reasoning: string;
};

type Evidence = {
  id: string;
  title: string;
  claim: string;
  url: string;
  publishedAt?: string;
  discoveredAt: string;
  direction: "supports" | "contradicts" | "neutral";
  source: "search" | "agent" | "monitor";
};
```