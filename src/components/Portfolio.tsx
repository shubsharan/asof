import { useEffect, useState } from "react";
import type { PortfolioEntry } from "@/db/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "./shared";

export function Portfolio() {
  const [portfolio, setPortfolio] = useState<PortfolioEntry[]>([]);
  useEffect(() => {
    api<PortfolioEntry[]>("/api/portfolio").then(setPortfolio);
  }, []);

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Active diligence</h1>
      <div className="grid gap-3">
        {portfolio.map((c) => (
          <a key={c.id} href={`/c/${c.id}`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <CardDescription className="flex gap-2">
                  <Badge variant="secondary">{c.hypothesisCount} hypotheses</Badge>
                  <Badge variant={c.changesThisWeek ? "default" : "outline"}>{c.changesThisWeek} changes this week</Badge>
                </CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>
    </>
  );
}
