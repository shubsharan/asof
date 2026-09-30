import { AGENT_MONITORS_BETA_HEADER, ExaError } from "exa-js";
import type { AgentMonitor, AgentMonitorChange, CreateAgentMonitorParams } from "exa-js";
import type { NewEvidence } from "../db/queries";
import type { Company } from "../domain/types";
import { exa } from "./client";
import { rubricText } from "../domain/rubric";

const betas = [AGENT_MONITORS_BETA_HEADER];

const host = (url: string) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};

type MonitorGrounding = Pick<AgentMonitorChange, "createdAt" | "version" | "entity" | "field"> & { contentUpdatedAt: string };

export function monitorCitationEvidence(company: Company, value: unknown, citation: { url: string; title?: string | null; note?: string | null }, event?: MonitorGrounding) {
  const sourceHost = host(citation.url);
  const companyHost = host(`https://${company.domain}`);
  return {
    title: citation.title ?? citation.url,
    claim: String(value),
    url: citation.url,
    sourceReasoning: citation.note ? `Monitor interpretation: ${citation.note}` : undefined,
    grounding: event ? { citation, event } : citation,
    sourceRelationship: sourceHost === companyHost || sourceHost.endsWith(`.${companyHost}`) ? "company" as const : "unknown" as const,
  };
}

/**
 * Creates an Exa Agent Monitor for a company: one field per hypothesis, kept fresh from news
 * every day. The caller persists the key and payload before calling so an ambiguous retry is identical.
 */
export function monitorPayload(company: Company): CreateAgentMonitorParams {
  return {
    cadence: "1d",
    entities: [{ name: company.name, domain: company.domain, description: company.description }],
    fields: company.hypotheses.map((h) => ({
      name: h.id,
      description: `New leads bearing on the investment hypothesis "${h.statement}". ${rubricText(h)} Include supporting and challenging developments from credible sources. Report specific facts (numbers, names, dates); these are leads until their source passages are checked.`,
    })),
  };
}

type MonitorClient = {
  create: (params: CreateAgentMonitorParams & { betas: string[] }, options: { idempotencyKey: string }) => Promise<AgentMonitor>;
  get: (monitorId: string, options: { betas: string[] }) => Promise<AgentMonitor>;
  delete: (monitorId: string, options: { betas: string[] }) => Promise<unknown>;
};

export async function createMonitor(
  company: Company,
  options: { idempotencyKey: string; stablePayload?: CreateAgentMonitorParams },
  client: MonitorClient = exa.beta.agent.monitors,
): Promise<AgentMonitor> {
  if (!options.idempotencyKey.trim()) throw new Error("Monitor idempotency key is required");
  return client.create({ ...(options.stablePayload ?? monitorPayload(company)), betas }, { idempotencyKey: options.idempotencyKey });
}

export function getMonitor(monitorId: string, client: MonitorClient = exa.beta.agent.monitors): Promise<AgentMonitor> {
  return client.get(monitorId, { betas });
}

export async function deleteMonitor(monitorId: string, client: MonitorClient = exa.beta.agent.monitors): Promise<void> {
  try {
    await client.delete(monitorId, { betas });
  } catch (cause) {
    if (cause instanceof ExaError && cause.statusCode === 404) return;
    throw cause;
  }
}

/**
 * Evidence from a company's monitor change feed, per hypothesis. Changes carry no direction,
 * so evidence arrives unclassified until weighed in an assessment.
 * Monitors created before hypotheses were portfolio-wide name fields `${companyId}-${hypothesisId}`.
 */
export async function monitorEvidence(company: Company): Promise<{ hypothesisId: string; at: string; evidence: NewEvidence[] }[]> {
  const changes = await exa.beta.agent.monitors.changes.getAll(company.monitorId!, { betas });
  return monitorChangesEvidence(company, changes);
}

export function monitorChangesEvidence(company: Company, changes: AgentMonitorChange[]): { hypothesisId: string; at: string; evidence: NewEvidence[] }[] {
  const legacy = `${company.id}-`;
  return changes.map((change) => {
    const fieldName = change.field.name;
    if (!fieldName) throw new Error(`Monitor change ${change.field.id} has no field name`);
    return {
      hypothesisId: fieldName.startsWith(legacy) ? fieldName.slice(legacy.length) : fieldName,
      at: change.createdAt,
      evidence: (change.content.citations ?? []).map((citation) => monitorCitationEvidence(company, change.content.value, citation, {
        createdAt: change.createdAt,
        contentUpdatedAt: change.content.updatedAt,
        version: change.version,
        entity: change.entity,
        field: change.field,
      })),
    };
  });
}
