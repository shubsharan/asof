import { createDb } from "./db/schema";
import { getCompany, listPortfolio, recordEvidence } from "./db/queries";
import { searchEvidence } from "./exa/search";

const db = createDb();

const server = Bun.serve({
  routes: {
    "/api/portfolio": { GET: () => Response.json(listPortfolio(db)) },
    "/api/companies/:id": {
      GET: (req) => {
        const asOf = new URL(req.url).searchParams.get("asOf") ?? undefined;
        const company = getCompany(db, req.params.id, asOf);
        return company ? Response.json(company) : new Response("Not found", { status: 404 });
      },
    },
    "/api/research/search": {
      POST: async (req) => {
        const { companyId, hypothesisId } = (await req.json()) as { companyId: string; hypothesisId: string };
        const company = getCompany(db, companyId);
        const hypothesis = company?.hypotheses.find((h) => h.id === hypothesisId);
        if (!company || !hypothesis) return new Response("Not found", { status: 404 });
        const found = await searchEvidence(company, hypothesis);
        return Response.json(recordEvidence(db, hypothesis.id, found, "search"));
      },
    },
  },
});

console.log(`AsOf listening on ${server.url}`);
