// The build engine: hands bags to idle builders as their dependencies finish,
// starts the Master Builder once every bag is built, and turns tool calls and
// thread lifecycle events into book state. All state lives in BookStore;
// dispatch for one book is serialized through a promise chain.
import { randomUUID } from "node:crypto";
import {
  bricksPlaced,
  pieceCount,
  type AgentChoice,
  type BagState,
  type BookEvent,
  type BookState,
  type BuildSetup,
  type PermissionMode,
  type ParsedBookSpec,
} from "./book";
import { bookFromSpec } from "./plan";
import {
  builderPrompt,
  completionNotice,
  failureNotice,
  masterPrompt,
  nextBagPrompt,
  unfinishedAssemblyPrompt,
  unfinishedBagPrompt,
} from "./prompts";
import type { AgentBinding, BookStore } from "./store";

export interface WorkerLaunch {
  projectId: string;
  environmentId: string | null;
  parentThreadId: string;
  title: string;
  prompt: string;
  choice: AgentChoice;
  permissionMode: PermissionMode | null;
  metadata: { bookId: string; role: "builder" | "master"; builderIndex: number | null };
}

/** The slice of bb.sdk the engine needs; server.ts adapts the real SDK. */
export interface WorkerSdk {
  spawn(launch: WorkerLaunch): Promise<{ threadId: string }>;
  send(threadId: string, prompt: string, choice: AgentChoice, permissionMode: PermissionMode | null): Promise<void>;
  notify(threadId: string, text: string): Promise<void>;
  stop(threadId: string): Promise<void>;
  status(threadId: string): Promise<{ status: string; lastText: string | null } | null>;
  /** False once BB has deleted the thread. */
  exists(threadId: string): Promise<boolean>;
}

export interface EngineDeps {
  store: BookStore;
  sdk: WorkerSdk;
  publish(book: BookState): void;
  log: { info(message: string): void; warn(message: string): void; error(message: string): void };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type EventLog = (event: Omit<BookEvent, "at">) => void;

export class LegoError extends Error {
  override name = "LegoError";
}

const SUMMARY_LIMIT = 6000;
const NOTE_LIMIT = 500;
/** A worker must have been dispatched this long before reconcile trusts an idle status. */
const RECONCILE_GRACE_MS = 90_000;
/**
 * Errors worth another try: BB under load answers 5xx, or a message.dispatch
 * hook (such as a concurrency limit) times out. Neither leaves a thread or a
 * message behind, so retrying cannot duplicate work.
 */
const TRANSIENT = /HTTP 5\d\d|did not (?:decide|respond)|timed? ?out|ECONN|socket hang up|temporarily|busy/iu;
const RETRY_DELAYS_MS = [3_000, 10_000];
/** How BB reports a thread that no longer exists. */
const GONE = /HTTP 404|not found/iu;
/** How much of a worker's own words a failure keeps. */
const REASON_LIMIT = 2000;

const clip = (text: string | null, limit: number): string | null =>
  text === null ? null : text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

function describeChoice(choice: AgentChoice): string {
  return `${choice.providerId}/${choice.model}`;
}

function isBuilt(bag: BagState): boolean {
  return bag.status === "built" || bag.status === "attached";
}

export function nextReadyBag(book: BookState): BagState | undefined {
  return book.bags.find(
    (bag) =>
      bag.status === "waiting" &&
      bag.dependsOn.every((id) => {
        const dep = book.bags.find((other) => other.id === id);
        return dep !== undefined && isBuilt(dep);
      }),
  );
}

export class BuildEngine {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // ---------------------------------------------------------------- planning

  create(
    spec: ParsedBookSpec,
    context: { threadId: string; projectId: string; environmentId: string | null },
  ): BookState {
    const book = bookFromSpec(spec, {
      ...context,
      id: `lb_${randomUUID().replace(/-/gu, "").slice(0, 10)}`,
      now: this.now(),
    });
    this.deps.store.insert(book);
    this.deps.publish(book);
    return book;
  }

  get(bookId: string): BookState {
    const book = this.deps.store.get(bookId);
    if (book === null) throw new LegoError(`No instruction book with id ${bookId}.`);
    return book;
  }

