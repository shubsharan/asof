import { HypothesisDetail } from "./HypothesisDetail";
import { Portfolio } from "./Portfolio";
import { TargetOverview } from "./TargetOverview";

// Bun.serve returns this page for every path, and links are plain page loads, so the URL is read once.
// Pages: /  ·  /c/:companyId  ·  /c/:companyId/h/:hypothesisId, each optionally ?asOf=YYYY-MM-DD
export function App() {
  const [section, companyId, sub, hypothesisId] = location.pathname.split("/").filter(Boolean);
  const asOf = new URLSearchParams(location.search).get("asOf") ?? undefined;

  let page = <p>Not found.</p>;
  if (!section) page = <Portfolio />;
  else if (section === "c" && companyId && !sub) page = <TargetOverview id={companyId} asOf={asOf} />;
  else if (section === "c" && companyId && sub === "h" && hypothesisId)
    page = <HypothesisDetail companyId={companyId} hypothesisId={hypothesisId} asOf={asOf} />;

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-3">
          <a href="/" className="font-semibold">
            AsOf
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{page}</main>
    </div>
  );
}
