// Seeds structure only: target companies and their untested hypotheses.
// Evidence and assessments come from Exa through the app, never from here.
import { createDb, DB_PATH } from "./schema";
import { createHypothesis } from "./queries";

const COMPANIES = [
  { id: "exa", domain: "exa.ai", name: "Exa", description: "Search engine and API built for AI applications." },
  { id: "perplexity", domain: "perplexity.ai", name: "Perplexity", description: "AI answer engine; offers the Sonar API to developers." },
  { id: "brave", domain: "brave.com", name: "Brave", description: "Browser and independent search index; offers the Brave Search API." },
  { id: "parallel", domain: "parallel.ai", name: "Parallel", description: "Parallel Web Systems: web search and research APIs for AI agents." },
  { id: "tavily", domain: "tavily.com", name: "Tavily", description: "Search API built for AI agents and LLM applications." },
];

// Every target starts from the same four hypotheses.
const HYPOTHESES = [
  { key: "adoption", statement: "Developer and enterprise adoption is accelerating" },
  { key: "differentiation", statement: "Product differentiation is defensible" },
  { key: "management", statement: "Management team can scale the company" },
  { key: "moat", statement: "Competitive moat is strengthening" },
];

for (const suffix of ["", "-wal", "-shm"]) await Bun.file(DB_PATH + suffix).delete().catch(() => {});

const db = createDb(DB_PATH);
db.transaction(() => {
  const insertCompany = db.query("INSERT INTO companies (id, name, description, domain) VALUES (?, ?, ?, ?)");
  for (const c of COMPANIES) {
    insertCompany.run(c.id, c.name, c.description, c.domain);
    for (const h of HYPOTHESES) {
      createHypothesis(db, { id: `${c.id}-${h.key}`, companyId: c.id, lens: h.key, statement: h.statement });
    }
  }
})();
db.close();

console.log(`Seeded ${DB_PATH}: ${COMPANIES.map((c) => c.name).join(", ")}, ${HYPOTHESES.length} untested hypotheses each.`);
