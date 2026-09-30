import index from "./index.html";
import { createDb } from "./db/schema";
import { dismissProposal, groupEvidence, listCompaniesData, listHypotheses, listProposals, reviewEvidence, saveAssessment, setEvidenceRelationship, type NewOfficialAssessment } from "./db/queries";
import { researchHistory, researchView } from "./domain/research";
import { createSchedule, deleteSchedule, listRuns, listSchedules, recoverRuns, updateSchedule } from "./db/runs";
import type { ReviewDecision, RunTarget, SourceRelationship } from "./domain/types";
import { pageThenAndNow } from "./exa/snapshot";
import { createMonitor, deleteMonitor, getMonitor, monitorPayload } from "./exa/monitor";
import { createRunner, type Runner } from "./runner";
import { startScheduler } from "./scheduler";
import { inspectWatch, startWatch, stopWatch, type WatchProvider } from "./watch";

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
const watchProvider: WatchProvider = {
  payload: monitorPayload,
  create: (company, options) => createMonitor(company, {
    idempotencyKey: options.idempotencyKey,
    stablePayload: JSON.parse(options.stablePayloadJson),
  }),
  delete: deleteMonitor,
  get: getMonitor,
};

const server = Bun.serve({
  idleTimeout: 60, // Exa Snapshot fetches two versions of a page
  routes: {
    "/*": index, // React app; the /api routes below take precedence
    "/api/companies": { GET: (req) => {
      const p = params(req);
      const companies = listCompaniesData(db);
      if (p.get("raw") === "1") return Response.json(companies);
      const mode = p.get("history") ?? "recorded";
      if (mode !== "recorded" && mode !== "reconstruction") return badRequest("Unknown research history mode");
      const selected = p.get("assessmentId");
      const assessmentId = selected === null ? undefined : Number(selected);
      if (assessmentId !== undefined && (!Number.isSafeInteger(assessmentId) || assessmentId < 1)) return badRequest("Invalid assessment ID");
      if (assessmentId !== undefined && !companies.some((company) => company.hypotheses.some((h) => researchHistory(h, mode).some((item) => item.id === assessmentId)))) return notFound();
      const asOf = asOfParam(req);
      if (asOf && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf.slice(0, 10))) return badRequest("Invalid research date");
      return Response.json(companies.map((company) => researchView(company, asOf, mode, assessmentId)));
    } },
    "/api/hypotheses": { GET: () => Response.json(listHypotheses(db)) },
    "/api/companies/:id/watch": {
      GET: async (req) => {
        const watch = await inspectWatch(db, req.params.id, watchProvider);
        return watch ? Response.json(watch) : notFound();
      },
      POST: async (req) => {
        try {
          return Response.json(await startWatch(db, runner, req.params.id, watchProvider), { status: 202 });
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 502 });
        }
      },
      DELETE: async (req) => {
        try {
          const watch = await stopWatch(db, req.params.id, watchProvider);
          return Response.json(watch);
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 502 });
        }
      },
    },
    "/api/proposals": {
      GET: (req) => {
        const p = params(req);
        return Response.json(listProposals(db, {
          companyId: p.get("companyId") ?? undefined,
          hypothesisId: p.get("hypothesisId") ?? undefined,
        }));
      },
    },
    "/api/proposals/:id/dismiss": {
      POST: (req) => {
        const proposal = dismissProposal(db, req.params.id);
        return proposal ? Response.json(proposal) : notFound();
      },
    },
    "/api/assessments": {
      POST: async (req) => {
        try {
          return Response.json(saveAssessment(db, (await req.json()) as NewOfficialAssessment), { status: 201 });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return new Response(message, { status: message.includes("stale") ? 409 : 400 });
        }
      },
    },
    "/api/evidence/:id/reviews": {
      POST: async (req) => {
        try {
          return Response.json(reviewEvidence(db, req.params.id, (await req.json()) as { decision: ReviewDecision; note?: string }), { status: 201 });
        } catch (e) {
          return badRequest(e);
        }
      },
    },
    "/api/evidence/:id/relationship": {
      POST: async (req) => {
        try {
          const body = (await req.json()) as { relationship: SourceRelationship };
          return Response.json(setEvidenceRelationship(db, req.params.id, body?.relationship));
        } catch (e) {
          return badRequest(e);
        }
      },
    },
    "/api/evidence/groups": {
      POST: async (req) => {
        try {
          return Response.json(groupEvidence(db, (await req.json()) as { evidenceIds: string[]; groupId?: string | null }));
        } catch (e) {
          return badRequest(e);
        }
      },
    },

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
        try {
          const body: unknown = await req.json();
          if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string") throw new Error("Snapshot URL is required");
          const asOf = "asOf" in body ? body.asOf : undefined;
          if (asOf !== undefined && typeof asOf !== "string") throw new Error("Snapshot cutoff must be a string");
          return Response.json(await pageThenAndNow(body.url, asOf));
        } catch (e) {
          return badRequest(e);
        }
      },
    },
  },
  development: { hmr: true, console: true },
});

console.log(`AsOf listening on ${server.url}`);
