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
  const store = new BookStore(db as unknown as SqlDatabase);
  const spawned: WorkerLaunch[] = [];
  const sent: Array<{ threadId: string; prompt: string }> = [];
  const notices: Array<{ threadId: string; text: string }> = [];
  const stopped: string[] = [];
  let next = 0;
  const sdk: WorkerSdk = {
    async spawn(launch) {
      spawned.push(launch);
      next += 1;
      return { threadId: `thr_worker${next}` };
    },
    async send(threadId, prompt) {
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
  };
  const published: string[] = [];
  const engine = new BuildEngine({
    store,
    sdk,
    publish: (book) => published.push(book.id),
    log: { info() {}, warn() {}, error() {} },
  });
  const book = engine.create(bookSpecSchema.parse(SPEC), {
    threadId: "thr_main",
    projectId: "proj_1",
    environmentId: "env_1",
  });
  return { engine, store, book, spawned, sent, notices, stopped, published };
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

    // Builder 2 goes idle without reporting: its last message becomes the report.
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
