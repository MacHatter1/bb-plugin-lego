// Live book state for the inline card and the side panel: fetch over RPC,
// refetch on the server's "book" signal and after a realtime reconnect.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { BookState } from "../book";

export type LegoRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export const BOOK_ID = /^lb_[a-z0-9]{6,24}$/u;
export const PANEL_ACTION_ID = "build";

export function useBook(bookId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [book, setBook] = useState<BookState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (bookId === null) return;
    rpc.call("book_get", { bookId }).then(
      (result) => {
        setBook(result.book);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [bookId, rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("book", (payload) => {
    const signal = payload as { bookId?: unknown } | null;
    if (signal?.bookId === bookId) refetch();
  });
  // Signals are not replayed; catch up after a reconnect.
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !wasConnected.current) refetch();
    wasConnected.current = connection === "connected";
  }, [connection, refetch]);
  return { book, error, rpc, refetch };
}

/**
 * Open (or focus) the book's tab in the thread's side panel. Returns false
 * where the surface has no side panel, such as a chat embedded in a plugin.
 */
export function useOpenBuildPanel() {
  const navigate = useBbNavigate();
  return useCallback(
    (book: { id: string; setNumber: number }) =>
      navigate.openThreadPanel({
        actionId: PANEL_ACTION_ID,
        title: `Lego · Set ${book.setNumber}`,
        params: { bookId: book.id },
      }),
    [navigate],
  );
}
