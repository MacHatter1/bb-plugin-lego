// `bb lego demo`: a sample book driven through the real BuildEngine by
// simulated workers, so the live view can be previewed without spending
// agent turns. Simulated threads never exist; nothing is spawned.
import { bookSpecSchema, type AgentChoice, type BookSpec, type BookState } from "./book";
import { blueprintSchema, type Blueprint } from "./blueprint";
import type { ModelId } from "./designs";
import { BuildEngine, LegoError, type EngineDeps, type WorkerSdk } from "./engine";
import type { BookStore } from "./store";

/** The demo's model on the box, drawn the way a planning agent would. */
export const DEMO_BLUEPRINT: Blueprint = blueprintSchema.parse({
  name: "Weather station",
  plate: { w: 14, d: 12, color: "green" },
  parts: [
    {
      name: "Concrete pad",
      shapes: [
        { kind: "plate", x: 2, y: 2, w: 10, d: 8, color: "lightGray" },
        { kind: "tile", x: 4, y: 10, w: 2, d: 2, color: "tan" },
      ],
    },
    {
      name: "Instrument hut",
      shapes: [
        {
          kind: "wall",
          x: 3,
          y: 4,
          z: 1,
          w: 4,
          d: 4,
          courses: 2,
          color: "white",
          openings: [
            { side: "front", at: 1, width: 2, courses: 2, fill: "blue" },
            { side: "right", at: 0, width: 2, from: 1, fill: "glass" },
          ],
        },
        { kind: "roof", x: 2, y: 3, z: 7, w: 6, d: 6, style: "flat", color: "darkGray" },
        { kind: "tile", x: 3, y: 4, z: 8, w: 4, d: 4, color: "white" },
      ],
    },
    { name: "Weather mast", shapes: [{ kind: "tower", x: 9, y: 5, z: 1, w: 1, d: 1, courses: 6, colors: ["lightGray"] }] },
    {
      name: "Anemometer and vane",
      shapes: [
        { kind: "plate", x: 9, y: 5, z: 19, w: 1, d: 1, color: "darkGray" },
        { kind: "plate", x: 8, y: 5, z: 20, w: 3, d: 1, color: "lightGray" },
        { kind: "plate", x: 8, y: 5, z: 21, w: 1, d: 1, color: "red" },
        { kind: "plate", x: 10, y: 5, z: 21, w: 1, d: 1, color: "red" },
        { kind: "plate", x: 9, y: 4, z: 21, w: 1, d: 3, color: "lightGray" },
        { kind: "plate", x: 9, y: 4, z: 22, w: 1, d: 1, color: "red" },
        { kind: "plate", x: 9, y: 6, z: 22, w: 1, d: 1, color: "red" },
        { kind: "brick", x: 9, y: 5, z: 22, w: 1, d: 1, color: "darkGray" },
        { kind: "plate", x: 8, y: 5, z: 25, w: 3, d: 1, color: "yellow" },
      ],
    },
    {
      name: "Radar dish",
      shapes: [
        { kind: "brick", x: 10, y: 7, z: 1, w: 2, d: 2, color: "lightGray" },
        { kind: "slope", x: 10, y: 7, z: 4, w: 2, d: 1, color: "white", dir: "+y" },
        { kind: "slope", x: 10, y: 8, z: 4, w: 2, d: 1, color: "white", dir: "-y" },
      ],
    },
    {
      name: "Solar panel and rain gauge",
      shapes: [
        { kind: "brick", x: 8, y: 9, z: 1, w: 1, d: 1, color: "darkGray" },
        { kind: "slope", x: 7, y: 8, z: 4, w: 2, d: 2, color: "blue", dir: "+y" },
        { kind: "brick", x: 11, y: 3, z: 1, w: 1, d: 1, color: "white" },
        { kind: "plate", x: 11, y: 3, z: 4, w: 1, d: 1, color: "blue" },
      ],
    },
    { name: "Garden", shapes: [{ kind: "tree", x: 1, y: 10 }] },
  ],
});

