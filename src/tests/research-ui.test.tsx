import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceRow, formatResearchTime, researchLink, VerdictBadge } from "../components/shared";
import { SourceInspector } from "../components/SnapshotDialog";
import { researchSummary } from "../domain/research";
import type { Evidence } from "../domain/types";

const evidence: Evidence = {id:"one",companyId:"acme",hypothesisId:"moat",title:"Report",claim:"Retention grew",url:"https://example.com/report",discoveredAt:"2026-09-28",source:"search",relationship:"independent",relationshipAutomated:true,sourceReasoning:"Independent reporting"};

test("sources show useful content without missing-field prompts or classification controls", () => {
  const html=renderToStaticMarkup(<EvidenceRow evidence={evidence} action={<SourceInspector evidence={evidence} />} />);
  expect(html).toContain("Retention grew");
  expect(html).toContain("Report");
  expect(html).not.toContain("<select");
  expect(html).not.toContain("Excerpt unavailable");
  expect(html).not.toContain("<blockquote");
  expect(html).not.toContain("About this source");
});

test("source inspector shows saved content and comparison actions without a provider request", () => {
  const html=renderToStaticMarkup(<SourceInspector evidence={{...evidence, excerpt:"Retention reached 90%.", sourceVersion:{id:"version",url:evidence.url,status:"retrieved",retrievedAt:"2026-09-28T10:00:00Z",text:"Full source text",excerpt:"Retention reached 90%."}}} />);
  expect(html).toContain("Report");
  expect(html).toContain("Open source details");
  expect(html).not.toContain("Full source text");
});

test("research previews keep a short extract of the original analysis", () => {
  expect(researchSummary("Retention grew. Revenue followed. The full analysis continues.")).toBe("Retention grew. Revenue followed.");
});

test("source rows distinguish leads, matched passages, and legacy evidence", () => {
  expect(renderToStaticMarkup(<EvidenceRow evidence={{ ...evidence, kind: "lead" }} />)).toContain("Collected lead");
  expect(renderToStaticMarkup(<EvidenceRow evidence={{ ...evidence, kind: "claim", excerpt: "Retention reached 90%." }} />)).toContain("Passage matched");
  expect(renderToStaticMarkup(<EvidenceRow evidence={evidence} />)).toContain("Legacy evidence");
  expect(renderToStaticMarkup(<VerdictBadge verdict="neutral" />)).toContain("Inconclusive");
});

test("research links retain exact assessment identity across a shared cutoff", () => {
  const path = "/c/acme/h/moat";
  const first = researchLink(path, { mode: "reconstruction", asOf: "2026-09-28", assessmentId: 10 });
  const second = researchLink(path, { mode: "reconstruction", asOf: "2026-09-28", assessmentId: 11 });
  expect(first).toBe("/c/acme/h/moat?asOf=2026-09-28&history=reconstruction&assessmentId=10");
  expect(second).toContain("assessmentId=11");
  expect(first).not.toBe(second);
});

test("date-only generation records do not invent a local clock", () => {
  expect(formatResearchTime("2026-09-25")).toBe("Sep 25, 2026");
});
