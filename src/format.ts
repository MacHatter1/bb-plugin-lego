// Plain-text views of a book for agent tools and the CLI.
import { bricksPlaced, pieceCount, type BookState } from "./book";

export function bookSummaryLine(book: BookState): string {
  return `${book.id}  Set ${book.setNumber} "${book.title}"  ${book.status}  ${bricksPlaced(book)}/${pieceCount(book)} pieces`;
}

export function formatBook(book: BookState): string {
  const lines = [
    `Set ${book.setNumber} "${book.title}" (${book.id}) — ${book.status}, ${bricksPlaced(book)}/${pieceCount(book)} pieces placed`,
  ];
  if (book.error !== null) lines.push(`Error: ${book.error}`);
  lines.push("", "Bags:");
  for (const bag of book.bags) {
    const done = bag.steps.filter((step) => step.done).length;
    const builder = bag.builder === null ? "" : ` · Builder ${bag.builder}`;
    const deps = bag.dependsOn.length > 0 ? ` · after ${bag.dependsOn.join(", ")}` : "";
    lines.push(
      `  ${bag.number}. ${bag.name} [${bag.id}] — ${bag.status} ${done}/${bag.steps.length}${builder}${deps}`,
    );
    if (bag.error !== null) lines.push(`     error: ${bag.error}`);
  }
  if (book.builders.length > 0) {
    lines.push("", "Builders:");
    for (const builder of book.builders) {
      const bag = builder.bagId === null ? "" : ` on ${builder.bagId}`;
      const thread = builder.threadId === null ? "" : ` (thread ${builder.threadId})`;
      lines.push(
        `  ${builder.name}: ${builder.choice.providerId}/${builder.choice.model} — ${builder.status}${bag}${thread}`,
      );
    }
  }
  const master = book.master;
  const assembled = master.steps.filter((step) => step.done).length;
  lines.push(
    "",
    `Master Builder: ${master.choice === null ? "not chosen yet" : `${master.choice.providerId}/${master.choice.model}`} — ${master.status}, ${assembled}/${master.steps.length} assembly steps${master.threadId === null ? "" : ` (thread ${master.threadId})`}`,
  );
  if (master.summary !== null) lines.push(`Summary: ${master.summary}`);
  const recent = book.events.slice(-5);
  if (recent.length > 0) {
    lines.push("", "Latest:");
    for (const event of recent) lines.push(`  - ${event.text}`);
  }
  return lines.join("\n");
}