/** A task that suits each ready-made model, for `bb lego demo --model`. */
const DEMO_TITLES: Record<ModelId, string> = {
  house: "Settings page",
  rocket: "Release pipeline",
  castle: "Sign-in and permissions",
  weather: "Weather Dashboard",
  lighthouse: "Log search and alerts",
  robot: "Issue triage agent",
  shop: "Checkout and billing",
  bridge: "CRM contact sync",
};

export const DEMO_SPEC: BookSpec = {
  title: "Weather Dashboard",
  blueprint: DEMO_BLUEPRINT,
  task: "Build a small weather dashboard: a forecast API client, a caching layer, a React dashboard page, and docs.",
  studs:
    "Forecast type in src/weather/types.ts: { city: string; days: { date: string; highC: number; lowC: number; summary: string }[] }.\nThe client exports getForecast(city): Promise<Forecast>. The cache wraps it as cachedForecast(city).",
  bags: [
    {
      id: "client",
      name: "API client",
      goal: "Fetch forecasts from the weather service and map them to the Forecast type.",
      files: ["src/weather/client.ts", "src/weather/client.test.ts"],
      steps: [
        { title: "Define the Forecast type", detail: "Create src/weather/types.ts exactly as the studs describe." },
        { title: "Implement getForecast(city)" },
        { title: "Map service errors to typed failures" },
        { title: "Unit tests with a stubbed fetch" },
      ],
    },
    {
      id: "cache",
      name: "Cache",
      goal: "Cache forecasts for ten minutes per city.",
      files: ["src/weather/cache.ts", "src/weather/cache.test.ts"],
      steps: [
        { title: "TTL map keyed by city" },
        { title: "cachedForecast(city) wrapper" },
        { title: "Tests for expiry and misses" },
      ],
    },
    {
      id: "dashboard",
      name: "Dashboard page",
      goal: "A responsive page showing a five-day forecast for a chosen city.",
      files: ["src/pages/Weather.tsx", "src/pages/Weather.css"],
      steps: [
        { title: "City picker" },
        { title: "Five-day forecast cards" },
        { title: "Loading and error states" },
        { title: "Responsive layout" },
        { title: "Component tests" },
      ],
    },
    {
      id: "docs",
      name: "Docs",
      goal: "Document the dashboard and its configuration.",
      files: ["docs/weather.md"],
      dependsOn: ["client"],
      steps: [{ title: "Usage guide" }, { title: "Configuration reference" }],
    },
  ],
  assembly: {
    steps: [
      { title: "Route the dashboard page", attaches: ["dashboard"] },
      { title: "Wire the cache into the page's data loader", attaches: ["client", "cache"] },
      { title: "Link the docs from the README", attaches: ["docs"] },
      { title: "Run typecheck and tests" },
    ],
    verification: "npm run typecheck && npm test",
  },
};

const TICK_MS = 2600;

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

/** Demo books cannot resume after a reload; close them out instead. */
export function retireDemos(store: BookStore): string[] {
  const retired: string[] = [];
  for (const book of store.listActive()) {
    if (book.demo !== true) continue;
    store.mutate(book.id, (draft, log) => {
      draft.status = "cancelled";
      log({ kind: "info", text: "Demo stopped because the plugin reloaded." });
    });
    retired.push(book.id);
  }
  return retired;
}

export interface DemoDeps extends Omit<EngineDeps, "sdk"> {}

/** An engine whose workers are simulated: nothing is spawned or messaged. */
function demoEngine(deps: DemoDeps): BuildEngine {
  let next = 0;
  const sdk: WorkerSdk = {
    async spawn() {
      next += 1;
      return { threadId: `demo_${Date.now().toString(36)}_${next}` };
    },
    async send() {},
    async notify() {},
    async stop() {},
    async status() {
      return null;
    },
    async exists() {
      return true;
    },
  };
  return new BuildEngine({ ...deps, sdk });
}

/** Print a demo book that waits for someone to press Play. */
export function createDemo(
  deps: DemoDeps,
  context: { threadId: string; projectId: string; environmentId: string | null },
  setup: { builders: number; choice: AgentChoice; model?: ModelId },
): BookState {
  const spec = bookSpecSchema.parse(
    setup.model ? { ...DEMO_SPEC, title: DEMO_TITLES[setup.model], blueprint: undefined, model: setup.model } : DEMO_SPEC,
  );
  const created = demoEngine(deps).create(spec, context);
  const book =
    deps.store.mutate(created.id, (draft) => {
      draft.demo = true;
      draft.demoSetup = { builders: setup.builders, choice: setup.choice };
      draft.title = `${draft.title} (demo)`;
    })?.book ?? created;
  deps.publish(book);
  return book;
}

