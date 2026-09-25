import { test, expect } from "bun:test";
import { sortRows } from "../components/Portfolio";
import type { Company, Hypothesis } from "../domain/types";

const row = (name: string, verdict: Hypothesis["verdict"], confidence?: number) => ({
  company: { id: name, name, description: "", domain: "", hypotheses: [] } as Company,
  h: { id: "moat", name: "Moat", statement: "", verdict, confidence, evidence: [], history: [] } as Hypothesis,
});

const rows = [row("Tavily", "neutral", 83), row("Brave", "supports", 68), row("Acme", "untested"), row("Exa", "contradicts", 84), row("Parallel", "neutral", 61)];
const names = (sort?: Parameters<typeof sortRows>[1]) => sortRows(rows, sort).map((r) => r.company.name);

test("no sort keeps portfolio order", () => {
  expect(names()).toEqual(["Tavily", "Brave", "Acme", "Exa", "Parallel"]);
});

test("each column sorts in its natural order, untested last", () => {
  expect(names({ key: "company", reversed: false })).toEqual(["Brave", "Exa", "Parallel", "Tavily", "Acme"]);
  expect(names({ key: "verdict", reversed: false })).toEqual(["Brave", "Parallel", "Tavily", "Exa", "Acme"]);
  expect(names({ key: "confidence", reversed: false })).toEqual(["Exa", "Tavily", "Brave", "Parallel", "Acme"]);
});

test("a second click reverses the order, still with untested last", () => {
  expect(names({ key: "verdict", reversed: true })).toEqual(["Exa", "Parallel", "Tavily", "Brave", "Acme"]);
  expect(names({ key: "confidence", reversed: true })).toEqual(["Parallel", "Brave", "Tavily", "Exa", "Acme"]);
});
