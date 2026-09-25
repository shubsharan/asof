import { createDb } from "./db/schema";
import { assessHypothesis, getCompany, listPortfolio, recordEvidence } from "./db/queries";
import { evaluateHypothesis } from "./exa/agent";
import { searchEvidence } from "./exa/search";

const db = createDb();

/** Reads `{ companyId, hypothesisId }` from a research request and loads both. */
async function target(req: Request) {
  const { companyId, hypothesisId } = (await req.json()) as { companyId: string; hypothesisId: string };
  const company = getCompany(db, companyId);
  const hypothesis = company?.hypotheses.find((h) => h.id === hypothesisId);
  return company && hypothesis ? { company, hypothesis } : undefined;
}

const notFound = () => new Response("Not found", { status: 404 });

const server = Bun.serve({
  // Agent runs take minutes; don't drop the connection while waiting.
  idleTimeout: 0,
  routes: {
    "/api/portfolio": { GET: () => Response.json(listPortfolio(db)) },
    "/api/companies/:id": {
      GET: (req) => {
        const asOf = new URL(req.url).searchParams.get("asOf") ?? undefined;
        const company = getCompany(db, req.params.id, asOf);
        return company ? Response.json(company) : notFound();
      },
    },
    "/api/research/search": {
      POST: async (req) => {
        const t = await target(req);
        if (!t) return notFound();
        const found = await searchEvidence(t.company, t.hypothesis);
        return Response.json(recordEvidence(db, t.hypothesis.id, found, "search"));
      },
    },
    "/api/research/agent": {
      POST: async (req) => {
        const t = await target(req);
        if (!t) return notFound();
        const { citedUrls, newEvidence, ...assessment } = await evaluateHypothesis(t.company, t.hypothesis);
        const added = recordEvidence(db, t.hypothesis.id, newEvidence, "agent");
        const cited = new Set(citedUrls);
        const evidenceIds = [...t.hypothesis.evidence, ...added].filter((e) => cited.has(e.url)).map((e) => e.id);
        assessHypothesis(db, t.hypothesis.id, { ...assessment, evidenceIds });
        return Response.json(getCompany(db, t.company.id)!.hypotheses.find((h) => h.id === t.hypothesis.id));
      },
    },
  },
});

console.log(`AsOf listening on ${server.url}`);
