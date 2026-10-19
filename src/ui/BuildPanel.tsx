// The side-panel tab: the full workbench for one book. Opened with
// { bookId } from the inline card or the setup form; opened bare from the
// panel launcher, it shows the newest build for this thread.
import { useEffect, useState } from "react";
import { useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { BuildView } from "./BuildView";
import { BOOK_ID, useBook } from "./useBook";

function requestedBook(params: PluginThreadPanelProps["params"]): string | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const bookId = (params as { bookId?: unknown }).bookId;
  return typeof bookId === "string" && BOOK_ID.test(bookId) ? bookId : null;
}

export function BuildPanel({ threadId, params }: PluginThreadPanelProps) {
  const requested = requestedBook(params);
  const rpc = useRpc<typeof rpcContract>();
  const [latest, setLatest] = useState<string | null | undefined>(requested === null ? undefined : null);
  useEffect(() => {
    if (requested !== null) return;
    let live = true;
    rpc.call("book_latest", { threadId }).then(
      (result) => live && setLatest(result.bookId),
      () => live && setLatest(null),
    );
    return () => {
      live = false;
    };
  }, [requested, rpc, threadId]);

  const bookId = requested ?? latest ?? null;
  const { book, error } = useBook(bookId);

  if (requested === null && latest === undefined) return <p className="lego-panel-empty">Looking for this thread's Lego build…</p>;
  if (bookId === null) {
    return (
      <p className="lego-panel-empty">
        This thread has no Lego builds yet. Ask the agent for one with <code>/lego</code> and a task.
      </p>
    );
  }
  if (book === undefined) return <p className="lego-panel-empty">{error ?? "Opening the instruction book…"}</p>;
  if (book === null) return <p className="lego-panel-empty">Instruction book {bookId} was not found.</p>;
  return <BuildView book={book} rpc={rpc} className="lego-panel" />;
}
