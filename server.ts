// bb-plugin-lego — plan a task as a Lego instruction book, build the bags in
// parallel with builder agents, and have a Master Builder assemble them,
// while a banner above the planning thread's composer and a side-panel
// workbench show the model grow.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  MAX_BUILDERS,
  bookSpecSchema,
  buildSetupSchema,
  parallelWidth,
  pieceCount,
  type AgentChoice,
  type BookState,
  type SetupPayload,
} from "./src/book";
import { createDemo, playDemo, replayDemo, retireDemos } from "./src/demo";
import { MODEL_IDS, designFor } from "./src/designs";
import { BuildEngine, LegoError, type WorkerSdk } from "./src/engine";
import { bookSummaryLine, formatBook } from "./src/format";
import { PlanError } from "./src/plan";
import { BookStore, MIGRATIONS } from "./src/store";

export const rpcContract = defineRpcContract({
  book_get: {
    input: z.object({ bookId: z.string().min(1).max(64) }).strict(),
    output: z.object({ book: z.custom<BookState>().nullable() }),
  },
  shelf_list: {
    input: z
      .object({
        includeDemos: z.boolean().default(false),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(240).default(48),
      })
      .strict(),
    output: z.object({
      books: z.array(z.custom<BookState>()),
      total: z.number(),
      demos: z.number(),
    }),
  },
  book_latest: {
    input: z.object({ threadId: z.string().min(1).max(64) }).strict(),
    output: z.object({ bookId: z.string().nullable() }),
  },
  book_cancel: {
    input: z.object({ bookId: z.string().min(1).max(64) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  demo_play: {
    input: z.object({ bookId: z.string().min(1).max(64) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  demo_replay: {
    input: z.object({ bookId: z.string().min(1).max(64) }).strict(),
    output: z.object({ bookId: z.string(), setNumber: z.number() }),
  },
  book_retry: {
    input: z
      .object({ bookId: z.string().min(1).max(64), bagId: z.string().min(1).max(64).optional() })
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

/** Realtime channel the composer banner and side panel listen on. */
export const BOOK_CHANNEL = "book";
const SETUP_RENDERER = "build-setup";
const BRICK_GLYPH = "lego/brick";
const SETUP_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const RECONCILE_EVERY_MS = 60_000;
const DEMO_PLAY_DELAY_MS = 1_200;

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type SendArgs = Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0];

const PLANNER_TOOLS = [
  "lego_create_book",
  "lego_setup_build",
  "lego_status",
  "lego_cancel_build",
  "lego_retry",
];
const BUILDER_TOOLS = ["lego_step_done", "lego_bag_complete", "lego_bag_blocked"];
const MASTER_TOOLS = ["lego_assembly_step", "lego_build_complete"];

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], ...(isError ? { isError: true } : {}) };
}

/** Run a tool body, turning expected failures into tool errors the model can read. */
async function guarded(run: () => Promise<string> | string) {
  try {
    return text(await run());
  } catch (error) {
    if (error instanceof LegoError || error instanceof PlanError) return text(error.message, true);
    throw error;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new BookStore(db);

  const textInput = (value: string) => [{ type: "text" as const, text: value, mentions: [] }];

  const sdk: WorkerSdk = {
    async spawn(launch) {
      const thread = await bb.sdk.threads.spawn({
        projectId: launch.projectId,
        environment:
          launch.environmentId === null
            ? { type: "project-default" }
            : { type: "reuse", environmentId: launch.environmentId },
        parentThreadId: launch.parentThreadId,
        title: launch.title,
        prompt: launch.prompt,
        providerId: launch.choice.providerId,
        model: launch.choice.model,
        reasoningLevel: launch.choice.reasoningLevel as SpawnArgs["reasoningLevel"],
        ...(launch.choice.serviceTier === undefined
          ? {}
          : { serviceTier: launch.choice.serviceTier as SpawnArgs["serviceTier"] }),
        ...(launch.permissionMode === null ? {} : { permissionMode: launch.permissionMode }),
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          ...(launch.permissionMode === null ? {} : { permissionMode: "explicit" as const }),
        },
        pluginMetadata: launch.metadata,
      });
      return { threadId: thread.id };
    },
    async send(threadId, prompt, choice, permissionMode) {
      await bb.sdk.threads.send({
        threadId,
        input: textInput(prompt),
        mode: "auto",
        model: choice.model,
        reasoningLevel: choice.reasoningLevel as SendArgs["reasoningLevel"],
        ...(permissionMode === null ? {} : { permissionMode }),
      });
    },
    async notify(threadId, message) {
      await bb.sdk.threads.send({ threadId, input: textInput(message), mode: "auto" });
    },
    async stop(threadId) {
      await bb.sdk.threads.stop({ threadId });
    },
    async status(threadId) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.status !== "idle") return { status: thread.status, lastText: null };
      if (thread.queuedMessageCount > 0) return { status: "queued", lastText: null };
      const { output } = await bb.sdk.threads.output({ threadId });
      return { status: thread.status, lastText: output };
    },
    async exists(threadId) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        return thread.deletedAt === null;
      } catch (error) {
        if (/HTTP 404|not found/iu.test(error instanceof Error ? error.message : String(error))) return false;
        throw error;
      }
    },
  };

  const publish = (book: BookState) =>
    bb.realtime.publish(BOOK_CHANNEL, { bookId: book.id, threadId: book.threadId, updatedAt: book.updatedAt });
  const engine = new BuildEngine({ store, sdk, publish, log: bb.log });

  // Demo books are simulated in this process; a reload stops them.
  retireDemos(store);
  const demos = new AbortController();
  bb.onDispose(() => demos.abort());


  /** The thread's workspace plus the provider/model it currently runs. */
  async function threadContext(threadId: string) {
    const [thread, options] = await Promise.all([
      bb.sdk.threads.get({ threadId }),
      bb.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
    ]);
    const choice: AgentChoice | null =
      options === null
        ? null
        : {
            providerId: thread.providerId,
            model: options.model,
            reasoningLevel: options.reasoningLevel,
          };
    return {
      projectId: thread.projectId,
      environmentId: thread.environmentId,
      choice,
      permissionMode: options?.permissionMode ?? null,
    };
  }

  // ------------------------------------------------------------------- RPC

  bb.rpc.register(rpcContract, {
    book_get: ({ bookId }) => ({ book: store.get(bookId) }),
    // A builder or Master Builder thread shows the book it works on; any
    // other thread shows its newest book.
    shelf_list: ({ includeDemos, offset, limit }) => {
      return store.listComplete({ includeDemos, offset, limit });
    },
    book_latest: ({ threadId }) => ({
      bookId: store.agentFor(threadId)?.bookId ?? store.list({ threadId, limit: 1 })[0]?.id ?? null,
    }),
    book_cancel: async ({ bookId }) => {
      await engine.cancel(bookId);
      return { ok: true };
    },
    book_retry: ({ bookId, bagId }) => {
      engine.retry(bookId, bagId);
      return { ok: true };
    },
    // The viewer pressed Play: give the side panel a moment to open first.
    demo_play: ({ bookId }) => {
      playDemo({ store, publish, log: bb.log }, bookId, { startDelayMs: DEMO_PLAY_DELAY_MS, signal: demos.signal });
      return { ok: true };
    },
    demo_replay: ({ bookId }) => {
      const book = replayDemo({ store, publish, log: bb.log }, bookId, { startDelayMs: DEMO_PLAY_DELAY_MS, signal: demos.signal });
      return { bookId: book.id, setNumber: book.setNumber };
    },
  });

  // ------------------------------------------------------- planner tools

  bb.agents.registerTool({
    name: "lego_create_book",
    description:
      "Print a Lego instruction book for a task: independent sub-assemblies (bags) that builder agents build in parallel, plus the assembly steps a single Master Builder follows to attach every bag to the main model. The user sees it in a banner above the composer and can open the full instruction book in the side panel.",
    instructions:
      "Lego: when the user asks for a Lego build (or invokes the lego skill), follow the lego skill to plan and to design a blueprint of a Lego model that depicts the task, then call lego_create_book, briefly describe the plan to the user, and call lego_setup_build so the user picks the builder and Master Builder agents. The build shows in a banner above the composer; do not paste ::lego directives or draw the plan yourself.",
    presentation: {
      label: { pending: "Printing the Lego instruction book", completed: "Printed the Lego instruction book" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: bookSpecSchema,
    async execute(spec, { threadId, projectId }) {
      return guarded(async () => {
        const thread = await threadContext(threadId);
        const book = engine.create(spec, {
          threadId,
          projectId: thread.projectId || projectId,
          environmentId: thread.environmentId,
        });
        const width = parallelWidth(book.bags);
        const design = designFor(book);
        const bricks = design.sections.reduce((total, section) => total + section.bricks.length, 0);
        const notes = book.designNotes ?? [];
        return [
          `Printed Set ${book.setNumber} "${book.title}" (book id ${book.id}): ${book.bags.length} bags, ${pieceCount(book)} pieces, up to ${width} bag${width === 1 ? "" : "s"} can be built at once.`,
          `Model on the box: ${design.name} (${bricks} bricks in ${design.sections.length} parts${book.design ? ", from your blueprint" : ", a ready-made model because no blueprint was sent"}).`,
          ...(notes.length > 0 ? ["Blueprint notes (the build goes ahead; fix these next time):", ...notes.map((note) => `- ${note}`)] : []),
          "",
          "A banner above the composer now shows the build, and its Open build button opens the full instruction book in the side panel. Describe the plan in two or three sentences (the bags, and what the Master Builder assembles). Do not paste a ::lego directive.",
          "",
          `Then call lego_setup_build with bookId "${book.id}" so the user chooses how many builders to use and which provider/model runs the builders and the Master Builder.`,
        ].join("\n");
      });
    },
  });

  bb.agents.registerTool({
    name: "lego_setup_build",
    description:
      "Ask the user, in a form, how to staff a Lego build: how many builder agents, whether every builder runs the same provider and model, which provider/model/reasoning the builders use, and which runs the Master Builder. When the user submits, the build starts immediately.",
    presentation: {
      label: { pending: "Asking how to staff the Lego build", completed: "Lego build staffed" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({
      bookId: z.string().min(1).max(64).describe("The id lego_create_book returned"),
      suggestedBuilders: z
        .number()
        .int()
        .min(1)
        .max(MAX_BUILDERS)
        .optional()
        .describe("Your recommended builder count; the user can change it"),
      note: z
        .string()
        .max(400)
        .optional()
        .describe("One or two sentences for the user about staffing, e.g. which bags are heavy"),
    }),
    async execute({ bookId, suggestedBuilders, note }, { threadId, signal }) {
      return guarded(async () => {
        const book = engine.get(bookId);
        if (book.status !== "draft" && book.status !== "configuring") {
          throw new LegoError(`Set ${book.setNumber} is already ${book.status}. Use lego_status to follow it.`);
        }
        const main = await threadContext(book.threadId);
        const fallback = main.choice;
        const width = parallelWidth(book.bags);
        const maxBuilders = Math.min(MAX_BUILDERS, book.bags.length);
        const payload: SetupPayload = {
          bookId: book.id,
          title: book.title,
          setNumber: book.setNumber,
          bagCount: book.bags.length,
          pieceCount: pieceCount(book),
          parallelWidth: width,
          recommendedBuilders: Math.max(1, Math.min(maxBuilders, suggestedBuilders ?? Math.min(width, 4))),
          maxBuilders,
          environmentId: book.environmentId,
          defaults: { builder: fallback, master: fallback },
          note: note ?? null,
        };
        engine.markConfiguring(bookId, true);
        const answer = await bb.ui.requestInput(
          {
            threadId,
            rendererId: SETUP_RENDERER,
            title: `Lego Set ${book.setNumber} build setup`,
            payload: payload as unknown as Parameters<BbPluginApi["ui"]["requestInput"]>[0]["payload"],
            timeoutMs: SETUP_TIMEOUT_MS,
            presentation: {
              label: { pending: "Waiting for the Lego build setup", completed: "Lego build set up" },
              icon: { glyph: BRICK_GLYPH },
            },
            describeSubmission(value) {
              const parsed = buildSetupSchema.safeParse(value);
              if (!parsed.success) return { title: "Lego build set up" };
              const setup = parsed.data;
              const first = setup.builders[0];
              const builders = setup.sameForAll && first
                ? `${setup.builders.length} × ${first.providerId}/${first.model}`
                : setup.builders.map((choice) => `${choice.providerId}/${choice.model}`).join(", ");
              return {
                title: `${setup.builders.length} builder${setup.builders.length === 1 ? "" : "s"} + Master Builder`,
                detail: `Builders: ${builders}\n\nMaster Builder: ${setup.master.providerId}/${setup.master.model}`,
              };
            },
          },
          { signal },
        );
        if (answer.outcome !== "submitted") {
          engine.markConfiguring(bookId, false);
          return `The user closed the build setup without starting Set ${book.setNumber}. Ask whether they want to change the plan, or call lego_setup_build again when they are ready.`;
        }
        const setup = buildSetupSchema.safeParse(answer.value);
        if (!setup.success) {
          engine.markConfiguring(bookId, false);
          throw new LegoError(`The setup form returned an invalid answer: ${setup.error.message}`);
        }
        const started = engine.start(bookId, setup.data, main.permissionMode);
        const builders = started.builders.length;
        return [
          `The user started the build: ${builders} builder${builders === 1 ? "" : "s"} and a Master Builder on ${setup.data.master.providerId}/${setup.data.master.model}.`,
          `The builders are working now in child threads. The banner above the composer and the side panel update live as bricks land; you do not need to poll.`,
          "BB may post routine reports here as child threads finish turns; do not act on those. This thread gets a [Lego] message when the Master Builder finishes or a builder fails. Tell the user the build is under way, then end your turn.",
        ].join("\n");
      });
    },
  });

  bb.agents.registerTool({
    name: "lego_status",
    description: "Show a Lego build's progress: bags, builders, Master Builder, and the latest events. Without a bookId, lists this thread's books.",
    presentation: {
      label: { pending: "Checking the Lego build", completed: "Checked the Lego build" },
      icon: { glyph: BRICK_GLYPH },
      suppress: true,
    },
    parameters: z.object({ bookId: z.string().min(1).max(64).optional() }),
    async execute({ bookId }, { threadId }) {
      return guarded(() => {
        if (bookId !== undefined) return formatBook(engine.get(bookId));
        const books = store.list({ threadId, limit: 10 });
        return books.length === 0 ? "This thread has no Lego books yet." : books.map(bookSummaryLine).join("\n");
      });
    },
  });

  bb.agents.registerTool({
    name: "lego_cancel_build",
    description: "Cancel a Lego build and stop its builder and Master Builder threads.",
    presentation: {
      label: { pending: "Cancelling the Lego build", completed: "Cancelled the Lego build" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({ bookId: z.string().min(1).max(64) }),
    async execute({ bookId }) {
      return guarded(async () => {
        const book = await engine.cancel(bookId);
        return `Cancelled Set ${book.setNumber}. Its worker threads were asked to stop; files they already changed stay in the workspace.`;
      });
    },
  });

  bb.agents.registerTool({
    name: "lego_retry",
    description: "Retry a failed bag (pass bagId) or, without bagId, every failed bag and a failed Master Builder.",
    presentation: {
      label: { pending: "Retrying the Lego build", completed: "Retried the Lego build" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({ bookId: z.string().min(1).max(64), bagId: z.string().min(1).max(64).optional() }),
    async execute({ bookId, bagId }) {
      return guarded(() => {
        const book = engine.retry(bookId, bagId);
        return `Set ${book.setNumber} is building again. The live view updates as builders report.`;
      });
    },
  });

  // ------------------------------------------------ builder / master tools

  bb.agents.registerTool({
    name: "lego_step_done",
    description: "Builder only: report that you finished one numbered step of your bag. Snaps a brick onto the bag in the user's live view.",
    presentation: {
      label: { pending: "Snapping a brick on", completed: "Snapped a brick on" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({
      step: z.number().int().min(1).max(50).describe("The step number from your bag's instructions"),
      note: z.string().max(500).optional().describe("Optional one-line note about the step"),
    }),
    async execute({ step, note }, { threadId }) {
      return guarded(() => engine.stepDone(threadId, step, note));
    },
  });

  bb.agents.registerTool({
    name: "lego_bag_complete",
    description: "Builder only: report that your whole bag is built, with a report for the Master Builder.",
    presentation: {
      label: { pending: "Sealing the bag", completed: "Bag built" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({
      summary: z
        .string()
        .min(1)
        .max(6000)
        .describe("What you built, files changed, interfaces the Master Builder needs, anything left undone"),
    }),
    async execute({ summary }, { threadId }) {
      return guarded(() => engine.bagComplete(threadId, summary));
    },
  });

  bb.agents.registerTool({
    name: "lego_bag_blocked",
    description:
      "Builder only: report that you cannot build your bag, and why. Use it instead of reporting steps you did not do, for example when the code the bag builds on is missing or the workspace contradicts the brief. The planning thread is told.",
    presentation: {
      label: { pending: "Reporting a blocked bag", completed: "Bag blocked" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({
      reason: z
        .string()
        .min(1)
        .max(2000)
        .describe("What is wrong and what you need to build the bag"),
    }),
    async execute({ reason }, { threadId }) {
      return guarded(() => engine.bagBlocked(threadId, reason));
    },
  });

  bb.agents.registerTool({
    name: "lego_assembly_step",
    description: "Master Builder only: report that you finished one numbered assembly step. Bags that step attaches snap onto the main model in the live view.",
    presentation: {
      label: { pending: "Attaching to the main model", completed: "Attached to the main model" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({
      step: z.number().int().min(1).max(50),
      note: z.string().max(500).optional(),
    }),
    async execute({ step, note }, { threadId }) {
      return guarded(() => engine.assemblyStep(threadId, step, note));
    },
  });

  bb.agents.registerTool({
    name: "lego_build_complete",
    description: "Master Builder only: report that the whole model is assembled and verified.",
    presentation: {
      label: { pending: "Finishing the model", completed: "Model complete" },
      icon: { glyph: BRICK_GLYPH },
    },
    parameters: z.object({
      summary: z
        .string()
        .min(1)
        .max(6000)
        .describe("What was assembled, fixes at the seams, verification results, open items"),
    }),
    async execute({ summary }, { threadId }) {
      return guarded(() => engine.buildComplete(threadId, summary));
    },
  });

  // Builders and the Master Builder see only their reporting tools; every
  // other thread sees the planning tools and the lego skill. The worker tools
  // re-check the server-side binding, so a forged role grants nothing.
  bb.agents.configure((context) => {
    const role = context.pluginMetadata.role;
    if (role === "builder") {
      return {
        tools: BUILDER_TOOLS,
        skills: [],
        instructions:
          "You are a Lego builder agent. Report each finished step with lego_step_done and finish with lego_bag_complete, or call lego_bag_blocked if you cannot build the bag. Do not start Lego builds of your own.",
      };
    }
    if (role === "master") {
      return {
        tools: MASTER_TOOLS,
        skills: [],
        instructions:
          "You are the Lego Master Builder. Report each assembly step with lego_assembly_step and finish with lego_build_complete. Do not start Lego builds of your own.",
      };
    }
    return { tools: PLANNER_TOOLS, skills: ["lego"] };
  });

  // ------------------------------------------------------------- events

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    // A worker held in the queue (for example by a concurrency limit) has not
    // started its bag yet; only a finished turn counts.
    if (thread.queuedMessageCount > 0) return;
    engine.threadIdle(thread.id, lastAssistantText);
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    engine.threadFailed(thread.id, error);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    engine.threadDeleted(thread.id);
  });

  bb.background.service("reconcile", {
    async start(signal) {
      try {
        await engine.sweepDeletedThreads();
      } catch (error) {
        bb.log.warn(`deleted-thread sweep failed: ${String(error)}`);
      }
      while (!signal.aborted) {
        try {
          await engine.reconcile();
        } catch (error) {
          bb.log.warn(`reconcile failed: ${String(error)}`);
        }
        await sleep(RECONCILE_EVERY_MS, signal);
      }
    },
  });

  // ---------------------------------------------------------------- CLI

  const requireThread = (threadId: string | undefined): string => {
    if (threadId === undefined) {
      throw new PluginCliError("This command reports for the thread that runs it.", {
        code: "thread_required",
        hint: "Run it from inside a Lego builder or Master Builder thread.",
      });
    }
    return threadId;
  };
  const cliRun = async (run: () => Promise<string> | string) => {
    try {
      return { exitCode: 0, stdout: await run() };
    } catch (error) {
      if (error instanceof LegoError || error instanceof PlanError) {
        throw new PluginCliError(error.message, { code: "lego_error" });
      }
      throw error;
    }
  };

  bb.cli.register(
    defineCli({
      name: "lego",
      summary: "Follow and report on Lego builds (parallel builders + a Master Builder)",
      commands: {
        list: cliCommand({
          summary: "List Lego books for this thread (or every thread with --all)",
          options: {
            all: { type: "boolean", description: "List books from every thread" },
            json: { type: "boolean", description: "Emit JSON" },
          },
          async run(input, ctx) {
            const books = store.list({
              ...(input.options.all || ctx.threadId === undefined ? {} : { threadId: ctx.threadId }),
              limit: 20,
            });
            if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(books.map((book) => ({ id: book.id, setNumber: book.setNumber, title: book.title, status: book.status }))) };
            return { exitCode: 0, stdout: books.length === 0 ? "No Lego books." : books.map(bookSummaryLine).join("\n") };
          },
        }),
        status: cliCommand({
          summary: "Show one book's bags, builders, and Master Builder",
          positionals: [{ name: "bookId", description: "Book id (lb_…)", required: true }],
          options: { json: { type: "boolean", description: "Emit the full book as JSON" } },
          async run(input) {
            return cliRun(() => {
              const book = engine.get(input.positionals.bookId);
              return input.options.json ? JSON.stringify(book) : formatBook(book);
            });
          },
        }),
        step: cliCommand({
          summary: "Builder: report a finished step of your bag",
          positionals: [{ name: "number", description: "Step number", required: true }],
          options: { note: { type: "string", description: "Optional note (max 500 chars)" } },
          async run(input, ctx) {
            return cliRun(() => engine.stepDone(requireThread(ctx.threadId), Number.parseInt(input.positionals.number, 10), input.options.note));
          },
        }),
        "bag-done": cliCommand({
          summary: "Builder: report your bag is built",
          options: { summary: { type: "string", required: true, description: "Report for the Master Builder (max 6000 chars)" } },
          async run(input, ctx) {
            return cliRun(() => engine.bagComplete(requireThread(ctx.threadId), input.options.summary));
          },
        }),
        blocked: cliCommand({
          summary: "Builder: report you cannot build your bag, and why",
          options: { reason: { type: "string", required: true, description: "What is wrong and what you need (max 2000 chars)" } },
          async run(input, ctx) {
            return cliRun(() => engine.bagBlocked(requireThread(ctx.threadId), input.options.reason));
          },
        }),
        assembled: cliCommand({
          summary: "Master Builder: report a finished assembly step",
          positionals: [{ name: "number", description: "Assembly step number", required: true }],
          options: { note: { type: "string", description: "Optional note (max 500 chars)" } },
          async run(input, ctx) {
            return cliRun(() => engine.assemblyStep(requireThread(ctx.threadId), Number.parseInt(input.positionals.number, 10), input.options.note));
          },
        }),
        complete: cliCommand({
          summary: "Master Builder: report the model is complete",
          options: { summary: { type: "string", required: true, description: "Final summary (max 6000 chars)" } },
          async run(input, ctx) {
            return cliRun(() => engine.buildComplete(requireThread(ctx.threadId), input.options.summary));
          },
        }),
        demo: cliCommand({
          summary: "Print a sample Lego book in this thread; press Play on its banner to watch simulated builders build it",
          options: {
            builders: { type: "integer", min: 1, max: 4, default: 3, description: "Simulated builders (1-4)" },
            model: { type: "enum", values: MODEL_IDS, description: "Model to build: house, rocket, or castle (default house)" },
            autoplay: { type: "boolean", description: "Start without waiting for Play" },
            delay: {
              type: "duration",
              defaultUnit: "s",
              min: 0,
              max: 120_000,
              default: 3_000,
              description: "With --autoplay, wait this long before starting (default 3s)",
            },
          },
          async run(input, ctx) {
            const threadId = requireThread(ctx.threadId);
            const thread = await threadContext(threadId);
            const choice = thread.choice ?? { providerId: "claude-code", model: "demo", reasoningLevel: "medium" };
            const deps = { store, publish, log: bb.log };
            const book = createDemo(
              deps,
              { threadId, projectId: thread.projectId, environmentId: thread.environmentId },
              { builders: input.options.builders, choice, ...(input.options.model ? { model: input.options.model } : {}) },
            );
            if (input.options.autoplay) {
              playDemo(deps, book.id, { startDelayMs: input.options.delay, signal: demos.signal });
            }
            return {
              exitCode: 0,
              stdout: [
                `Printed demo Set ${book.setNumber} (${book.id}). No agents are spawned.`,
                input.options.autoplay
                  ? `Simulated builders start in ${Math.round(input.options.delay / 1000)}s; the banner above this thread's composer follows them.`
                  : "Press Play on the banner above this thread's composer to start it.",
              ].join("\n"),
            };
          },
        }),
        cancel: cliCommand({
          summary: "Cancel a build and stop its workers",
          positionals: [{ name: "bookId", description: "Book id (lb_…)", required: true }],
          async run(input) {
            return cliRun(async () => {
              const book = await engine.cancel(input.positionals.bookId);
              return `Cancelled Set ${book.setNumber}.`;
            });
          },
        }),
        retry: cliCommand({
          summary: "Retry failed bags (or one with --bag) and a failed Master Builder",
          positionals: [{ name: "bookId", description: "Book id (lb_…)", required: true }],
          options: { bag: { type: "string", description: "Retry only this bag id" } },
          async run(input) {
            return cliRun(() => {
              const book = engine.retry(input.positionals.bookId, input.options.bag);
              return `Set ${book.setNumber} is building again.`;
            });
          },
        }),
      },
    }),
  );
}
