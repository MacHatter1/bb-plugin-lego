// The collector's shelf: a sidebar page showing every model a Lego build has
// finished, standing on wooden shelves with a placard each. Click one to open
// the thread that built it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { bricksPlaced, type BookState } from "../book";
import { designFor } from "../designs";
import { BrandBadge, modelLabel } from "./BuildView";
import { ModelScene, STILL } from "./scene";

const SLOT_MIN_WIDTH = 230;
const PAGE = 48;
const MIN_ROWS = 2;

function useShelf(includeDemos: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [books, setBooks] = useState<BookState[] | null>(null);
  const [total, setTotal] = useState(0);
  const [demos, setDemos] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("shelf_list", { includeDemos, offset: 0, limit }).then(
      (result) => {
        setBooks(result.books);
        setTotal(result.total);
        setDemos(result.demos);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [includeDemos, limit, rpc]);
  useEffect(load, [load]);
  // Builds report often; refresh the shelf once things settle.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime("book", () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(load, 1500);
  });
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  return { books, total, demos, error, more: () => setLimit((value) => Math.min(240, value + PAGE)) };
}

/** How many models fit side by side on one shelf. */
function useColumns(minWidth: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? element.clientWidth;
      setColumns(Math.max(1, Math.floor(width / minWidth)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [minWidth]);
  return { ref, columns };
}

/** Render a model only once its slot scrolls near the viewport. */
function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

function dateLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function ShelfModel({ book, onOpen }: { book: BookState; onOpen: () => void }) {
  const { ref, seen } = useInView<HTMLButtonElement>();
  const design = designFor(book);
  const crew = book.builders.length;
  return (
    <button
      ref={ref}
      type="button"
      className="lego-shelf-slot lego-shelf-filled"
      onClick={onOpen}
      aria-label={`Set ${book.setNumber}, ${design.name}, built for ${book.title}. Open its thread.`}
    >
      <span className="lego-shelf-stage">
        <span className="lego-shelf-light" aria-hidden="true" />
        <span className="lego-shelf-model">
          {seen ? <ModelScene book={book} motion={STILL} display className="lego-scene-shelf" /> : null}
        </span>
        <span className="lego-shelf-shadow" aria-hidden="true" />
      </span>
      <span className="lego-shelf-plank" aria-hidden="true" />
      <span className="lego-placard">
        <span className="lego-placard-set">
          Set {book.setNumber}
          {book.demo === true ? <span className="lego-placard-demo">demo</span> : null}
        </span>
        <span className="lego-placard-name">{design.name}</span>
        <span className="lego-placard-task" title={book.title}>
          {book.title.replace(/ \(demo\)$/u, "")}
        </span>
        <span className="lego-placard-meta">
          {dateLabel(book.updatedAt)} · {bricksPlaced(book)} pieces · {crew} builder{crew === 1 ? "" : "s"}
          {book.master.choice ? ` · ${modelLabel(book.master.choice)}` : ""}
        </span>
      </span>
    </button>
  );
}

function EmptySlot() {
  return (
    <span className="lego-shelf-slot" aria-hidden="true">
      <span className="lego-shelf-stage" />
      <span className="lego-shelf-plank" />
      <span className="lego-placard lego-placard-empty" />
    </span>
  );
}

export function CollectorsShelf() {
  const [includeDemos, setIncludeDemos] = useState(false);
  const { books, total, demos, error, more } = useShelf(includeDemos);
  const { ref, columns } = useColumns(SLOT_MIN_WIDTH);
  const navigate = useBbNavigate();

  const items = books ?? [];
  const rows = Math.max(MIN_ROWS, Math.ceil(items.length / columns));
  const padding = rows * columns - items.length;
  const pieces = items.reduce((sum, book) => sum + bricksPlaced(book), 0);
  const agents = items.reduce((sum, book) => sum + book.builders.length + (book.master.choice ? 1 : 0), 0);

  return (
    <div className="lego-shelf-page">
      <div className="lego-shelf-inner">
        <header className="lego-shelf-head">
          <BrandBadge />
          <div className="lego-shelf-heading">
            <h2>Collector's shelf</h2>
            <p>
              {books === null
                ? "Dusting the shelves…"
                : total === 0
                  ? "Nothing on display yet."
                  : `${total} set${total === 1 ? "" : "s"} built · ${pieces} pieces · ${agents} agent${agents === 1 ? "" : "s"} on the crews`}
            </p>
          </div>
          {demos > 0 ? (
            <label className="lego-shelf-toggle">
              <input type="checkbox" checked={includeDemos} onChange={(event) => setIncludeDemos(event.target.checked)} />
              Show demo builds ({demos})
            </label>
          ) : null}
        </header>
        {error === null ? null : <p className="lego-error">{error}</p>}

        <div className="lego-cabinet">
          <div ref={ref} className="lego-cabinet-back" style={{ ["--lego-shelf-columns" as string]: String(columns) }}>
            {items.map((book) => (
              <ShelfModel key={book.id} book={book} onOpen={() => navigate.toThread(book.threadId)} />
            ))}
            {Array.from({ length: padding }, (_, index) => (
              <EmptySlot key={`empty-${index}`} />
            ))}
          </div>
        </div>

        {books !== null && books.length === 0 ? (
          <p className="lego-shelf-empty">
            Finished Lego builds land here. Ask an agent for one with <code>/lego</code> and a task
            {demos > 0 ? ", or tick Show demo builds above" : ", or run bb lego demo and press Play"}.
          </p>
        ) : null}
        {books !== null && total > books.length ? (
          <button type="button" className="lego-button lego-shelf-more" onClick={more}>
            Show more sets
          </button>
        ) : null}
      </div>
    </div>
  );
}
