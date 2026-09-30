export type TextChange = { kind: "same" | "removed" | "added"; text: string };

export type TextComparison =
  | { kind: "unchanged" }
  | { kind: "changes"; passages: TextChange[][] }
  | { kind: "broad"; before: string; after: string };

const MAX_ALIGNMENT_CELLS = 250_000;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

function sentences(text: string): string[] {
  return Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text), ({ segment }) => segment.trim()).filter(Boolean);
}

function broadComparison(before: string[], after: string[]): TextComparison {
  let start = 0;
  while (start < before.length && start < after.length && normalize(before[start]!) === normalize(after[start]!)) start++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && normalize(before[beforeEnd - 1]!) === normalize(after[afterEnd - 1]!)) {
    beforeEnd--;
    afterEnd--;
  }
  return { kind: "broad", before: before.slice(start, beforeEnd).join(" "), after: after.slice(start, afterEnd).join(" ") };
}

/** Sentence-level comparison with one unchanged sentence around each changed passage. */
export function compareText(beforeText: string, afterText: string): TextComparison {
  if (normalize(beforeText) === normalize(afterText)) return { kind: "unchanged" };
  const before = sentences(beforeText);
  const after = sentences(afterText);
  if (before.length * after.length > MAX_ALIGNMENT_CELLS) return broadComparison(before, after);

  const lengths = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lengths[i]![j] = normalize(before[i]!) === normalize(after[j]!)
        ? lengths[i + 1]![j + 1]! + 1
        : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const changes: TextChange[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && normalize(before[i]!) === normalize(after[j]!)) {
      changes.push({ kind: "same", text: before[i]! });
      i++;
      j++;
    } else if (j < after.length && (i === before.length || lengths[i]![j + 1]! > lengths[i + 1]![j]!)) {
      changes.push({ kind: "added", text: after[j++]! });
    } else {
      changes.push({ kind: "removed", text: before[i++]! });
    }
  }

  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < changes.length; index++) {
    if (changes[index]!.kind === "same") continue;
    const start = Math.max(0, index - 1);
    const end = Math.min(changes.length, index + 2);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  return { kind: "changes", passages: ranges.map(({ start, end }) => changes.slice(start, end)) };
}

