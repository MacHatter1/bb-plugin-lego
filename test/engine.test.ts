import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { bookSpecSchema, parallelWidth, type AgentChoice, type BookSpec } from "../src/book";
import { BuildEngine, type WorkerLaunch, type WorkerSdk } from "../src/engine";
import { PlanError } from "../src/plan";
import { BookStore, MIGRATIONS, type SqlDatabase } from "../src/store";

const SONNET: AgentChoice = { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium" };
const OPUS: AgentChoice = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };

const SPEC: BookSpec = {
  title: "Billing dashboard",
  task: "Add a billing dashboard",
  studs: "Invoice type lives in src/types.ts",
  bags: [
    { id: "api", name: "API", goal: "Invoice API", files: ["src/api.ts"], steps: [{ title: "Route" }, { title: "Tests" }] },
    { id: "ui", name: "UI", goal: "Dashboard page", files: ["src/ui.tsx"], steps: [{ title: "Page" }] },
    { id: "docs", name: "Docs", goal: "Document it", dependsOn: ["API"], steps: [{ title: "Write docs" }] },
  ],
  assembly: {
    steps: [{ title: "Wire the router", attaches: ["api", "ui"] }, { title: "Run checks" }],
    verification: "npm test",
  },
};

function harness() {
  const db = new DatabaseSync(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  // One clock for the store and the engine, a second per tick, so order is exact.
  let clock = 1_800_000_000_000;
  const now = () => (clock += 1000);
  const store = new BookStore(db as unknown as SqlDatabase, now);
  const spawned: WorkerLaunch[] = [];
  const sent: Array<{ threadId: string; prompt: string }> = [];
  const notices: Array<{ threadId: string; text: string }> = [];
  const stopped: string[] = [];
  /** Errors the next spawn or send calls throw, in order. */
  const failures: string[] = [];
  const attempts = { spawn: 0, send: 0 };
  /** Threads the fake BB reports as deleted. */
  const deleted = new Set<string>();
  let next = 0;
  const sdk: WorkerSdk = {
    async spawn(launch) {
      attempts.spawn += 1;
      const failure = failures.shift();
      if (failure !== undefined) throw new Error(failure);
      spawned.push(launch);
      next += 1;
      return { threadId: `thr_worker${next}` };
    },
    async send(threadId, prompt) {
      attempts.send += 1;
      const failure = failures.shift();
      if (failure !== undefined) throw new Error(failure);
      sent.push({ threadId, prompt });
    },
    async notify(threadId, text) {
      notices.push({ threadId, text });
    },
    async stop(threadId) {
      stopped.push(threadId);
    },
    async status() {
      return null;
    },
    async exists(threadId) {
      return !deleted.has(threadId);
    },
  };
  const published: string[] = [];
  const engine = new BuildEngine({
    store,
    sdk,
    publish: (book) => published.push(book.id),
    log: { info() {}, warn() {}, error() {} },
    sleep: async () => {},
    now,
  });
  const book = engine.create(bookSpecSchema.parse(SPEC), {
    threadId: "thr_main",
    projectId: "proj_1",
    environmentId: "env_1",
  });
  return { engine, store, book, spawned, sent, notices, stopped, published, failures, attempts, deleted };
}

describe("planning", () => {
  it("resolves dependencies by name and attaches unlisted bags in the last step", () => {
    const { book } = harness();
    expect(book.bags.find((bag) => bag.id === "docs")?.dependsOn).toEqual(["api"]);
    expect(book.master.steps[1]?.attaches).toEqual(["docs"]);
    expect(parallelWidth(book.bags)).toBe(2);
    expect(book.setNumber).toBeGreaterThanOrEqual(10000);
  });

  it("rejects dependency loops", () => {
    const { engine } = harness();
    const looped = bookSpecSchema.parse({
      ...SPEC,
      bags: [
        { id: "a", name: "A", goal: "a", dependsOn: ["b"], steps: [{ title: "x" }] },
        { id: "b", name: "B", goal: "b", dependsOn: ["a"], steps: [{ title: "y" }] },
      ],
    });
    expect(() => engine.create(looped, { threadId: "t", projectId: "p", environmentId: null })).toThrow(PlanError);
  });

  it("rejects unknown dependencies", () => {
    const { engine } = harness();
    const broken = bookSpecSchema.parse({
      ...SPEC,
      bags: [{ id: "a", name: "A", goal: "a", dependsOn: ["ghost"], steps: [{ title: "x" }] }],
    });
    expect(() => engine.create(broken, { threadId: "t", projectId: "p", environmentId: null })).toThrow(/ghost/);
  });
});

describe("building", () => {
  it("builds bags in parallel, reuses builders, then hands off to the Master Builder", async () => {
    const { engine, store, book, spawned, sent, notices } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET, SONNET], master: OPUS }, "auto");
    await engine.idle();

    // Two builders take the two independent bags; docs waits on api.
    expect(spawned.map((launch) => launch.metadata)).toEqual([
      { bookId: book.id, role: "builder", builderIndex: 1 },
      { bookId: book.id, role: "builder", builderIndex: 2 },
    ]);
    expect(spawned[0]?.prompt).toContain('Bag 1 "API"');
    expect(spawned[0]?.permissionMode).toBe("auto");
    let state = store.get(book.id)!;
    expect(state.bags.map((bag) => bag.status)).toEqual(["building", "building", "waiting"]);

    // Builder 1 reports both steps and finishes; its next bag waits for idle.
    expect(engine.stepDone("thr_worker1", 1)).toContain("1/2");
    expect(() => engine.stepDone("thr_worker1", 3)).toThrow(/steps 1 to 2/);
    engine.bagComplete("thr_worker1", "API done; exports listInvoices()");
    await engine.idle();
    expect(sent).toHaveLength(0);
    engine.threadIdle("thr_worker1", "done");
    await engine.idle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.threadId).toBe("thr_worker1");
    expect(sent[0]?.prompt).toContain("listInvoices()");
    state = store.get(book.id)!;
    expect(state.bags.find((bag) => bag.id === "docs")?.builder).toBe(1);

    // Builder 2 stops without reporting anything: it is asked to report once.
    engine.threadIdle("thr_worker2", "Looks good to me");
    await engine.idle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)).toMatchObject({ threadId: "thr_worker2" });
    expect(sent.at(-1)?.prompt).toContain("0 of 1 steps");
    state = store.get(book.id)!;
    expect(state.bags.find((bag) => bag.id === "ui")?.status).toBe("building");

    // It reports the step but forgets lego_bag_complete: its last message is the report.
    engine.stepDone("thr_worker2", 1);
    engine.threadIdle("thr_worker2", "UI page built");
    await engine.idle();
    state = store.get(book.id)!;
    expect(state.bags.find((bag) => bag.id === "ui")).toMatchObject({ status: "built", summary: "UI page built" });
    expect(spawned).toHaveLength(2);

    // Last bag done: once every builder is idle the Master Builder starts.
    engine.bagComplete("thr_worker1", "Docs written");
    engine.threadIdle("thr_worker1", null);
    await engine.idle();
    expect(spawned).toHaveLength(3);
    expect(spawned[2]?.metadata.role).toBe("master");
    expect(spawned[2]?.choice).toEqual(OPUS);
    expect(spawned[2]?.prompt).toContain("Docs written");
    expect(store.get(book.id)?.status).toBe("assembling");

    expect(() => engine.stepDone("thr_worker3", 1)).toThrow(/not a Lego builder/);
    engine.assemblyStep("thr_worker3", 1);
    state = store.get(book.id)!;
    expect(state.bags.map((bag) => bag.status)).toEqual(["attached", "attached", "built"]);

    engine.buildComplete("thr_worker3", "All wired, tests pass");
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = store.get(book.id)!;
    expect(state.status).toBe("complete");
    expect(state.bags.every((bag) => bag.status === "attached")).toBe(true);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.threadId).toBe("thr_main");
    expect(notices[0]?.text).toContain("All wired, tests pass");

    // The master's idle event after completion does not notify twice.
    engine.threadIdle("thr_worker3", "bye");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notices).toHaveLength(1);
  });

  it("caps builders at the number of bags", async () => {
    const { engine, store, book } = harness();
    engine.start(book.id, { sameForAll: false, builders: [SONNET, OPUS, SONNET, OPUS, SONNET], master: OPUS }, null);
    await engine.idle();
    expect(store.get(book.id)?.builders.map((builder) => builder.choice.model)).toEqual(["sonnet", "opus", "sonnet"]);
  });

  it("marks a failed bag, tells the planner, and retries it", async () => {
    const { engine, store, book, notices, sent } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    engine.threadFailed("thr_worker1", "rate limited");
    await engine.idle();
    let state = store.get(book.id)!;
    expect(state.bags[0]).toMatchObject({ status: "failed", error: "rate limited" });
    expect(state.builders[0]?.status).toBe("failed");
    expect(notices[0]?.text).toContain("lego_retry");

    engine.retry(book.id, "api");
    await engine.idle();
    state = store.get(book.id)!;
    expect(state.bags[0]?.status).toBe("building");
    expect(sent[0]?.threadId).toBe("thr_worker1");
  });

  it("refuses to start twice and cancels running workers", async () => {
    const { engine, book, stopped } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET, SONNET], master: OPUS }, null);
    await engine.idle();
    expect(() => engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null)).toThrow(/already building/);
    const cancelled = await engine.cancel(book.id);
    expect(cancelled.status).toBe("cancelled");
    expect(stopped.sort()).toEqual(["thr_worker1", "thr_worker2"]);
  });
});

