import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceRow } from "../components/shared";
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
