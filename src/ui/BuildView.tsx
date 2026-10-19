// The full build view shown in the side panel, plus the scene pieces the
// compact inline card reuses. The main model sits on a baseplate; each bag
// grows in its tray as builders snap bricks on, then drops onto the model
// when the Master Builder attaches it.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import {
  bricksPlaced,
  pieceCount,
  type AgentChoice,
  type BagState,
  type BookEvent,
  type BookState,
  type BookStatus,
  type BuilderState,
} from "../book";
import {
  BRICK_HEX,
  BUILDER_SHIRTS,
  BagGlyph,
  Brick,
  Minifig,
  MinifigHead,
  PLATE_HEIGHT,
  PLATE_PX,
  STUD,
  iso,
  viewBoxFor,
  type Box,
  type BrickVariant,
} from "./iso";
import { attachOrder, layoutModel, type DesignBrick, type ModelLayout } from "../designs";

import { Confetti, useMotion, type Motion } from "./motion";
import { BagScene, ModelScene, useLayout } from "./scene";
import { useOpenBuildPanel, type LegoRpc } from "./useBook";

// ---------------------------------------------------------------- helpers

export const STATUS_LABEL: Record<BookStatus, string> = {
  draft: "Instruction book ready",
  configuring: "Waiting for build setup",
  building: "Builders at work",
  assembling: "Master Builder assembling",
  complete: "Complete",
  failed: "Needs attention",
  cancelled: "Cancelled",
};

export function modelLabel(choice: AgentChoice): string {
  return choice.model.replace(/^claude-/u, "").replace(/-\d{8}$/u, "");
}

export function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}


// --------------------------------------------------------------- pieces

