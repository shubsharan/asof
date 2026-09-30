import type { PortfolioHypothesis, ResearchRubric } from "./types";

const period = "Assess the preceding 12 months, using comparable earlier periods where available. Missing measurements are an evidence gap.";

const rubrics: Record<string, ResearchRubric> = {
  adoption: {
    period,
    supportingSignals: ["Comparable measurements show increasing growth in developer usage, active customers, or paid enterprise adoption.", "Customer-reported usage corroborates adoption. A launch or distribution announcement alone does not establish acceleration."],
    challengingSignals: ["Growth slows, usage declines, or customers leave.", "Announcements lack demonstrated adoption or comparable measurements over time."],
  },
  differentiation: {
    period,
    supportingSignals: ["Reproducible product advantages matter to customers.", "Evidence shows those advantages are difficult to replicate or substitute."],
    challengingSignals: ["Competitors match capabilities or performance.", "Customers can substitute alternatives or switch easily."],
  },
  management: {
    period,
    supportingSignals: ["The team delivers commitments and builds operating capacity as the company grows.", "Demonstrated execution supports the ability to handle greater scale."],
    challengingSignals: ["Repeated execution failures or leadership gaps impair delivery.", "Operational strain grows faster than the team's ability to address it. Hiring plans alone do not demonstrate execution."],
  },
  moat: {
    period,
    supportingSignals: ["Retention, switching costs, exclusive assets, or durable distribution advantages strengthen over time."],
    challengingSignals: ["Commoditization, weaker exclusivity, falling retention, or stronger substitutes erode those advantages."],
  },
};

export function rubricForHypothesis(id: string): ResearchRubric | undefined {
  const rubric = rubrics[id];
  return rubric ? structuredClone(rubric) : undefined;
}

export function rubricText(hypothesis: PortfolioHypothesis): string {
  const rubric = hypothesis.rubric ?? rubricForHypothesis(hypothesis.id);
  return rubric ? `Comparison period: ${rubric.period}\nSupporting signals:\n${rubric.supportingSignals.map((signal) => `- ${signal}`).join("\n")}\nChallenging signals:\n${rubric.challengingSignals.map((signal) => `- ${signal}`).join("\n")}` : "No saved rubric. Explain the observable criteria used and any missing comparison periods.";
}
