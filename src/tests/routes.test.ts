import { expect, test } from "bun:test";
import { parseRoute, supportsHistory } from "../components/routes";

test("history controls appear only on routes with a rewindable thesis", () => {
  for (const path of ["/", "/portfolio", "/hypotheses/moat", "/c/acme", "/c/acme/h/moat"]) {
    expect(supportsHistory(parseRoute(path))).toBe(true);
  }
  for (const path of ["/updates", "/settings", "/missing"]) {
    expect(supportsHistory(parseRoute(path))).toBe(false);
  }
});
