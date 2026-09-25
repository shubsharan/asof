import { createDb } from "./db/schema";
import { getCompany, listPortfolio } from "./db/queries";

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
  },
});

console.log(`AsOf listening on ${server.url}`);
