import { test, expect } from "bun:test";
import { researchView } from "../domain/research";
import { createDb } from "../db/schema";
import { createHypothesis, recordClaimBatch, recordResearchAssessment, getCompany, listProposals } from "../db/queries";
import { runAssess } from "../research";

test("research is visible without approvals, preserves history, and uses unreviewed sources", async () => {
  const db = createDb(":memory:");
  try {
    db.run("INSERT INTO companies (id,name,description,domain) VALUES ('acme','Acme','','acme.example')");
    createHypothesis(db, {id:"moat",name:"Moat",statement:"A durable moat"});
    const [source] = recordClaimBatch(db,"acme","moat",[{title:"Report",claim:"Retention grew",excerpt:"Retention grew",relevanceReason:"Retention bears on moat",type:"supports",url:"https://acme.example/report",publishedAt:"2026-01-01"}],"search",undefined,new Map([["https://acme.example/report",{status:"retrieved",url:"https://acme.example/report",text:"Retention grew",retrievedAt:"2026-01-02"}]])).claims;
    if (!source) throw new Error("Missing fixture");
    recordResearchAssessment(db,"acme","moat",{verdict:"neutral",confidence:60,reasoning:"Early evidence is mixed",evidenceIds:[source.id],openQuestions:[],origin:"reconstruction",targetDate:"2026-01-12",recordedAt:"2026-09-28T12:00:00Z"});
    const company = getCompany(db,"acme")!;
    const hypothesis = company.hypotheses[0]!;
    expect(hypothesis.history).toEqual([]);
    expect(researchView(company,"2026-01-12","reconstruction").hypotheses[0]!.verdict).toBe("neutral");
    const result = await runAssess(db,company,hypothesis,undefined,async (_company,input) => {
      expect(input.evidence.map(({id})=>id)).toEqual([source.id]);
      expect(input.evidence[0]!.review).toBeUndefined();
      expect(input.history).toHaveLength(0);
      return {evaluation:{verdict:"supports",confidence:80,reasoning:"Retention supports the moat",changeReason:"Initial recorded assessment",consideredEvidenceIds:[source.id],citedEvidenceIds:[source.id],decisiveEvidenceIds:[source.id],newClaims:[],openQuestions:[]},providerRunId:"fixture",rawOutput:{}};
    });
    expect(result.origin).toBe("agent");
    const saved = getCompany(db,"acme")!;
    expect(saved.hypotheses[0]!.history).toEqual([]);
    expect(listProposals(db)).toEqual([]);
    expect(researchView(saved).hypotheses[0]!.verdict).toBe("supports");
    expect(researchView(saved,"2026-01-12","reconstruction").hypotheses[0]!.verdict).toBe("neutral");
    expect(researchView(saved,"2026-01-11").hypotheses[0]!.verdict).toBe("untested");
    expect(researchView(saved,"2026-01-12","reconstruction").hypotheses[0]!.evidence).toHaveLength(1);
  } finally { db.close(); }
});
