// Older replies contain ::lego{book="…"} directives from before the composer
// banner existed. They render as a one-line chip instead of raw text; agents
// no longer emit them.
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { STATUS_LABEL } from "./BuildView";
import { BOOK_ID, useBook, useOpenBuildPanel } from "./useBook";

export function LegoChip({ attributes }: PluginMessageDirectiveProps) {
  const raw = attributes.book ?? "";
  const { book } = useBook(BOOK_ID.test(raw) ? raw : null);
  const openPanel = useOpenBuildPanel();
  if (!book) return null;
  return (
    <button type="button" className="lego-chip" onClick={() => openPanel(book)}>
      <span className="lego-banner-icon" aria-hidden="true">
        <svg viewBox="0 0 20 14" width="12" height="9">
          <rect x="1" y="4" width="18" height="9" rx="1.5" fill="#fff" />
          <rect x="3.5" y="1" width="5" height="4" rx="1" fill="#fff" />
          <rect x="11.5" y="1" width="5" height="4" rx="1" fill="#fff" />
        </svg>
      </span>
      <span className="lego-chip-text">
        Lego Set {book.setNumber} · {book.title}
      </span>
      <span className="lego-chip-status">{STATUS_LABEL[book.status]}</span>
    </button>
  );
}
