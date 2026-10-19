// Live book state for the inline card and the side panel: fetch over RPC,
// refetch on the server's "book" signal and after a realtime reconnect.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { BookState } from "../book";

export type LegoRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export const BOOK_ID = /^lb_[a-z0-9]{6,24}$/u;
export const PANEL_ACTION_ID = "build";

/**
 * The last copy of each book this window fetched. BB remounts the banner and
 * panel when you switch threads or tabs; starting from the cached copy keeps
 * them on screen while the refetch is in flight, which matters when BB is slow.
 */
const CACHE_LIMIT = 40;
const cache = new Map<string, BookState | null>();
/** Each thread's newest book id, for the banner and the bare panel. */
const latestCache = new Map<string, string | null>();

function put<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** Keep the newer copy: replies to overlapping refetches can arrive out of order. */
function remember(bookId: string, book: BookState | null): BookState | null {
  const known = cache.get(bookId);
  const kept = known != null && book !== null && known.updatedAt > book.updatedAt ? known : book;
  put(cache, bookId, kept);
  return kept;
}

/** undefined when this window has not looked the thread up yet. */
export function cachedLatest(threadId: string | null): string | null | undefined {
  return threadId === null ? undefined : latestCache.get(threadId);
}

export function rememberLatest(threadId: string, bookId: string | null): void {
  put(latestCache, threadId, bookId);
}

export function useBook(bookId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [entry, setEntry] = useState<{ bookId: string | null; book: BookState | null | undefined }>(() => ({
    bookId,
    book: bookId === null ? undefined : cache.get(bookId),
  }));
  const book = entry.bookId === bookId ? entry.book : bookId === null ? undefined : cache.get(bookId);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (bookId === null) return;
    rpc.call("book_get", { bookId }).then(
      (result) => {
        setEntry({ bookId, book: remember(bookId, result.book) });
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
