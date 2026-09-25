import index from "./index.html";
import { createDb } from "./db/schema";
import { listCompanies } from "./db/queries";
import { createSchedule, deleteSchedule, listRuns, listSchedules, recoverRuns, updateSchedule } from "./db/runs";
import type { RunTarget } from "./domain/types";
import { pageThenAndNow } from "./exa/snapshot";
import { createRunner, type Runner } from "./runner";
import { startScheduler } from "./scheduler";

// `bun --hot` re-evaluates this module on every save but keeps `globalThis`. Keep one database and
// one runner for the process (so in-flight runs aren't mistaken for interrupted ones), and replace
// the scheduler's timer rather than stacking another. Runner code changes need a full restart.
declare global {
  var asof: { db: ReturnType<typeof createDb>; runner: Runner; stopScheduler?: () => void } | undefined;
}
if (!globalThis.asof) {
  const db = createDb();
  const runner = createRunner(db);
  runner.resume(recoverRuns(db));
  globalThis.asof = { db, runner };
}
const { db, runner } = globalThis.asof;
globalThis.asof.stopScheduler?.();
globalThis.asof.stopScheduler = startScheduler(db, runner);

const notFound = () => new Response("Not found", { status: 404 });
const badRequest = (e: unknown) => new Response(e instanceof Error ? e.message : String(e), { status: 400 });
const params = (req: Request) => new URL(req.url).searchParams;
const asOfParam = (req: Request) => params(req).get("asOf") ?? undefined;

const server = Bun.serve({
  idleTimeout: 60, // Exa Snapshot fetches two versions of a page
  routes: {
    "/*": index, // React app; the /api routes below take precedence
    // The whole portfolio with full history and evidence; the client rewinds it with thesisAsOf.
    "/api/companies": { GET: (req) => Response.json(listCompanies(db, asOfParam(req))) },

    // Research runs. Starting one returns immediately; the runner works through the queue.
    "/api/runs": {
      GET: (req) => {
        const p = params(req);
        return Response.json(
          listRuns(db, {
            companyId: p.get("companyId") ?? undefined,
            hypothesisId: p.get("hypothesisId") ?? undefined,
            active: p.get("active") === "1",
            failed: p.get("failed") === "1",
          }),
        );
      },
      POST: async (req) => {
        const target = (await req.json()) as RunTarget;
        try {
          return Response.json(runner.enqueue({ ...target, trigger: "manual" }), { status: 202 });
        } catch (e) {
          return badRequest(e);
        }
      },
    },
    "/api/schedules": {
      GET: (req) => Response.json(listSchedules(db, { companyId: params(req).get("companyId") ?? undefined })),
      POST: async (req) => {
        try {
          return Response.json(createSchedule(db, (await req.json()) as RunTarget & { everyHours: number }), { status: 201 });
        } catch (e) {
          return badRequest(e);
        }
      },
    },
    "/api/schedules/:id": {
      PATCH: async (req) => {
        try {
          const schedule = updateSchedule(db, req.params.id, (await req.json()) as { enabled?: boolean; everyHours?: number });
          return schedule ? Response.json(schedule) : notFound();
        } catch (e) {
          return badRequest(e);
        }
      },
      DELETE: (req) => (deleteSchedule(db, req.params.id) ? new Response(null, { status: 204 }) : notFound()),
    },

    "/api/snapshot": {
      POST: async (req) => {
        const { url, asOf } = (await req.json()) as { url: string; asOf: string };
        return Response.json(await pageThenAndNow(url, asOf));
      },
    },
  },
  development: { hmr: true, console: true },
});

console.log(`AsOf listening on ${server.url}`);