describe("builders that stop short", () => {
  it("never passes a blocked builder off as finished", async () => {
    const { engine, store, book, notices, sent } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();

    // First stop without a report: one nudge, the bag stays in progress.
    engine.threadIdle("thr_worker1", "Blocked: this checkout is not the billing project.");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(1);
    expect(store.get(book.id)?.bags[0]?.status).toBe("building");

    // Second stop: the bag fails with the builder's words, and the planner hears.
    engine.threadIdle("thr_worker1", "Blocked: this checkout is not the billing project.");
    await engine.idle();
    const state = store.get(book.id)!;
    expect(state.bags[0]).toMatchObject({ status: "failed" });
    expect(state.bags[0]?.steps.every((step) => !step.done)).toBe(true);
    expect(state.bags[0]?.error).toContain("not the billing project");
    expect(notices[0]?.text).toContain("not the billing project");
    // The builder is free again and picks up the independent UI bag.
    expect(state.bags[1]?.status).toBe("building");
    expect(sent.at(-1)?.prompt).toContain('Bag 2 "UI"');
  });

  it("fails a bag at once when the builder reports it blocked", async () => {
    const { engine, store, book, notices } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    expect(engine.bagBlocked("thr_worker1", "src/types.ts has no Invoice type")).toContain("blocked");
    await engine.idle();
    expect(store.get(book.id)?.bags[0]).toMatchObject({ status: "failed", error: "Blocked: src/types.ts has no Invoice type" });
    expect(notices[0]?.text).toContain("src/types.ts has no Invoice type");

    // Its idle event frees the builder without finishing the bag.
    engine.threadIdle("thr_worker1", "I am blocked.");
    await engine.idle();
    const state = store.get(book.id)!;
    expect(state.bags[0]?.status).toBe("failed");
    expect(state.bags[1]?.status).toBe("building");
    expect(() => engine.bagBlocked("thr_main", "x")).toThrow(/not a Lego builder/);
  });

  it("asks the Master Builder once, then fails the build", async () => {
    const { engine, store, book, notices, sent } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET, SONNET, SONNET], master: OPUS }, null);
    await engine.idle();
    for (const thread of ["thr_worker1", "thr_worker2"]) {
      engine.bagComplete(thread, "done");
      engine.threadIdle(thread, null);
    }
    await engine.idle();
    engine.bagComplete("thr_worker1", "docs done");
    engine.threadIdle("thr_worker1", null);
    await engine.idle();
    expect(store.get(book.id)?.status).toBe("assembling");
    const master = store.get(book.id)!.master.threadId!;

    engine.assemblyStep(master, 1);
    engine.threadIdle(master, "Wired the router.");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.at(-1)).toMatchObject({ threadId: master });
    expect(sent.at(-1)?.prompt).toContain("1 of 2 assembly steps");
    expect(store.get(book.id)?.status).toBe("assembling");

    engine.threadIdle(master, "Tests fail and I could not fix them.");
    await engine.idle();
    const state = store.get(book.id)!;
    expect(state.status).toBe("failed");
    expect(state.master.error).toContain("Tests fail");
    expect(notices.at(-1)?.text).toContain("Tests fail");
  });

  it("completes when the Master Builder reported every step but no summary", async () => {
    const { engine, store, book } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET, SONNET], master: OPUS }, null);
    await engine.idle();
    for (const thread of ["thr_worker1", "thr_worker2"]) {
      engine.bagComplete(thread, "done");
      engine.threadIdle(thread, null);
    }
    await engine.idle();
    engine.bagComplete("thr_worker1", "docs done");
    engine.threadIdle("thr_worker1", null);
    await engine.idle();
    const master = store.get(book.id)!.master.threadId!;
    engine.assemblyStep(master, 1);
    engine.assemblyStep(master, 2);
    engine.threadIdle(master, "All wired.");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.get(book.id)).toMatchObject({ status: "complete", master: { summary: "All wired." } });
  });
});

