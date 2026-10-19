// The composer banner: a slim live strip above a thread's composer while
// that thread has a Lego build. "Open build" opens the side-panel workbench.
import { useCallback, useEffect, useState } from "react";
import {
  experimental_usePluginId as usePluginId,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { bricksPlaced, pieceCount, type BookState } from "../book";
import { StatusPill } from "./BuildView";
import { BRICK_HEX, MinifigHead } from "./iso";
import { Confetti, useMotion, type Motion } from "./motion";
import { useBook, useOpenBuildPanel } from "./useBook";

const DISMISSED_LIMIT = 50;

function headline(book: BookState): string {
  switch (book.status) {
    case "draft":
      return book.demo === true ? "Demo ready. Press Play to watch the builders." : "Instruction book printed. Open it to read the plan.";
    case "configuring":
      return "Choose the builders below to start.";
    case "cancelled":
      return "This build was cancelled.";
    default:
      return book.events[book.events.length - 1]?.text ?? "";
  }
}

/** Finished builds the user closed, remembered per browser. */
function useDismissed(pluginId: string) {
  const key = `${pluginId}:banner-dismissed`;
  const read = useCallback((): string[] => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }, [key]);
  const [dismissed, setDismissed] = useState<string[]>(read);
  const dismiss = (bookId: string) => {
    const next = [...read().filter((id) => id !== bookId), bookId].slice(-DISMISSED_LIMIT);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage can be unavailable; the banner still hides for this session.
    }
    setDismissed(next);
  };
  return { dismissed, dismiss };
}

/** One segment per bag (sized by its steps), then the Master Builder's. */
function BrickBar({ book, motion }: { book: BookState; motion: Motion }) {
  const masterDone = book.master.steps.filter((step) => step.done).length;
  return (
    <div className="lego-brickbar" aria-hidden="true">
      {book.bags.map((bag) => {
        const done = bag.steps.filter((step) => step.done).length;
        return (
          <span
            key={bag.id}
            className={`lego-seg lego-seg-${bag.status}`}
            title={`Bag ${bag.number} · ${bag.name}: ${done}/${bag.steps.length}`}
            style={{
              flexGrow: bag.steps.length,
              ["--lego-bag" as string]: BRICK_HEX[bag.color],
              ["--lego-fill" as string]: `${(done / bag.steps.length) * 100}%`,
            }}
          >
            {/* Each brick that lands flashes its segment. */}
            {done > 0 && motion.isFresh(`${bag.id}:${done - 1}`) ? <span key={done} className="lego-seg-flash" /> : null}
          </span>
        );
      })}
      <span
        className={`lego-seg lego-seg-master lego-seg-${book.master.status}`}
        title={`Assembly: ${masterDone}/${book.master.steps.length}`}
        style={{
          flexGrow: book.master.steps.length,
          ["--lego-bag" as string]: "#A0A5A9",
          ["--lego-fill" as string]: `${(masterDone / Math.max(1, book.master.steps.length)) * 100}%`,
        }}
      >
        {masterDone > 0 && motion.isFresh(`master:${masterDone - 1}`) ? <span key={masterDone} className="lego-seg-flash" /> : null}
      </span>
    </div>
  );
}