  markConfiguring(bookId: string, configuring: boolean): void {
    this.update(bookId, (book) => {
      if (configuring && book.status === "draft") book.status = "configuring";
      if (!configuring && book.status === "configuring") book.status = "draft";
    });
  }

  // ---------------------------------------------------------------- building

  start(bookId: string, setup: BuildSetup, permissionMode: PermissionMode | null): BookState {
    const book = this.update(bookId, (book, log) => {
      if (book.status !== "draft" && book.status !== "configuring") {
        throw new LegoError(`Set ${book.setNumber} is already ${book.status}; it cannot be started again.`);
      }
      const count = Math.max(1, Math.min(setup.builders.length, book.bags.length));
      book.builders = setup.builders.slice(0, count).map((choice, index) => ({
        index: index + 1,
        name: `Builder ${index + 1}`,
        choice: setup.sameForAll ? (setup.builders[0] ?? choice) : choice,
        threadId: null,
        bagId: null,
        bagsBuilt: [],
        status: "idle",
        dispatchedAt: null,
      }));
      book.master.choice = setup.master;
      book.permissionMode = permissionMode;
      book.status = "building";
      book.error = null;
      const builderModels = [...new Set(book.builders.map((builder) => describeChoice(builder.choice)))];
      log({
        kind: "info",
        text: `Build started: ${count} builder${count === 1 ? "" : "s"} (${builderModels.join(", ")}), Master Builder on ${describeChoice(setup.master)}.`,
      });
    });
    this.schedule(bookId);
    return book;
  }

  /** Re-run dispatch for one book; safe to call at any time. */
  schedule(bookId: string): Promise<void> {
    const previous = this.chains.get(bookId) ?? Promise.resolve();
    const next = previous
      .then(() => this.pump(bookId))
      .catch((error: unknown) => {
        this.deps.log.error(`dispatch for ${bookId} failed: ${String(error)}`);
      });
    this.chains.set(bookId, next);
    void next.finally(() => {
      if (this.chains.get(bookId) === next) this.chains.delete(bookId);
    });
    return next;
  }

