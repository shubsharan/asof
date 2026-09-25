import { createDb } from "./db/schema";
import { getCompany, listPortfolio } from "./db/queries";
import { loadHypothesis, runAgent, runSearch } from "./research";

const db = createDb();

const notFound = () => new Response("Not found", { status: 404 });

/** Loads the `{ companyId, hypothesisId }` a research request targets. */
async function target(req: Request) {
  const { companyId, hypothesisId } = (await req.json()) as { companyId: string; hypothesisId: string };
  return loadHypothesis(db, companyId, hypothesisId);
}

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
        return t ? Response.json(await runSearch(db, t.company, t.hypothesis)) : notFound();
      },
    },
    "/api/research/agent": {
      POST: async (req) => {
        const t = await target(req);
        return t ? Response.json(await runAgent(db, t.company, t.hypothesis)) : notFound();
      },
    },
  },
});

console.log(`AsOf listening on ${server.url}`);
