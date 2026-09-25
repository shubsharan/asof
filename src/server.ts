import index from "./index.html";
import { createDb } from "./db/schema";
import { getCompany, listPortfolio } from "./db/queries";
import { pageThenAndNow } from "./exa/snapshot";
import { loadHypothesis, pullMonitor, runAgent, runSearch, startMonitor } from "./research";

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
    "/*": index, // React app; the /api routes below take precedence
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
    "/api/snapshot": {
      POST: async (req) => {
        const { url, asOf } = (await req.json()) as { url: string; asOf: string };
        return Response.json(await pageThenAndNow(url, asOf));
      },
    },
    "/api/companies/:id/monitor": {
      POST: async (req) => {
        const company = getCompany(db, req.params.id);
        if (!company) return notFound();
        await startMonitor(db, company);
        return Response.json({ monitorId: getCompany(db, company.id)!.monitorId });
      },
    },
    "/api/companies/:id/monitor/pull": {
      POST: async (req) => {
        const company = getCompany(db, req.params.id);
        return company ? Response.json(await pullMonitor(db, company)) : notFound();
      },
    },
  },
  development: { hmr: true, console: true },
});

console.log(`AsOf listening on ${server.url}`);