  /** Wait for queued dispatch work (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.all([...this.chains.values()]);
  }

  private async pump(bookId: string): Promise<void> {
    const assignments: Array<{ builderIndex: number; bagId: string }> = [];
    let startMaster = false;
    const current = this.deps.store.get(bookId);
    if (current === null || current.status !== "building") return;
    this.update(bookId, (book, log) => {
      for (const builder of book.builders) {
        if (builder.status !== "idle") continue;
        const bag = nextReadyBag(book);
        if (bag === undefined) break;
        bag.status = "building";
        bag.builder = builder.index;
        bag.startedAt = this.now();
        builder.bagId = bag.id;
        builder.status = "working";
        builder.dispatchedAt = this.now();
        builder.nudgedBag = null;
        log({ kind: "bag", text: `${builder.name} opened Bag ${bag.number} · ${bag.name}.` });
        assignments.push({ builderIndex: builder.index, bagId: bag.id });
      }
      const everyBagBuilt = book.bags.every(isBuilt);
      const buildersDone = book.builders.every((builder) => builder.status !== "working");
      if (everyBagBuilt && buildersDone && book.master.status === "waiting") {
        book.status = "assembling";
        book.master.status = "working";
        book.master.dispatchedAt = this.now();
        log({ kind: "info", text: "Every bag is built. The Master Builder is starting assembly." });
        startMaster = true;
      }
    });

    for (const assignment of assignments) {
      await this.dispatchBuilder(bookId, assignment.builderIndex, assignment.bagId);
    }
    if (startMaster) await this.dispatchMaster(bookId);
  }

  private async dispatchBuilder(bookId: string, builderIndex: number, bagId: string): Promise<void> {
    const book = this.get(bookId);
    const builder = book.builders[builderIndex - 1];
    const bag = book.bags.find((candidate) => candidate.id === bagId);
    if (builder === undefined || bag === undefined) return;
    const wanted = () => {
      const now = this.deps.store.get(bookId);
      return now !== null && now.status === "building" && now.builders[builderIndex - 1]?.bagId === bagId;
    };
    try {
      if (builder.threadId === null) {
        const spawned = await this.withRetry(`start ${builder.name}`, wanted, () => this.deps.sdk.spawn({
          projectId: book.projectId,
          environmentId: book.environmentId,
          parentThreadId: book.threadId,
          title: `Lego ${book.setNumber} · ${builder.name}`,
          prompt: builderPrompt(book, bag, builder.name),
          choice: builder.choice,
          permissionMode: book.permissionMode,
          metadata: { bookId, role: "builder", builderIndex },
        }));
        if (spawned === undefined) return;
        const { threadId } = spawned;
        this.deps.store.bindAgent(threadId, { bookId, role: "builder", builderIndex });
        this.update(bookId, (next) => {
          const target = next.builders[builderIndex - 1];
          if (target !== undefined) target.threadId = threadId;
        });
      } else {
        const threadId = builder.threadId;
        await this.withRetry(`send ${builder.name} its next bag`, wanted, () =>
          this.deps.sdk.send(threadId, nextBagPrompt(book, bag, builder.name), builder.choice, book.permissionMode),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failBuilder(bookId, builderIndex, `could not start ${builder.name}: ${message}`);
    }
  }

  private async dispatchMaster(bookId: string): Promise<void> {
    const book = this.get(bookId);
    const choice = book.master.choice;
    if (choice === null) {
      this.failMaster(bookId, "no Master Builder model was chosen");
      return;
    }
    const wanted = () => {
      const now = this.deps.store.get(bookId);
      return now !== null && now.status === "assembling" && now.master.status === "working";
    };
    try {
      if (book.master.threadId === null) {
        const spawned = await this.withRetry("start the Master Builder", wanted, () => this.deps.sdk.spawn({
          projectId: book.projectId,
          environmentId: book.environmentId,
          parentThreadId: book.threadId,
          title: `Lego ${book.setNumber} · Master Builder`,
          prompt: masterPrompt(book),
          choice,
          permissionMode: book.permissionMode,
          metadata: { bookId, role: "master", builderIndex: null },
        }));
        if (spawned === undefined) return;
        const { threadId } = spawned;
        this.deps.store.bindAgent(threadId, { bookId, role: "master", builderIndex: null });
        this.update(bookId, (next) => {
          next.master.threadId = threadId;
        });
      } else {
        const threadId = book.master.threadId;
        await this.withRetry("send the Master Builder its assembly", wanted, () =>
          this.deps.sdk.send(threadId, masterPrompt(book), choice, book.permissionMode),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failMaster(bookId, `could not start the Master Builder: ${message}`);
    }
  }

  // ------------------------------------------------------- worker reports

  stepDone(threadId: string, stepNumber: number, note?: string): string {
    const binding = this.binding(threadId, "builder");
    const { result } = this.mutate(binding.bookId, (book, log) => {
      const builder = book.builders[(binding.builderIndex ?? 0) - 1];
      const bag = book.bags.find((candidate) => candidate.id === builder?.bagId);
      if (builder === undefined || bag === undefined) {
        throw new LegoError("You have no bag in progress. Finish your turn.");
      }
      const step = bag.steps[stepNumber - 1];
      if (step === undefined) {
        throw new LegoError(`Bag ${bag.number} has steps 1 to ${bag.steps.length}; there is no step ${stepNumber}.`);
      }
      const already = step.done;
      step.done = true;
      step.note = clip(note?.trim() || null, NOTE_LIMIT) ?? step.note;
      if (!already) {
        log({
          kind: "brick",
          text: `${builder.name} snapped brick ${stepNumber}/${bag.steps.length} onto Bag ${bag.number}: ${step.title}`,
        });
      }
      const left = bag.steps.filter((candidate) => !candidate.done).length;
      return left === 0
        ? `Brick ${stepNumber}/${bag.steps.length} placed. Every step of Bag ${bag.number} is done: call lego_bag_complete with your report.`
        : `Brick ${stepNumber}/${bag.steps.length} placed on Bag ${bag.number} "${bag.name}". ${left} step${left === 1 ? "" : "s"} to go.`;
    });
    return result;
  }

  bagComplete(threadId: string, summary: string): string {
    const binding = this.binding(threadId, "builder");
    const { result } = this.mutate(binding.bookId, (book, log) => {
      const builder = book.builders[(binding.builderIndex ?? 0) - 1];
      const bag = book.bags.find((candidate) => candidate.id === builder?.bagId);
      if (builder === undefined || bag === undefined) {
        throw new LegoError("You have no bag in progress. Finish your turn.");
      }
      if (bag.status === "building" || bag.status === "failed") {
        this.finishBag(bag, summary);
        log({ kind: "bag", text: `${builder.name} finished Bag ${bag.number} · ${bag.name}.` });
      }
      return `Bag ${bag.number} "${bag.name}" is built and waiting for the Master Builder. Finish your turn now.`;
    });
    this.schedule(binding.bookId);
    return result;
  }

  bagBlocked(threadId: string, reason: string): string {
    const binding = this.binding(threadId, "builder");
    let notice: string | null = null;
    const { book, result } = this.mutate(binding.bookId, (book, log) => {
      const builder = book.builders[(binding.builderIndex ?? 0) - 1];
      const bag = book.bags.find((candidate) => candidate.id === builder?.bagId);
      if (builder === undefined || bag === undefined) {
        throw new LegoError("You have no bag in progress. Finish your turn.");
      }
      if (bag.status === "building") {
        // The builder stays bound until its turn ends; threadIdle frees it.
        bag.status = "failed";
        bag.error = clip(`Blocked: ${reason.trim()}`, NOTE_LIMIT);
        log({ kind: "error", text: `${builder.name} is blocked on Bag ${bag.number} · ${bag.name}.` });
        notice = `${builder.name} is blocked on Bag ${bag.number} · ${bag.name}. It reported:\n${clip(reason.trim(), REASON_LIMIT)}`;
      }
      return `Bag ${bag.number} "${bag.name}" is marked blocked and the planning thread has been told. Finish your turn now.`;
    });
    if (notice !== null && book.status === "building") this.tellPlanner(book, notice);
    return result;
  }

  assemblyStep(threadId: string, stepNumber: number, note?: string): string {
    const binding = this.binding(threadId, "master");
    const { result } = this.mutate(binding.bookId, (book, log) => {
      const step = book.master.steps[stepNumber - 1];
      if (step === undefined) {
        throw new LegoError(`The assembly has steps 1 to ${book.master.steps.length}; there is no step ${stepNumber}.`);
      }
      step.done = true;
      step.note = clip(note?.trim() || null, NOTE_LIMIT) ?? step.note;
      const attached: string[] = [];
      for (const id of step.attaches) {
        const bag = book.bags.find((candidate) => candidate.id === id);
        if (bag !== undefined && bag.status !== "attached") {
          bag.status = "attached";
          attached.push(`Bag ${bag.number} · ${bag.name}`);
        }
      }
      log({
        kind: attached.length > 0 ? "attach" : "brick",
        text:
          attached.length > 0
            ? `Master Builder attached ${attached.join(" and ")} to the model.`
            : `Master Builder finished assembly step ${stepNumber}: ${step.title}`,
      });
      const left = book.master.steps.filter((candidate) => !candidate.done).length;
      return left === 0
        ? "Every assembly step is done. Verify the model, then call lego_build_complete with your summary."
        : `Assembly step ${stepNumber} recorded. ${left} step${left === 1 ? "" : "s"} to go.`;
    });
    return result;
  }

  buildComplete(threadId: string, summary: string): string {
    const binding = this.binding(threadId, "master");
    const book = this.completeBuild(binding.bookId, summary);
    void this.notifyDone(book.id);
    return `Set ${book.setNumber} is complete. Finish your turn now.`;
  }

  // ------------------------------------------------------ thread lifecycle

  threadIdle(threadId: string, lastText: string | null): void {
    const binding = this.deps.store.agentFor(threadId);
    if (binding === null) return;
    if (binding.role === "builder") {
      this.builderIdle(binding.bookId, binding.builderIndex ?? 0, threadId, lastText);
      return;
    }
    this.masterIdle(binding.bookId, threadId, lastText);
  }

  /**
   * A builder's turn ended. A bag whose steps were all reported is finished,
   * with the last message as the report if lego_bag_complete never came. A
   * builder that stopped short is asked once to report; stopping short again
   * fails the bag, so a blocked builder never passes for a finished one.
   */
  private builderIdle(bookId: string, builderIndex: number, threadId: string, lastText: string | null): void {
    let nudge: { prompt: string; choice: AgentChoice; bagId: string } | null = null;
    let notice: string | null = null;
    const book = this.update(bookId, (book, log) => {
      if (book.status === "cancelled") return;
      const builder = book.builders[builderIndex - 1];
      if (builder === undefined || builder.threadId !== threadId || builder.status === "idle") return;
      const bag = book.bags.find((candidate) => candidate.id === builder.bagId);
      if (bag !== undefined && (bag.status === "building" || bag.status === "failed")) {
        const reported = bag.steps.every((step) => step.done);
        if (reported) {
          this.finishBag(bag, lastText ?? "(the builder finished without a report)");
          log({ kind: "bag", text: `${builder.name} finished Bag ${bag.number} · ${bag.name}.` });
        } else if (bag.status === "building" && builder.nudgedBag !== bag.id) {
          builder.nudgedBag = bag.id;
          builder.dispatchedAt = this.now();
          log({ kind: "info", text: `${builder.name} stopped before finishing Bag ${bag.number}; asking it to report.` });
          nudge = { prompt: unfinishedBagPrompt(bag), choice: builder.choice, bagId: bag.id };
          return;
        } else if (bag.status === "building") {
          const done = bag.steps.filter((step) => step.done).length;
          const words = clip(lastText?.trim() || "(no message)", REASON_LIMIT);
          bag.status = "failed";
          bag.error = clip(`Stopped at ${done}/${bag.steps.length} steps: ${lastText?.trim() || "no message"}`, NOTE_LIMIT);
          log({ kind: "error", text: `${builder.name} stopped without finishing Bag ${bag.number} · ${bag.name}.` });
          notice = `${builder.name} stopped without finishing Bag ${bag.number} · ${bag.name} (${done}/${bag.steps.length} steps reported). Its last message:\n${words}`;
        }
      }
      if (bag !== undefined && isBuilt(bag) && !builder.bagsBuilt.includes(bag.id)) builder.bagsBuilt.push(bag.id);
      builder.status = "idle";
      builder.bagId = null;
      builder.dispatchedAt = null;
    });
    if (nudge !== null) {
      const { prompt, choice, bagId } = nudge;
      const builder = book.builders[builderIndex - 1];
      const wanted = () => {
        const now = this.deps.store.get(bookId);
        return now !== null && now.status === "building" && now.builders[builderIndex - 1]?.bagId === bagId;
      };
      void this.withRetry(`nudge ${builder?.name ?? "a builder"}`, wanted, () =>
        this.deps.sdk.send(threadId, prompt, choice, book.permissionMode),
      ).catch((error: unknown) => {
        this.failBuilder(bookId, builderIndex, `could not reach ${builder?.name ?? "the builder"}: ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }
    if (notice !== null && book.status === "building") this.tellPlanner(book, notice);
    if (book.status === "building") this.schedule(bookId);
  }

  /** The Master Builder's turn ended: the same rules as builderIdle, for the whole model. */
  private masterIdle(bookId: string, threadId: string, lastText: string | null): void {
    const current = this.get(bookId);
    if (current.master.threadId !== threadId || current.status === "cancelled") return;
    const { status, steps } = current.master;
    if (status === "working" || status === "failed") {
      const done = steps.filter((step) => step.done).length;
      if (done === steps.length) {
        this.completeBuild(bookId, lastText ?? "(the Master Builder finished without a summary)");
      } else if (status === "working" && current.master.nudged !== true) {
        const book = this.update(bookId, (book, log) => {
          book.master.nudged = true;
          book.master.dispatchedAt = this.now();
          log({ kind: "info", text: "The Master Builder stopped before finishing the assembly; asking it to report." });
        });
        const choice = book.master.choice;
        if (choice !== null) {
          const wanted = () => {
            const now = this.deps.store.get(bookId);
            return now !== null && now.status === "assembling" && now.master.status === "working";
          };
          void this.withRetry("nudge the Master Builder", wanted, () =>
            this.deps.sdk.send(threadId, unfinishedAssemblyPrompt(book), choice, book.permissionMode),
          ).catch((error: unknown) => {
            this.failMaster(bookId, `could not reach the Master Builder: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        return;
      } else if (status === "working") {
        this.failMaster(
          bookId,
          `it stopped at ${done}/${steps.length} assembly steps without reporting the model complete. Its last message:\n${clip(lastText?.trim() || "(no message)", REASON_LIMIT)}`,
        );
        return;
      }
    }
    void this.notifyDone(bookId);
  }

  threadFailed(threadId: string, error: string | null): void {
    const binding = this.deps.store.agentFor(threadId);
    if (binding === null) return;
    const reason = error ?? "the agent's turn failed";
    if (binding.role === "builder") {
      this.failBuilder(binding.bookId, binding.builderIndex ?? 0, reason);
    } else {
      this.failMaster(binding.bookId, reason);
    }
  }

  /** Catch lifecycle events missed while the plugin was unloaded. */
  async reconcile(): Promise<void> {
    for (const book of this.deps.store.listActive()) {
      if (book.demo === true) continue;
      const workers: Array<{ threadId: string; dispatchedAt: number | null }> = [
        ...book.builders
          .filter((builder) => builder.status === "working" && builder.threadId !== null)
          .map((builder) => ({ threadId: builder.threadId as string, dispatchedAt: builder.dispatchedAt })),
        ...(book.master.status === "working" && book.master.threadId !== null
          ? [{ threadId: book.master.threadId, dispatchedAt: book.master.dispatchedAt }]
          : []),
      ];
      for (const worker of workers) {
        if (worker.dispatchedAt !== null && this.now() - worker.dispatchedAt < RECONCILE_GRACE_MS) continue;
        try {
          const state = await this.deps.sdk.status(worker.threadId);
          if (state === null) continue;
          if (state.status === "idle") this.threadIdle(worker.threadId, state.lastText);
          else if (state.status === "error") this.threadFailed(worker.threadId, null);
        } catch (error) {
          if (GONE.test(error instanceof Error ? error.message : String(error))) this.threadDeleted(worker.threadId);
          else this.deps.log.warn(`reconcile ${worker.threadId}: ${String(error)}`);
        }
      }
      if (book.status === "building") this.schedule(book.id);
    }
  }

  /**
   * BB deleted a thread. Books it planned keep their place on the shelf but
   * lose the link. A worker's link is cleared too; one that was mid-bag fails
   * it, so a retry starts a fresh thread instead of messaging a deleted one.
   */
  threadDeleted(threadId: string): void {
    const binding = this.deps.store.agentFor(threadId);
    if (binding !== null) this.unlinkWorker(binding, threadId);
    for (const book of this.deps.store.forThread(threadId)) {
      if (book.threadDeleted === true) continue;
      this.update(book.id, (next) => {
        next.threadDeleted = true;
      });
    }
  }

  /** Catch threads deleted while the plugin was unloaded. */
  async sweepDeletedThreads(): Promise<void> {
    const known = new Map<string, boolean>();
    const deleted = async (threadId: string): Promise<boolean> => {
      let gone = known.get(threadId);
      if (gone === undefined) {
        try {
          gone = !(await this.deps.sdk.exists(threadId));
        } catch (error) {
          this.deps.log.warn(`sweep ${threadId}: ${String(error)}`);
          gone = false;
        }
        known.set(threadId, gone);
      }
      return gone;
    };
    for (const book of this.deps.store.all()) {
      if (book.threadDeleted !== true && (await deleted(book.threadId))) this.threadDeleted(book.threadId);
      // Demo workers are simulated; their thread ids were never real.
      if (book.demo === true) continue;
      const workers = [...book.builders.map((builder) => builder.threadId), book.master.threadId];
      for (const threadId of workers) {
        if (threadId !== null && (await deleted(threadId))) this.threadDeleted(threadId);
      }
    }
  }

  private unlinkWorker(binding: AgentBinding, threadId: string): void {
    const book = this.deps.store.get(binding.bookId);
    if (book === null) return;
    if (binding.role === "builder") {
      const index = binding.builderIndex ?? 0;
      const builder = book.builders[index - 1];
      if (builder === undefined || builder.threadId !== threadId) return;
      if (builder.status === "working") this.failBuilder(book.id, index, "its thread was deleted");
      this.update(book.id, (next) => {
        const target = next.builders[index - 1];
        if (target !== undefined && target.threadId === threadId) target.threadId = null;
      });
      return;
    }
    if (book.master.threadId !== threadId) return;
    if (book.master.status === "working") this.failMaster(book.id, "its thread was deleted");
    this.update(book.id, (next) => {
      if (next.master.threadId === threadId) next.master.threadId = null;
    });
  }

  // ------------------------------------------------------- user controls

  async cancel(bookId: string): Promise<BookState> {
    const book = this.update(bookId, (book, log) => {
      if (book.status === "complete" || book.status === "cancelled") {
        throw new LegoError(`Set ${book.setNumber} is already ${book.status}.`);
      }
      book.status = "cancelled";
      for (const builder of book.builders) {
        if (builder.status === "working") builder.status = "idle";
      }
      if (book.master.status === "working") book.master.status = "waiting";
      log({ kind: "error", text: "Build cancelled. Workers were stopped." });
    });
    const threads = [
      ...book.builders.map((builder) => builder.threadId),
      book.master.threadId,
    ].filter((threadId): threadId is string => threadId !== null);
    await Promise.allSettled(threads.map((threadId) => this.deps.sdk.stop(threadId)));
    return book;
  }

  retry(bookId: string, bagId?: string): BookState {
    const masterRetry = { value: false };
    const book = this.update(bookId, (book, log) => {
      if (book.status === "cancelled" || book.status === "complete") {
        throw new LegoError(`Set ${book.setNumber} is ${book.status}; start a new book instead.`);
      }
      const failedBags = book.bags.filter(
        (bag) => bag.status === "failed" && (bagId === undefined || bag.id === bagId),
      );
      if (bagId !== undefined && failedBags.length === 0) {
        throw new LegoError(`Bag ${bagId} has not failed; nothing to retry.`);
      }
      for (const bag of failedBags) {
        const builder = book.builders[(bag.builder ?? 0) - 1];
        bag.status = "waiting";
        bag.error = null;
        bag.builder = null;
        if (builder !== undefined) {
          builder.status = "idle";
          builder.bagId = null;
        }
        log({ kind: "info", text: `Bag ${bag.number} · ${bag.name} goes back on the table for another try.` });
      }
      if (bagId === undefined && book.master.status === "failed") {
        book.master.status = "waiting";
        book.master.error = null;
        book.master.nudged = false;
        masterRetry.value = true;
        log({ kind: "info", text: "The Master Builder will try the assembly again." });
      }
      if (failedBags.length === 0 && !masterRetry.value) {
        throw new LegoError("Nothing has failed; nothing to retry.");
      }
      book.status = "building";
      book.error = null;
      book.notified = false;
    });
    this.schedule(bookId);
    return book;
  }

  // -------------------------------------------------------------- helpers

  private finishBag(bag: BagState, summary: string): void {
    for (const step of bag.steps) step.done = true;
    bag.status = "built";
    bag.error = null;
    bag.summary = clip(summary.trim() || "(no report)", SUMMARY_LIMIT);
    bag.finishedAt = this.now();
  }

  private completeBuild(bookId: string, summary: string): BookState {
    return this.update(bookId, (book, log) => {
      if (book.status === "complete") return;
      if (book.status === "cancelled") throw new LegoError("This build was cancelled.");
      for (const step of book.master.steps) step.done = true;
      for (const bag of book.bags) {
        if (bag.status === "built") bag.status = "attached";
      }
      book.master.status = "done";
      book.master.error = null;
      book.master.summary = clip(summary.trim() || "(no summary)", SUMMARY_LIMIT);
      book.status = "complete";
      book.completedAt = this.now();
      book.error = null;
      log({ kind: "done", text: `Set ${book.setNumber} is complete: ${bricksPlaced(book)}/${pieceCount(book)} pieces placed.` });
    });
  }

  private failBuilder(bookId: string, builderIndex: number, reason: string): void {
    let notice: string | null = null;
    const book = this.update(bookId, (book, log) => {
      if (book.status === "cancelled" || book.status === "complete") return;
      const builder = book.builders[builderIndex - 1];
      if (builder === undefined) return;
      const bag = book.bags.find((candidate) => candidate.id === builder.bagId);
      builder.status = "failed";
      if (bag !== undefined && bag.status === "building") {
        bag.status = "failed";
        bag.error = clip(reason, NOTE_LIMIT);
      }
      const what = bag === undefined ? `${builder.name} failed: ${reason}` : `${builder.name} failed on Bag ${bag.number} · ${bag.name}: ${reason}`;
      log({ kind: "error", text: what });
      notice = what;
    });
    if (notice !== null && book.status === "building") {
      this.tellPlanner(book, notice);
      this.schedule(bookId);
    }
  }

  private tellPlanner(book: BookState, what: string): void {
    if (book.threadDeleted === true) return;
    void this.deps.sdk.notify(book.threadId, failureNotice(book, what)).catch((error: unknown) => {
      this.deps.log.warn(`failure notice for ${book.id}: ${String(error)}`);
    });
  }

  /**
   * Run a spawn or send, retrying transient failures while the work is still
   * wanted. Resolves undefined if the build moved on during a wait.
   */
  private async withRetry<T>(what: string, wanted: () => boolean, run: () => Promise<T>): Promise<T | undefined> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !TRANSIENT.test(message)) throw error;
        this.deps.log.warn(`${what}: ${message}; trying again in ${delay / 1000}s`);
        await this.sleep(delay);
        if (!wanted()) return undefined;
      }
    }
  }

  private failMaster(bookId: string, reason: string): void {
    const book = this.update(bookId, (book, log) => {
      if (book.status === "complete" || book.status === "cancelled") return;
      book.master.status = "failed";
      book.master.error = clip(reason, NOTE_LIMIT);
      book.status = "failed";
      book.error = `Master Builder: ${reason}`;
      log({ kind: "error", text: `The Master Builder stopped: ${reason}` });
    });
    if (book.status === "failed") this.tellPlanner(book, `the Master Builder stopped: ${reason}`);
  }

  private async notifyDone(bookId: string): Promise<void> {
    let shouldNotify = false;
    const book = this.update(bookId, (book) => {
      if (book.status === "complete" && !book.notified && book.threadDeleted !== true) {
        book.notified = true;
        shouldNotify = true;
      }
    });
    if (!shouldNotify) return;
    try {
      await this.deps.sdk.notify(book.threadId, completionNotice(book));
    } catch (error) {
      this.deps.log.warn(`completion notice for ${bookId}: ${String(error)}`);
    }
  }

  private binding(threadId: string, role: "builder" | "master") {
    const binding = this.deps.store.agentFor(threadId);
    if (binding === null || binding.role !== role) {
      throw new LegoError(
        role === "builder"
          ? "This thread is not a Lego builder. Only builder threads report bricks."
          : "This thread is not the Lego Master Builder. Only the Master Builder reports assembly.",
      );
    }
    return binding;
  }

  private mutate<R>(
    bookId: string,
    change: (book: BookState, log: EventLog) => R,
  ): { book: BookState; result: R } {
    const outcome = this.deps.store.mutate(bookId, change);
    if (outcome === null) throw new LegoError(`No instruction book with id ${bookId}.`);
    this.deps.publish(outcome.book);
    return outcome;
  }

  private update(bookId: string, change: (book: BookState, log: EventLog) => void): BookState {
    return this.mutate(bookId, change).book;
  }
}