/** Start a printed demo book's simulated build. */
export function playDemo(
  deps: DemoDeps,
  bookId: string,
  options: { startDelayMs: number; signal: AbortSignal },
): BookState {
  const outcome = deps.store.mutate(bookId, (book, log) => {
    if (book.demo !== true) throw new LegoError("Only demo books can be played.");
    if (book.status !== "draft") throw new LegoError("This demo has already been played. Use Replay for a fresh one.");
    book.status = "configuring";
    log({ kind: "info", text: "Demo starting: the builders are grabbing their bags." });
  });
  if (outcome === null) throw new LegoError(`No instruction book with id ${bookId}.`);
  deps.publish(outcome.book);
  const setup = outcome.book.demoSetup ?? { builders: 3, choice: FALLBACK_CHOICE };
  void simulate(demoEngine(deps), bookId, {
    builders: setup.builders,
    builder: setup.choice,
    master: setup.choice,
    startDelayMs: options.startDelayMs,
    signal: options.signal,
  }).catch((error: unknown) => deps.log.warn(`demo ${bookId}: ${String(error)}`));
  return outcome.book;
}

/** Print a fresh copy of a demo book in the same thread and play it. */
export function replayDemo(
  deps: DemoDeps,
  bookId: string,
  options: { startDelayMs: number; signal: AbortSignal },
): BookState {
  const old = deps.store.get(bookId);
  if (old === null || old.demo !== true) throw new LegoError("Only demo books can be replayed.");
  const setup = old.demoSetup ?? {
    builders: Math.max(1, old.builders.length || 3),
    choice: old.builders[0]?.choice ?? old.master.choice ?? FALLBACK_CHOICE,
  };
  const book = createDemo(
    deps,
    { threadId: old.threadId, projectId: old.projectId, environmentId: old.environmentId },
    { ...setup, ...(old.model && !old.design ? { model: old.model } : {}) },
  );
  return playDemo(deps, book.id, options);
}

const FALLBACK_CHOICE: AgentChoice = { providerId: "claude-code", model: "demo", reasoningLevel: "medium" };

async function simulate(
  engine: BuildEngine,
  bookId: string,
  options: { builders: number; builder: AgentChoice; master: AgentChoice; startDelayMs: number; signal: AbortSignal },
): Promise<void> {
  const { signal } = options;
  await sleep(options.startDelayMs, signal);
  if (signal.aborted) return;
  engine.start(
    bookId,
    { sameForAll: true, builders: Array.from({ length: options.builders }, () => options.builder), master: options.master },
    null,
  );
  await engine.idle();

  while (!signal.aborted) {
    await sleep(TICK_MS, signal);
    const book = engine.get(bookId);
    if (book.status === "cancelled" || book.status === "complete") return;
    if (book.status === "building") {
      for (const builder of book.builders) {
        if (builder.status !== "working" || builder.threadId === null) continue;
        const bag = book.bags.find((candidate) => candidate.id === builder.bagId);
        if (bag === undefined) continue;
        const step = bag.steps.findIndex((candidate) => !candidate.done);
        if (step >= 0) {
          engine.stepDone(builder.threadId, step + 1);
        } else {
          engine.bagComplete(builder.threadId, `Simulated report for ${bag.name}: all ${bag.steps.length} steps done.`);
          engine.threadIdle(builder.threadId, null);
        }
      }
      await engine.idle();
    } else if (book.status === "assembling" && book.master.threadId !== null) {
      const step = book.master.steps.findIndex((candidate) => !candidate.done);
      if (step >= 0) {
        engine.assemblyStep(book.master.threadId, step + 1);
      } else {
        engine.buildComplete(book.master.threadId, "Simulated assembly: every bag attached and the checks pass.");
        return;
      }
    }
  }
}
