import { expect, test } from "bun:test";
import { ExaError } from "exa-js";
import type { AgentMonitor, SearchResponse } from "exa-js";
import { evaluateHypothesis, parseEvaluation, parseGrounding, verifyEvaluationCitations } from "../exa/agent";
import { captureSources } from "../exa/contents";
import { createMonitor, deleteMonitor, getMonitor, monitorChangesEvidence, monitorCitationEvidence, monitorPayload } from "../exa/monitor";
import { searchResponseEvidence } from "../exa/search";
import { pageThenAndNow } from "../exa/snapshot";
import type { Hypothesis } from "../domain/types";

test("contents batches normalized duplicate URLs and reports unavailable sources", async () => {
  const calls: string[][] = [];
  const captures = await captureSources([
    "https://EXAMPLE.com/page?b=2&a=1#section",
    "https://example.com/page?a=1&b=2",
    "https://missing.example/",
  ], {
    now: () => "2026-09-28T12:00:00Z",
    getContents: async (urls) => {
      calls.push(urls);
      return {
        requestId: "contents-1",
        results: [{ id: "one", title: "Page", url: "https://example.com/page?a=1&b=2", text: "Retrieved page text" }],
        statuses: [{ id: "https://missing.example/", status: "error", source: "livecrawl" }],
      };
    },
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toHaveLength(2);
  expect(captures.get("https://EXAMPLE.com/page?b=2&a=1#section")).toMatchObject({ status: "retrieved", text: "Retrieved page text" });
  expect(captures.get("https://missing.example/")).toEqual({ status: "unavailable", url: "https://missing.example/", retrievedAt: "2026-09-28T12:00:00Z", error: "error" });
  expect(await captureSources(["javascript:alert(1)"], { now: () => "2026-09-28T12:00:00Z" })).toEqual(new Map([
    ["javascript:alert(1)", { status: "unavailable", url: "javascript:alert(1)", retrievedAt: "2026-09-28T12:00:00Z", error: "Invalid HTTP(S) URL" }],
  ]));
});

test("search preserves native highlights and grounding", () => {
  const response: SearchResponse<{ highlights: true }> = {
    requestId: "search-1",
    results: [{ id: "one", title: "Launch", url: "https://acme.example/news", publishedDate: "2026-09-27", highlights: ["Acme launched the product."] }],
    output: {
      content: { evidence: [{ url: "https://acme.example/news", claim: "Acme launched the product.", excerpt: "Acme launched the product.", relevanceReason: "A product launch can signal adoption", sourceReasoning: "Company announcement", type: "supports" }] },
      grounding: [{ field: "evidence[0]", confidence: "high", citations: [{ url: "https://acme.example/news", title: "Launch" }] }],
    },
  };

  expect(searchResponseEvidence(response, "acme.example")).toEqual([{
    title: "Launch",
    claim: "Acme launched the product.",
    relevanceReason: "A product launch can signal adoption",
    url: "https://acme.example/news",
    publishedAt: "2026-09-27",
    type: "supports",
    sourceReasoning: "Company announcement",
    excerpt: "Acme launched the product.",
    grounding: response.output?.grounding,
    sourceRelationship: "company",
  }]);
});

test("malformed and unsupported structured output fails visibly", () => {
  expect(() => parseEvaluation({ verdict: "supports", confidence: 80, reasoning: "", openQuestions: [], citedEvidenceIds: [], newClaims: [] })).toThrow(/malformed/);
  const evaluation = parseEvaluation({ verdict: "supports", confidence: 80, reasoning: "Grounded", changeReason: "Initial", openQuestions: [], consideredEvidenceIds: ["invented"], citedEvidenceIds: ["invented"], decisiveEvidenceIds: [], newClaims: [] });
  const hypothesis: Hypothesis = {
    id: "moat", name: "Moat", statement: "Moat grows", verdict: "untested", history: [], evidence: [], reportCount: 0, developmentCount: 0,
  };
  const nativeGrounding = [{ field: "citedUrls[0]", citations: [{ url: "https://invented.example" }] }];
  expect(() => verifyEvaluationCitations(evaluation, hypothesis, nativeGrounding)).toThrow(/outside its passage-backed input/);
  expect(() => parseGrounding([{ field: "evidence", citations: [{ url: "javascript:alert(1)" }] }])).toThrow(/malformed native grounding/);
});

test("Agent live-check bounds reject invalid budgets and timeouts before a provider call", async () => {
  const company = { id: "acme", name: "Acme", description: "", domain: "acme.example", hypotheses: [] };
  const hypothesis: Hypothesis = { id: "moat", name: "Moat", statement: "Moat grows", verdict: "untested", history: [], evidence: [], reportCount: 0, developmentCount: 0 };
  await expect(evaluateHypothesis(company, hypothesis, undefined, { maxCostDollars: Number.NaN })).rejects.toThrow(/finite/);
  await expect(evaluateHypothesis(company, hypothesis, undefined, { timeoutMs: 0 })).rejects.toThrow(/positive/);
});

test("monitor citation notes remain interpretation, never quoted source text", () => {
  const company = { id: "acme", name: "Acme", description: "", domain: "acme.example", hypotheses: [] };
  expect(monitorCitationEvidence(company, "Reported monitor value", {
    url: "https://news.example/story",
    title: "Story",
    note: "This appears relevant to adoption",
  })).toEqual({
    title: "Story",
    claim: "Reported monitor value",
    url: "https://news.example/story",
    sourceReasoning: "Monitor interpretation: This appears relevant to adoption",
    grounding: { url: "https://news.example/story", title: "Story", note: "This appears relevant to adoption" },
    sourceRelationship: "unknown",
  });
});

const remoteMonitor: AgentMonitor = {
  id: "monitor-1", object: "agent_monitor", status: "active", cadence: "1d", fields: [], entityCount: 1,
  version: 1, createdAt: "2026-09-28T10:00:00Z", lastRefreshAt: "2026-09-28T12:00:00Z",
  refresh: { state: "idle" }, creation: { state: "idle" }, usage: { totalAcus: 2, lastRefreshAcus: 1 },
};

test("monitor lifecycle reuses the persisted body and key, exposes remote state, and treats delete 404 as complete", async () => {
  const company = { id: "acme", name: "Acme", description: "Widgets", domain: "acme.example", hypotheses: [{ id: "moat", name: "Moat", statement: "Moat grows", verdict: "untested" as const, history: [], evidence: [], reportCount: 0, developmentCount: 0 }] };
  const stablePayload = monitorPayload(company);
  const creates: unknown[][] = [];
  const client = {
    create: async (...args: unknown[]) => { creates.push(args); return remoteMonitor; },
    get: async () => remoteMonitor,
    delete: async () => { throw new ExaError("missing", 404); },
  };

  await createMonitor(company, { idempotencyKey: "watch-acme", stablePayload }, client);
  await createMonitor({ ...company, name: "Renamed" }, { idempotencyKey: "watch-acme", stablePayload }, client);
  expect(creates[0]).toEqual(creates[1]);
  expect(creates[0]?.[1]).toEqual({ idempotencyKey: "watch-acme" });
  expect(await getMonitor("monitor-1", client)).toEqual(remoteMonitor);
  await expect(deleteMonitor("monitor-1", client)).resolves.toBeUndefined();
});

test("monitor changes require a field name and retain native event timestamps in grounding", () => {
  const company = { id: "acme", name: "Acme", description: "", domain: "acme.example", hypotheses: [] };
  const change = {
    type: "content.upserted" as const,
    entity: { id: "entity-1", name: "Acme" },
    field: { id: "field-1", name: "moat" },
    content: { value: "New customer", citations: [{ url: "https://news.example/story" }], updatedAt: "2026-09-28T12:05:00Z" },
    version: 2,
    createdAt: "2026-09-28T12:06:00Z",
  };
  expect(monitorChangesEvidence(company, [change])[0]?.evidence[0]?.grounding).toMatchObject({
    event: { createdAt: "2026-09-28T12:06:00Z", contentUpdatedAt: "2026-09-28T12:05:00Z", version: 2 },
  });
  expect(() => monitorChangesEvidence(company, [{ ...change, field: { id: "field-1" } }])).toThrow(/no field name/);
});

test("snapshot current retrieval survives an unavailable historical capture", async () => {
  const response = await pageThenAndNow("https://example.com", "2026-09-28", async (_urls, options) => {
    if (options.snapshotAsOf) throw new Error("No historical capture");
    return { requestId: "current", results: [{ id: "now", title: "Now", url: "https://example.com", text: "Current page", snapshotAt: "2026-09-28T12:30:00Z" }] };
  }, () => "2026-09-28T13:00:00Z");

  expect(response.then).toMatchObject({ status: "unavailable", error: "No historical capture" });
  expect(response.now).toMatchObject({ status: "retrieved", text: "Current page", snapshotAt: "2026-09-28T12:30:00Z" });
});

test("snapshot retrieves only fresh current content when no cutoff is supplied", async () => {
  const options: unknown[] = [];
  const response = await pageThenAndNow("https://example.com", undefined, async (_urls, requested) => {
    options.push(requested);
    return { requestId: "current", results: [{ id: "now", title: "Now", url: "https://example.com", text: "Current page" }] };
  });
  expect(options).toEqual([{ text: true, filterEmptyResults: false, maxAgeHours: 0 }]);
  expect(response).toMatchObject({ now: { status: "retrieved", text: "Current page" } });
  expect("then" in response).toBe(false);
});

test("snapshot preserves exact timestamps and expands date-only cutoffs to the end of the UTC day", async () => {
  const cutoffs: (string | undefined)[] = [];
  const getContents = async (_urls: string[], options: { snapshotAsOf?: string }) => {
    cutoffs.push(options.snapshotAsOf);
    return { requestId: crypto.randomUUID(), results: [{ id: "page", title: "Page", url: "https://example.com", text: "Page" }] };
  };
  await pageThenAndNow("https://example.com", "2026-09-28T12:34:56Z", getContents);
  await pageThenAndNow("https://example.com", "2026-09-28", getContents);
  expect(cutoffs).toEqual([
    "2026-09-28T12:34:56Z", undefined,
    "2026-09-28T23:59:59Z", undefined,
  ]);
});

test("snapshot rejects invalid input before calling the provider", async () => {
  let calls = 0;
  const getContents = async () => {
    calls++;
    return { requestId: "unexpected", results: [] };
  };
  await expect(pageThenAndNow("javascript:alert(1)", undefined, getContents)).rejects.toThrow(/HTTP/);
  await expect(pageThenAndNow("https://example.com", "not-a-date", getContents)).rejects.toThrow(/cutoff/);
  expect(calls).toBe(0);
});

test("source classifications come from structured research and reject invalid values", () => {
  const claim = {ref:"local-1",url:"https://publisher.example/report",title:"Report",claim:"Retention increased",excerpt:"Retention increased",relevanceReason:"Retention indicates moat strength",type:"supports",sourceReasoning:"Independent reporting",sourceRelationship:"independent"};
  const assessment = { verdict:"supports", confidence:80, reasoning:"Retention increased", changeReason:"Initial", openQuestions:[], consideredEvidenceIds:["local-1"], citedEvidenceIds:["local-1"], decisiveEvidenceIds:["local-1"], newClaims:[claim] };
  expect(parseEvaluation(assessment).newClaims[0]!.sourceRelationship).toBe("independent");
  expect(() => parseEvaluation({...assessment,newClaims:[{...claim,sourceRelationship:"invented"}]})).toThrow(/malformed claim/);
  const response: SearchResponse<{ highlights:true }> = {
    requestId:"fixture",results:[{id:"one",title:"Report",url:"https://publisher.example/report",highlights:[]}],
    output:{content:{evidence:[claim]},grounding:[]},
  };
  expect(searchResponseEvidence(response,"acme.example")[0]!.sourceRelationship).toBe("independent");
});