export function BuildBanner() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const pluginId = usePluginId();
  const { dismissed, dismiss } = useDismissed(pluginId);
  const openPanel = useOpenBuildPanel();
  const [bookId, setBookId] = useState<string | null>(null);

  const lookup = useCallback(() => {
    if (threadId === null) return;
    rpc.call("book_latest", { threadId }).then(
      (result) => setBookId(result.bookId),
      () => undefined,
    );
  }, [rpc, threadId]);
  useEffect(lookup, [lookup]);
  // A new book printed in this thread replaces the one on show.
  useRealtime("book", (payload) => {
    const signal = payload as { bookId?: unknown; threadId?: unknown } | null;
    if (signal?.threadId === threadId && signal.bookId !== bookId) lookup();
  });

  const { book } = useBook(bookId);
  const motion = useMotion(book);
  if (!book) return null;
  const finished = book.status === "complete" || book.status === "cancelled";
  if (finished && dismissed.includes(book.id)) return null;

  const placed = bricksPlaced(book);
  const total = pieceCount(book);
  const demoReady = book.demo === true && book.status === "draft";
  const play = () => {
    openPanel(book);
    void rpc.call("demo_play", { bookId: book.id }).catch(() => undefined);
  };
  const replay = () => {
    void rpc.call("demo_replay", { bookId: book.id }).then((next) => openPanel({ id: next.bookId, setNumber: next.setNumber }), () => undefined);
  };
  // Heads of whoever is building right now.
  const crew = [
    ...book.builders.filter((builder) => builder.status === "working").map((builder) => ({ key: `b${builder.index}`, master: false })),
    ...(book.master.status === "working" ? [{ key: "master", master: true }] : []),
  ];
  const latest = book.events[book.events.length - 1];
  // Only a build that finishes while you watch gets the celebration.
  const celebrate = book.status === "complete" && motion.isFresh("status:complete");
  return (
    <div
      key={book.id}
      className={`lego-banner lego-status-${book.status}${celebrate ? " lego-celebrate" : ""}`}
      role="status"
      aria-label={`Lego set ${book.setNumber}: ${book.title}`}
    >
      {celebrate ? <span className="lego-shimmer" aria-hidden="true" /> : null}
      {celebrate ? <Confetti pieces={18} spread={65} reach={64} x="23px" y="50%" /> : null}
      <span className="lego-banner-icon" aria-hidden="true">
        <svg viewBox="0 0 20 14" width="16" height="11">
          <rect x="1" y="4" width="18" height="9" rx="1.5" fill="#fff" />
          <rect className="lego-icon-stud lego-icon-stud-a" x="3.5" y="1" width="5" height="4" rx="1" fill="#fff" />
          <rect className="lego-icon-stud lego-icon-stud-b" x="11.5" y="1" width="5" height="4" rx="1" fill="#fff" />
        </svg>
      </span>
      <div className="lego-banner-main">
        <div className="lego-banner-row">
          <span className="lego-banner-title">
            <span className="lego-banner-set">Set {book.setNumber}</span>
            {book.title}
          </span>
          <StatusPill status={book.status} />
        </div>
        <div className="lego-banner-row">
          <BrickBar book={book} motion={motion} />
          <span className="lego-banner-count">
            <span key={placed} className="lego-roll">
              {placed}
            </span>
            /{total}
          </span>
          {crew.length > 0 ? (
            <span className="lego-banner-crew" aria-label={`${crew.length} at work`}>
              {crew.slice(0, 4).map((member, index) => (
                <span key={member.key} className="lego-banner-head" style={{ animationDelay: `${index * 150}ms` }}>
                  <MinifigHead master={member.master} size={15} busy />
                </span>
              ))}
              {crew.length > 4 ? <span className="lego-banner-more">+{crew.length - 4}</span> : null}
            </span>
          ) : null}
          <span key={`${book.status}-${latest?.at ?? 0}`} className="lego-banner-latest lego-text-in" title={headline(book)}>
            {headline(book)}
          </span>
        </div>
      </div>
      {finished && book.demo === true ? (
        <button type="button" className="lego-button" onClick={replay}>
          Replay
        </button>
      ) : null}
      {demoReady ? (
        <button type="button" className="lego-button lego-button-primary" onClick={play}>
          ▶ Play demo
        </button>
      ) : (
        <button type="button" className="lego-button lego-button-primary" onClick={() => openPanel(book)}>
          Open build
        </button>
      )}
      {finished ? (
        <button type="button" className="lego-banner-close" aria-label="Dismiss" onClick={() => dismiss(book.id)}>
          ×
        </button>
      ) : null}
    </div>
  );
}
