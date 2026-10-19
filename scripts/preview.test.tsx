// Renders every model, finished and mid-build, to one static HTML page for
// visual review outside bb. Opt in: LEGO_PREVIEW=/path/to/out.html npx vitest run scripts
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { bookSpecSchema, type BookState } from "../src/book";
import { blueprintSchema } from "../src/blueprint";
import { DEMO_BLUEPRINT } from "../src/demo";
import { MODEL_IDS, type ModelId } from "../src/designs";

/** A blueprint as a planning agent might draw it for a docs-site task. */
const LIBRARY = blueprintSchema.parse({
  name: "Library",
  plate: { w: 16, d: 13, color: "green" },
  parts: [
    {
      name: "Steps and floor",
      shapes: [
        { kind: "plate", x: 2, y: 2, w: 12, d: 9, color: "lightGray" },
        { kind: "tile", x: 7, y: 11, w: 2, d: 2, color: "tan" },
      ],
    },
    {
      name: "Reading room",
      shapes: [
        {
          kind: "wall", x: 3, y: 3, z: 1, w: 10, d: 6, courses: 3, color: "tan",
          openings: [
            { side: "front", at: 4, width: 2, courses: 2, fill: "brown" },
            { side: "front", at: 1, width: 2, from: 1, fill: "glass" },
            { side: "front", at: 7, width: 2, from: 1, fill: "glass" },
            { side: "right", at: 1, width: 2, from: 1, fill: "glass" },
          ],
        },
      ],
    },
    {
      name: "Columns",
      shapes: [3, 6, 9, 12].map((x) => ({ kind: "tower", x, y: 9, z: 1, w: 1, d: 1, courses: 3, colors: ["white"] })),
    },
    { name: "Roof", shapes: [{ kind: "roof", x: 2, y: 2, z: 10, w: 12, d: 9, style: "gable-x", color: "darkGray", gable: "white" }] },
    { name: "Gardens", shapes: [{ kind: "tree", x: 1, y: 11 }, { kind: "tree", x: 14, y: 3 }] },
  ],
});
import { bookFromSpec } from "../src/plan";
import { useMotion } from "../src/ui/motion";
import { BagScene, ModelScene, useLayout } from "../src/ui/scene";

const out = process.env.LEGO_PREVIEW;

function makeBook(model: ModelId | "demo" | "library", stage: "building" | "assembling" | "complete"): BookState {
  const spec = bookSpecSchema.parse({
    title: `Preview ${model}`,
    task: "preview",
    ...(model === "demo" ? { blueprint: DEMO_BLUEPRINT } : model === "library" ? { blueprint: LIBRARY } : { model }),
    bags: [1, 2, 3, 4].map((n) => ({ id: `bag-${n}`, name: `Bag ${n}`, goal: "g", steps: Array.from({ length: 3 + (n % 3) }, (_, i) => ({ title: `s${i}` })) })),
    assembly: { steps: [{ title: "a", attaches: ["bag-1", "bag-2"] }, { title: "b", attaches: ["bag-3", "bag-4"] }] },
  });
  const book = bookFromSpec(spec, { id: `lb_preview${model}`, threadId: "t", projectId: "p", environmentId: null, now: 0 });
  const choice = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
  book.builders = [1, 2, 3].map((index) => ({ index, name: `Builder ${index}`, choice, threadId: "x", bagId: null, bagsBuilt: [], status: "idle", dispatchedAt: null }));
  book.master.choice = choice;
  book.status = stage;
  book.bags.forEach((bag, index) => {
    if (stage === "building") {
      const done = index === 0 ? bag.steps.length : Math.floor(bag.steps.length / 2);
      bag.steps.forEach((step, i) => (step.done = i < done));
      bag.status = index === 0 ? "built" : index === 3 ? "waiting" : "building";
      bag.builder = index < 3 ? index + 1 : null;
    } else {
      bag.steps.forEach((step) => (step.done = true));
      bag.status = stage === "complete" || index < 2 ? "attached" : "built";
    }
  });
  if (stage !== "building") book.master.status = stage === "complete" ? "done" : "working";
  return book;
}

function Preview({ book }: { book: BookState }) {
  const motion = useMotion(book);
  const layout = useLayout(book);
  return (
    <div className="card">
      <h3>
        {layout.design.name} · {book.status}
      </h3>
      <div className="lego-model">
        <ModelScene book={book} motion={motion} />
      </div>
      <div className="trays">
        {book.bags.map((bag) => (
          <div key={bag.id} className="tray" style={{ ["--lego-bag" as string]: "#F2CD37" }}>
            <BagScene bag={bag} book={book} layout={layout} motion={motion} />
          </div>
        ))}
      </div>
    </div>
  );
}

describe.skipIf(!out)("preview", () => {
  it("renders every model", () => {
    const css = readFileSync(new URL("../src/ui/lego.css", import.meta.url), "utf8");
    const cards = (["demo", "library", ...MODEL_IDS] as const).flatMap((model) =>
      (["building", "assembling", "complete"] as const).map((stage) => renderToStaticMarkup(<Preview book={makeBook(model, stage)} />)),
    ).join("\n");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      :root { --card:#fff; --foreground:#1b1b1b; --border:#ddd; --muted:#f2f2f2; --muted-foreground:#666; }
      body { font: 13px system-ui; background:#fafafa; margin:16px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
      .card { background:#fff; border:1px solid #ddd; border-radius:10px; padding:8px; }
      .card h3 { margin:0 0 4px; font-size:12px; }
      .lego-model { background:#eef5fb; border-radius:8px; }
      .lego-scene-model { width:100%; max-height:300px; }
      .trays { display:grid; grid-template-columns:repeat(4,1fr); gap:4px; margin-top:6px; }
      .tray { background:#fff; border:1px solid #eee; border-radius:6px; }
      ${css}
      *, *::before, *::after { animation-play-state: paused !important; animation-delay: -10s !important; transition: none !important; }
      .lego-fig-leave { opacity: 1 !important; animation: none !important; }
    </style></head><body>${cards}</body></html>`;
    writeFileSync(out!, html);
  });
});
