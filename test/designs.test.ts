import { describe, expect, it } from "vitest";
import { DESIGNS, MODEL_IDS, designFor, layoutModel, overlaps, paintOrder } from "../src/designs";

function fakeBook(model: string, bagSteps: number[]) {
  const bags = bagSteps.map((steps, index) => ({
    id: `bag-${index + 1}`,
    steps: Array.from({ length: steps }, () => ({})),
  }));
  // Attach in reverse to check that parts follow attach order, not bag order.
  const master = { steps: [{ attaches: [...bags].reverse().map((bag) => bag.id) }] };
  return { id: "lb_test123456", model, bags, master };
}

describe("designs", () => {
  for (const id of MODEL_IDS) {
    const design = DESIGNS[id];
    const bricks = design.sections.flatMap((section) => section.bricks);

    it(`${id}: no two bricks overlap`, () => {
      const clashes: string[] = [];
      bricks.forEach((a, i) =>
        bricks.forEach((b, j) => {
          if (j > i && overlaps(a, b)) clashes.push(`${i} ${JSON.stringify(a)} × ${j} ${JSON.stringify(b)}`);
        }),
      );
      expect(clashes).toEqual([]);
    });

    it(`${id}: every brick sits on the baseplate`, () => {
      for (const brick of bricks) {
        expect(brick.x).toBeGreaterThanOrEqual(0);
        expect(brick.y).toBeGreaterThanOrEqual(0);
        expect(brick.z).toBeGreaterThanOrEqual(0);
        expect(brick.x + brick.w).toBeLessThanOrEqual(design.plate.w);
        expect(brick.y + brick.d).toBeLessThanOrEqual(design.plate.d);
      }
    });

    it(`${id}: paint order covers every brick once`, () => {
      const order = paintOrder(bricks);
      expect([...order].sort((a, b) => a - b)).toEqual(bricks.map((_, index) => index));
    });

    it(`${id}: any bag count gets a contiguous, complete split`, () => {
      for (let bags = 1; bags <= 12; bags += 1) {
        const steps = Array.from({ length: bags }, (_, index) => 1 + ((index * 5) % 12));
        const layout = layoutModel(fakeBook(id, steps));
        expect(layout.bricks).toHaveLength(bricks.length);
        expect(layout.byBag.size).toBe(bags);
        for (const placed of layout.bricks) {
          const bag = Number(placed.bagId.split("-")[1]);
          expect(placed.step).toBeGreaterThanOrEqual(0);
          expect(placed.step).toBeLessThan(steps[bag - 1]!);
        }
      }
    });
  }

  it("gives the first-attached bag the bottom of the model", () => {
    const layout = layoutModel(fakeBook("house", [3, 3, 3, 3]));
    // bag-4 is attached first (reverse order), so it gets the foundation.
    const first = layout.byBag.get("bag-4")!;
    const last = layout.byBag.get("bag-1")!;
    expect(first.bounds.z1).toBe(0);
    expect(last.bounds.z2).toBeGreaterThan(first.bounds.z2);
  });

  it("falls back to a stable model for books without one", () => {
    expect(designFor({ id: "lb_abc" }).id).toBe(designFor({ id: "lb_abc" }).id);
    expect(designFor({ id: "lb_abc", model: "rocket" }).id).toBe("rocket");
  });
});

describe("pickModel", () => {
  it("matches the task to a model", async () => {
    const { pickModel } = await import("../src/designs");
    expect(pickModel("Weather Dashboard: a forecast page")).toBe("weather");
    expect(pickModel("Add OAuth login and role permissions")).toBe("castle");
    expect(pickModel("Deploy the release to Kubernetes")).toBe("rocket");
    expect(pickModel("Stripe checkout and billing")).toBe("shop");
    expect(pickModel("Sync contacts via a webhook integration")).toBe("bridge");
    expect(pickModel("An AI agent that triages issues")).toBe("robot");
    expect(pickModel("Full-text search with alerts")).toBe("lighthouse");
    expect(pickModel("Rename a variable")).toBeNull();
  });
});