describe("dispatch", () => {
  it("retries a spawn that BB refused under load", async () => {
    const { engine, store, book, failures, attempts, notices } = harness();
    failures.push('HTTP 502: The "concurrency-limit" plugin\'s message.dispatch hook failed: did not decide within 10000ms');
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    expect(attempts.spawn).toBe(2);
    expect(store.get(book.id)?.bags[0]?.status).toBe("building");
    expect(store.get(book.id)?.builders[0]?.threadId).toBe("thr_worker1");
    expect(notices).toHaveLength(0);
  });

  it("gives up after three transient failures, and at once on other errors", async () => {
    const transient = harness();
    transient.failures.push("HTTP 503: busy", "HTTP 503: busy", "HTTP 503: busy");
    transient.engine.start(transient.book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await transient.engine.idle();
    expect(transient.attempts.spawn).toBe(3);
    expect(transient.store.get(transient.book.id)?.bags[0]?.status).toBe("failed");

    const invalid = harness();
    invalid.failures.push("HTTP 400: unknown model");
    invalid.engine.start(invalid.book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await invalid.engine.idle();
    expect(invalid.attempts.spawn).toBe(1);
    expect(invalid.store.get(invalid.book.id)?.bags[0]?.error).toContain("unknown model");
  });

  it("drops a retry when the build was cancelled during the wait", async () => {
    const { engine, store, book, failures, attempts } = harness();
    failures.push("HTTP 502: bad gateway");
    let cancel: Promise<unknown> | null = null;
    // Cancel while the engine waits before its second attempt.
    (engine as unknown as { sleep: () => Promise<void> }).sleep = async () => {
      cancel = engine.cancel(book.id);
      await cancel;
    };
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    expect(attempts.spawn).toBe(1);
    expect(store.get(book.id)?.status).toBe("cancelled");
  });
});

/** Build the harness book to completion with two builders. */
async function finish(h: ReturnType<typeof harness>, bookId = h.book.id) {
  h.engine.start(bookId, { sameForAll: true, builders: [SONNET, SONNET], master: OPUS }, null);
  await h.engine.idle();
  const workers = h.store.get(bookId)!.builders.map((builder) => builder.threadId!);
  for (const thread of workers) {
    h.engine.bagComplete(thread, "done");
    h.engine.threadIdle(thread, null);
  }
  await h.engine.idle();
  const docs = h.store.get(bookId)!.builders.find((builder) => builder.status === "working")!.threadId!;
  h.engine.bagComplete(docs, "docs done");
  h.engine.threadIdle(docs, null);
  await h.engine.idle();
  h.engine.buildComplete(h.store.get(bookId)!.master.threadId!, "All wired");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("deleted threads", () => {
  it("keeps a finished set on the shelf, unlinked and in place", async () => {
    const h = harness();
    await finish(h);
    const second = h.engine.create(bookSpecSchema.parse({ ...SPEC, title: "Second" }), {
      threadId: "thr_other",
      projectId: "proj_1",
      environmentId: "env_1",
    });
    await finish(h, second.id);
    expect(h.store.listComplete({ includeDemos: true, limit: 10, offset: 0 }).books.map((book) => book.id)).toEqual([second.id, h.book.id]);

    h.engine.threadDeleted("thr_main");
    const unlinked = h.store.get(h.book.id)!;
    expect(unlinked.threadDeleted).toBe(true);
    expect(h.store.get(second.id)?.threadDeleted).toBeUndefined();
    // Unlinking is a later edit, but the shelf still orders by when the set was built.
    expect(h.store.listComplete({ includeDemos: true, limit: 10, offset: 0 }).books.map((book) => book.id)).toEqual([second.id, h.book.id]);
  });

  it("stops messaging a deleted planning thread", async () => {
    const { engine, store, book, notices } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    engine.threadDeleted("thr_main");
    engine.threadFailed("thr_worker1", "rate limited");
    await engine.idle();
    expect(store.get(book.id)?.bags[0]?.status).toBe("failed");
    expect(notices).toHaveLength(0);
  });

  it("fails a deleted builder's bag, and a retry starts a fresh thread", async () => {
    const { engine, store, book, notices, spawned, sent } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    engine.threadDeleted("thr_worker1");
    await engine.idle();
    let state = store.get(book.id)!;
    expect(state.bags[0]).toMatchObject({ status: "failed", error: "its thread was deleted" });
    expect(state.builders[0]).toMatchObject({ status: "failed", threadId: null });
    expect(notices[0]?.text).toContain("its thread was deleted");

    engine.retry(book.id, "api");
    await engine.idle();
    state = store.get(book.id)!;
    expect(spawned).toHaveLength(2);
    expect(sent).toHaveLength(0);
    expect(state.builders[0]?.threadId).toBe("thr_worker2");
  });

  it("only unlinks an idle builder, and fails a deleted Master Builder", async () => {
    const { engine, store, book, notices } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET, SONNET], master: OPUS }, null);
    await engine.idle();
    for (const thread of ["thr_worker1", "thr_worker2"]) {
      engine.bagComplete(thread, "done");
      engine.threadIdle(thread, null);
    }
    await engine.idle();
    engine.bagComplete("thr_worker1", "docs done");
    engine.threadIdle("thr_worker1", null);
    await engine.idle();
    expect(store.get(book.id)?.status).toBe("assembling");

    // Builder 2 is idle while the Master Builder works: its link goes, nothing fails.
    engine.threadDeleted("thr_worker2");
    let state = store.get(book.id)!;
    expect(state.builders[1]).toMatchObject({ status: "idle", threadId: null });
    expect(state.status).toBe("assembling");
    expect(notices).toHaveLength(0);

    // The Master Builder mid-assembly: the build fails and the planner hears.
    engine.threadDeleted("thr_worker3");
    state = store.get(book.id)!;
    expect(state).toMatchObject({ status: "failed", master: { status: "failed", threadId: null } });
    expect(notices[0]?.text).toContain("its thread was deleted");
  });

  it("finds threads deleted while the plugin was unloaded", async () => {
    const h = harness();
    await finish(h);
    const master = h.store.get(h.book.id)!.master.threadId!;
    h.deleted.add("thr_main");
    h.deleted.add(master);
    await h.engine.sweepDeletedThreads();
    const state = h.store.get(h.book.id)!;
    expect(state.threadDeleted).toBe(true);
    expect(state.master.threadId).toBeNull();
    expect(state.builders.every((builder) => builder.threadId !== null)).toBe(true);
  });
});

describe("cancelled builds", () => {
  it("ignores worker events after a cancel", async () => {
    const { engine, store, book, notices } = harness();
    engine.start(book.id, { sameForAll: true, builders: [SONNET], master: OPUS }, null);
    await engine.idle();
    await engine.cancel(book.id);
    engine.threadIdle("thr_worker1", "stopped");
    engine.threadFailed("thr_worker1", "interrupted");
    await engine.idle();
    const state = store.get(book.id)!;
    expect(state.status).toBe("cancelled");
    expect(state.bags[0]?.status).toBe("building");
    expect(notices).toHaveLength(0);
  });
});
