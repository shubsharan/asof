import { AGENT_MONITORS_BETA_HEADER } from "exa-js";
import type { NewEvidence } from "../db/queries";
import type { Company } from "../domain/types";
import { exa } from "./client";

const betas = [AGENT_MONITORS_BETA_HEADER];

/**
 * Creates an Exa Agent Monitor for a company: one field per hypothesis, kept fresh from news
 * every day. Returns the monitor id.
 */
export async function createMonitor(company: Company): Promise<string> {
  const monitor = await exa.beta.agent.monitors.create({
    betas,
    cadence: "1d",
    entities: [{ name: company.name, domain: company.domain, description: company.description }],
    fields: company.hypotheses.map((h) => ({
      name: h.id,
      description: `New developments bearing on the investment hypothesis "${h.statement}", for or against it: the specific fact reported (numbers, names, dates), from credible sources.`,
    })),
  });
  return monitor.id;
}

/**
 * Evidence from a monitor's change feed, per hypothesis. Changes carry no direction,
 * so evidence arrives unclassified until triaged or weighed in an assessment.
 */
export async function monitorEvidence(monitorId: string): Promise<{ hypothesisId: string; at: string; evidence: NewEvidence[] }[]> {
  const changes = await exa.beta.agent.monitors.changes.getAll(monitorId, { betas });
  return changes.map((c) => ({
    hypothesisId: c.field.name!,
    at: c.createdAt,
    evidence: (c.content.citations ?? []).map((cite) => ({
      title: cite.title ?? cite.url,
      claim: cite.note || String(c.content.value),
      url: cite.url,
    })),
  }));
}
