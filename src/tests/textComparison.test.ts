import { expect, test } from "bun:test";
import { compareText } from "../domain/textComparison";

test("text comparison groups sentence changes with nearby context", () => {
  expect(compareText("Before. Old price. After.", "Before. New price. After.")).toEqual({
    kind: "changes",
    passages: [[
      { kind: "same", text: "Before." },
      { kind: "removed", text: "Old price." },
      { kind: "added", text: "New price." },
      { kind: "same", text: "After." },
    ]],
  });
});

test("text comparison handles inserts, removals, repeats, and whitespace-only changes", () => {
  expect(compareText("One. Three.", "One. Two. Three.")).toMatchObject({ kind: "changes" });
  expect(compareText("One. Two. Three.", "One. Three.")).toMatchObject({ kind: "changes" });
  expect(compareText("Repeat. Repeat. End.", "Repeat. Changed. Repeat. End.")).toMatchObject({ kind: "changes" });
  expect(compareText("One.   Two.\n", "One. Two.")).toEqual({ kind: "unchanged" });
});

test("large comparisons return the complete differing section", () => {
  const before = Array.from({ length: 501 }, (_, i) => `Old ${i}.`).join(" ");
  const after = Array.from({ length: 501 }, (_, i) => `New ${i}.`).join(" ");
  const result = compareText(before, after);
  expect(result).toMatchObject({ kind: "broad", before, after });
});