export function BrandBadge({ small = false }: { small?: boolean }) {
  return (
    <div className={`lego-badge${small ? " lego-badge-small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 20 14" width={small ? 16 : 20} height={small ? 11 : 14}>
        <rect x="1" y="4" width="18" height="9" rx="1.5" fill="#fff" />
        <rect x="3.5" y="1" width="5" height="4" rx="1" fill="#fff" />
        <rect x="11.5" y="1" width="5" height="4" rx="1" fill="#fff" />
      </svg>
      <span>LEGO BUILD</span>
    </div>
  );
}

export function StatusPill({ status }: { status: BookStatus }) {
  return (
    <span key={status} className={`lego-pill lego-pill-${status}`} title={STATUS_LABEL[status]}>
      <span className="lego-pill-dot" aria-hidden="true" />
      <span className="lego-pill-label">{STATUS_LABEL[status]}</span>
    </span>
  );
}

export function StudProgress({ placed, total }: { placed: number; total: number }) {
  const studs = Math.min(total, 48);
  const filled = total === 0 ? 0 : Math.round((placed / total) * studs);
  // Studs already lit light up left to right on first render; later ones pop at once.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <div className="lego-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={placed} aria-label="Pieces placed">
      <div className="lego-progress-studs">
        {Array.from({ length: studs }, (_, index) => (
          <span
            key={index}
            className={index < filled ? "lego-stud lego-stud-on" : "lego-stud"}
            style={mounted.current ? undefined : { animationDelay: `${index * 18}ms` }}
          />
        ))}
      </div>
      <span className="lego-progress-label">
        {placed}/{total} pieces
      </span>
    </div>
  );
}

function BagTray({
  bag,
  book,
  selected,
  onSelect,
  motion,
  layout,
}: {
  bag: BagState;
  book: BookState;
  selected: boolean;
  onSelect: () => void;
  motion: Motion;
  layout: ModelLayout;
}) {
  const done = bag.steps.filter((step) => step.done).length;
  const waitingOn = bag.dependsOn
    .map((id) => book.bags.find((other) => other.id === id))
    .filter((other): other is BagState => other !== undefined && other.status !== "built" && other.status !== "attached");
  const caption =
    bag.status === "attached"
      ? "On the model"
      : bag.status === "built"
        ? "Built, ready to attach"
        : bag.status === "failed"
          ? "Stopped"
          : bag.status === "building"
            ? `Builder ${bag.builder ?? "?"} · ${done}/${bag.steps.length}`
            : waitingOn.length > 0 && book.status !== "draft" && book.status !== "configuring"
              ? `After bag ${waitingOn.map((other) => other.number).join(", ")}`
              : `${bag.steps.length} step${bag.steps.length === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      className={`lego-tray lego-tray-${bag.status}${selected ? " lego-tray-selected" : ""}${bag.status === "built" && motion.isFresh(`${bag.id}:built`) ? " lego-hop" : ""}`}
      style={{ ["--lego-bag" as string]: BRICK_HEX[bag.color] }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Bag ${bag.number}, ${bag.name}: ${caption}`}
    >
      <BagScene bag={bag} book={book} layout={layout} motion={motion} />
      <span className="lego-tray-label">
        <BagGlyph number={bag.number} color={BRICK_HEX[bag.color]} size={16} />
        <span className="lego-tray-name">{bag.name}</span>
      </span>
      <span className="lego-tray-caption">{caption}</span>
    </button>
  );
}

function StepCallout({ number, title, detail, done, current, note, color, fresh }: {
  fresh: boolean;
  number: number;
  title: string;
  detail: string | null;
  done: boolean;
  current: boolean;
  note: string | null;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const long = detail !== null && detail.length > 140;
  return (
    <li className={`lego-step${done ? " lego-step-done" : ""}${current ? " lego-step-current" : ""}${done && fresh ? " lego-step-fresh" : ""}`} style={{ ["--lego-bag" as string]: color }}>
      <span className="lego-step-number" aria-hidden="true">
        {number}
      </span>
      <div className="lego-step-body">
        <div className="lego-step-title">
          {done ? (
            <span className="lego-step-check" aria-label="done">
              ✓
            </span>
          ) : null}
          <span>{title}</span>
        </div>
        {detail === null ? null : (
          <p className={`lego-step-detail${long && !open ? " lego-clamp" : ""}`}>{detail}</p>
        )}
        {long ? (
          <button type="button" className="lego-link" onClick={() => setOpen((value) => !value)}>
            {open ? "Less" : "More"}
          </button>
        ) : null}
        {note === null ? null : <p className="lego-step-note">{note}</p>}
      </div>
    </li>
  );
}

function Report({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lego-report">
      <button type="button" className="lego-link" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "▾" : "▸"} {title}
      </button>
      {open ? <pre className="lego-report-text">{text}</pre> : null}
    </div>
  );
}

function BagPage({ bag, book, motion }: { bag: BagState; book: BookState; motion: Motion }) {
  const color = BRICK_HEX[bag.color];
  const current = bag.status === "building" ? bag.steps.findIndex((step) => !step.done) : -1;
  const builder = bag.builder === null ? null : book.builders[bag.builder - 1] ?? null;
  return (
    <div className="lego-page-body">
      <div className="lego-page-head">
        <BagGlyph number={bag.number} color={color} size={30} />
        <div>
          <div className="lego-page-title">{bag.name}</div>
          <div className="lego-page-sub">
            {builder === null ? "Not started" : `${builder.name} · ${modelLabel(builder.choice)}`}
            {bag.dependsOn.length > 0
              ? ` · after ${bag.dependsOn
                  .map((id) => book.bags.find((other) => other.id === id))
                  .filter((other): other is BagState => other !== undefined)
                  .map((other) => `bag ${other.number}`)
                  .join(", ")}`
              : ""}
          </div>
        </div>
      </div>
      <p className="lego-goal">{bag.goal}</p>
      {bag.files.length > 0 ? (
        <div className="lego-files">
          {bag.files.map((file) => (
            <code key={file} className="lego-file">
              {file}
            </code>
          ))}
        </div>
      ) : null}
      {bag.error === null ? null : <p className="lego-error">{bag.error}</p>}
      <ol className="lego-steps">
        {bag.steps.map((step, index) => (
          <StepCallout
            key={index}
            number={index + 1}
            title={step.title}
            detail={step.detail}
            done={step.done}
            current={index === current}
            note={step.note}
            color={color}
            fresh={motion.isFresh(`${bag.id}:${index}`)}
          />
        ))}
      </ol>
      {bag.summary === null ? null : <Report title="Builder's report" text={bag.summary} />}
    </div>
  );
}

function AssemblyPage({ book, motion }: { book: BookState; motion: Motion }) {
  const current = book.master.status === "working" ? book.master.steps.findIndex((step) => !step.done) : -1;
  return (
    <div className="lego-page-body">
      <div className="lego-page-head">
        <MinifigHead master size={30} />
        <div>
          <div className="lego-page-title">Final assembly</div>
          <div className="lego-page-sub">
            {book.master.choice === null ? "Master Builder not chosen yet" : `Master Builder · ${modelLabel(book.master.choice)}`}
          </div>
        </div>
      </div>
      {book.studs === null ? null : <Report title="Studs: the shared connection points" text={book.studs} />}
      {book.master.error === null ? null : <p className="lego-error">{book.master.error}</p>}
      <ol className="lego-steps">
        {book.master.steps.map((step, index) => (
          <li
            key={index}
            className={`lego-step${step.done ? " lego-step-done" : ""}${index === current ? " lego-step-current" : ""}${step.done && motion.isFresh(`master:${index}`) ? " lego-step-fresh" : ""}`}
            style={{ ["--lego-bag" as string]: "#A0A5A9" }}
          >
            <span className="lego-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="lego-step-body">
              <div className="lego-step-title">
                {step.done ? (
                  <span className="lego-step-check" aria-label="done">
                    ✓
                  </span>
                ) : null}
                <span>{step.title}</span>
              </div>
              {step.attaches.length > 0 ? (
                <div className="lego-attaches">
                  {step.attaches.map((id) => {
                    const bag = book.bags.find((candidate) => candidate.id === id);
                    return bag === undefined ? null : (
                      <span key={id} className="lego-attach-chip">
                        <BagGlyph number={bag.number} color={BRICK_HEX[bag.color]} size={13} />
                        {bag.name}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              {step.detail === null ? null : <p className="lego-step-detail">{step.detail}</p>}
              {step.note === null ? null : <p className="lego-step-note">{step.note}</p>}
            </div>
          </li>
        ))}
      </ol>
      {book.verification === null ? null : <Report title="How the model is verified" text={book.verification} />}
      {book.master.summary === null ? null : <Report title="Master Builder's summary" text={book.master.summary} />}
    </div>
  );
}

function CrewMember({
  name,
  choice,
  status,
  detail,
  threadId,
  master,
}: {
  name: string;
  choice: AgentChoice | null;
  status: string;
  detail: string | null;
  threadId: string | null;
  master?: boolean;
}) {
  const navigate = useBbNavigate();
  const { providers } = useProviders();
  const provider = choice === null ? null : (providers.find((candidate) => candidate.id === choice.providerId) ?? { id: choice.providerId });
  const busy = status === "working";
  return (
    <li className={`lego-crew-member lego-crew-${status}`}>
      <MinifigHead master={master} size={24} busy={busy} />
      <div className="lego-crew-text">
        <div className="lego-crew-name">
          {name}
          <span className="lego-crew-status">{status === "working" ? "building" : status}</span>
        </div>
        <div className="lego-crew-model">
          {choice === null ? (
            "—"
          ) : (
            <>
              {provider === null ? null : <ProviderIcon providerKind="agent" provider={provider} className="lego-provider-icon" aria-hidden />}
              <span>{modelLabel(choice)}</span>
              {detail === null ? null : <span className="lego-crew-detail">· {detail}</span>}
            </>
          )}
        </div>
      </div>
      {threadId === null ? null : (
        <button type="button" className="lego-open" onClick={() => navigate.toThread(threadId)}>
          Open
        </button>
      )}
    </li>
  );
}

function Crew({ book }: { book: BookState }) {
  // Demo workers are simulated; their thread ids do not exist.
  const link = (threadId: string | null) => (book.demo === true ? null : threadId);
  if (book.builders.length === 0) return null;
  const bagName = (builder: BuilderState) => {
    const bag = book.bags.find((candidate) => candidate.id === builder.bagId);
    if (bag !== undefined) return `bag ${bag.number}`;
    return builder.bagsBuilt.length > 0 ? `${builder.bagsBuilt.length} bag${builder.bagsBuilt.length === 1 ? "" : "s"} built` : null;
  };
  return (
    <section className="lego-crew" aria-label="Builders">
      <ul>
        {book.builders.map((builder) => (
          <CrewMember
            key={builder.index}
            name={builder.name}
            choice={builder.choice}
            status={builder.status}
            detail={bagName(builder)}
            threadId={link(builder.threadId)}
          />
        ))}
        <CrewMember
          name="Master Builder"
          choice={book.master.choice}
          status={book.master.status}
          detail={null}
          threadId={link(book.master.threadId)}
          master
        />
      </ul>
    </section>
  );
}

function Ticker({ events }: { events: BookEvent[] }) {
  const now = useNow(30_000);
  const recent = events.slice(-4).reverse();
  if (recent.length === 0) return null;
  return (
    <ul className="lego-ticker" aria-live="polite">
      {recent.map((event, index) => (
        <li key={`${event.at}-${index}`} className={`lego-tick lego-tick-${event.kind}`}>
          <span className="lego-tick-text">{event.text}</span>
          <span className="lego-tick-time">{relativeTime(event.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- board

/** The whole workbench: model, trays, instruction pages, crew, and controls. */
export function BuildView({ book, rpc, className }: { book: BookState; rpc: LegoRpc; className?: string }) {
  const motion = useMotion(book);
  const layout = useLayout(book);
  const [tab, setTab] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const autoTab = useMemo(() => {
    if (book.status === "assembling" || book.status === "complete") return "assembly";
    return (book.bags.find((bag) => bag.status === "building") ?? book.bags[0])?.id ?? "assembly";
  }, [book]);

  const activeTab = tab ?? autoTab;
  const activeBag = book.bags.find((bag) => bag.id === activeTab) ?? null;
  const running = book.status === "building" || book.status === "assembling";
  const demoReady = book.demo === true && book.status === "draft";
  const demoDone = book.demo === true && (book.status === "complete" || book.status === "cancelled");
  const canRetry = book.bags.some((bag) => bag.status === "failed") || book.master.status === "failed";
  const masterModel = book.master.choice;

  const openPanel = useOpenBuildPanel();
  const act = (run: () => Promise<unknown>) => {
    setActionError(null);
    run().catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  };

  return (
    <article className={`lego-card lego-status-${book.status}${className ? ` ${className}` : ""}`} aria-label={`Lego set ${book.setNumber}: ${book.title}`}>
      <header className="lego-head">
        <BrandBadge />
        <div className="lego-heading">
          <span className="lego-set">Set {book.setNumber}</span>
          <h3 className="lego-title">{book.title}</h3>
        </div>
        <StatusPill status={book.status} />
      </header>

      <div className="lego-meta">
        <span>{book.bags.length} bag{book.bags.length === 1 ? "" : "s"}</span>
        <span>{pieceCount(book)} pieces</span>
        {book.builders.length > 0 ? <span>{book.builders.length} builder{book.builders.length === 1 ? "" : "s"}</span> : null}
        {masterModel === null ? null : <span>Master Builder: {modelLabel(masterModel)}</span>}
      </div>

      <StudProgress placed={bricksPlaced(book)} total={pieceCount(book)} />

      {book.error === null ? null : <p className="lego-error">{book.error}</p>}

      <div className="lego-stage">
        <section className="lego-model" aria-label="Main model">
          <div className="lego-section-label">Main model · {layout.design.name}</div>
          <ModelScene book={book} motion={motion} />
          {book.status === "complete" && motion.isFresh("status:complete") ? <Confetti pieces={26} spread={80} reach={110} x="50%" y="38%" /> : null}
        </section>
        <section className="lego-bags" aria-label="Bags">
          <div className="lego-section-label">Bags</div>
          <div className="lego-tray-grid">
            {book.bags.map((bag) => (
              <BagTray key={bag.id} bag={bag} book={book} selected={activeTab === bag.id} onSelect={() => setTab(bag.id)} motion={motion} layout={layout} />
            ))}
          </div>
        </section>
      </div>

      <section className="lego-book" aria-label="Instruction book">
        <div className="lego-tabs" role="tablist">
          {book.bags.map((bag) => (
            <button
              key={bag.id}
              type="button"
              role="tab"
              aria-selected={activeTab === bag.id}
              className={`lego-tab lego-tab-${bag.status}`}
              style={{ ["--lego-bag" as string]: BRICK_HEX[bag.color] }}
              onClick={() => setTab(bag.id)}
            >
              <span className="lego-tab-swatch" aria-hidden="true" />
              Bag {bag.number}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={activeTab === "assembly"} className="lego-tab" onClick={() => setTab("assembly")}>
            Assembly
          </button>
        </div>
        <div className="lego-page" role="tabpanel">
          {activeBag === null ? <AssemblyPage book={book} motion={motion} /> : <BagPage bag={activeBag} book={book} motion={motion} />}
        </div>
      </section>

      <Crew book={book} />
      <Ticker events={book.events} />

      {running || canRetry || demoReady || demoDone ? (
        <footer className="lego-actions">
          {demoReady ? (
            <button type="button" className="lego-button lego-button-primary" onClick={() => act(() => rpc.call("demo_play", { bookId: book.id }))}>
              ▶ Play demo
            </button>
          ) : null}
          {demoDone ? (
            <button type="button" className="lego-button" onClick={() => act(() => rpc.call("demo_replay", { bookId: book.id }).then((next) => openPanel({ id: next.bookId, setNumber: next.setNumber })))}>
              Replay demo
            </button>
          ) : null}
          {actionError === null ? null : <span className="lego-error">{actionError}</span>}
          {canRetry ? (
            <button type="button" className="lego-button" onClick={() => act(() => rpc.call("book_retry", { bookId: book.id }))}>
              Retry failed
            </button>
          ) : null}
          {running ? (
            confirmCancel ? (
              <>
                <span className="lego-confirm">Stop every builder?</span>
                <button type="button" className="lego-button lego-button-danger" onClick={() => act(() => rpc.call("book_cancel", { bookId: book.id }).finally(() => setConfirmCancel(false)))}>
                  Cancel build
                </button>
                <button type="button" className="lego-button" onClick={() => setConfirmCancel(false)}>
                  Keep building
                </button>
              </>
            ) : (
              <button type="button" className="lego-button" onClick={() => setConfirmCancel(true)}>
                Cancel build…
              </button>
            )
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
