import { describe, expect, it } from "vitest";
import { blueprintSchema, compileBlueprint, expandShape, shapeSchema } from "../src/blueprint";
import { DEMO_BLUEPRINT } from "../src/demo";
import { layoutModel, overlaps } from "../src/designs";

const shape = (input: unknown) => shapeSchema.parse(input);

describe("blueprint shapes", () => {
  it("builds a wall ring with a filled door and a gap", () => {
    const bricks = expandShape(
      shape({
        kind: "wall",
        x: 0,
        y: 0,
        w: 4,
        d: 4,
        courses: 2,
        color: "white",
        openings: [
          { side: "front", at: 1, width: 2, courses: 2, fill: "brown" },
          { side: "right", at: 0, width: 2, from: 1 },
        ],
      }),
    );
    // Course 0: back, left, right, front split around the door (3 pieces) = 6.
    // Course 1: back, left, front (3 pieces), right is a full-width gap = 5.
    expect(bricks).toHaveLength(11);
    expect(bricks.filter((brick) => brick.color === "#7C503A")).toHaveLength(2);
    bricks.forEach((a, i) => bricks.forEach((b, j) => j > i && expect(overlaps(a, b)).toBe(false)));
  });

  it("steps a gable roof up to a ridge", () => {
    const bricks = expandShape(shape({ kind: "roof", x: 0, y: 0, z: 9, w: 6, d: 5, style: "gable-x", color: "red", gable: "white" }));
    const slopes = bricks.filter((brick) => brick.slope);
    expect(slopes.every((brick) => brick.slope === "-y" || brick.slope === "+y")).toBe(true);
    expect(Math.max(...bricks.map((brick) => brick.z))).toBe(15);
    bricks.forEach((a, i) => bricks.forEach((b, j) => j > i && expect(overlaps(a, b)).toBe(false)));
  });

  it("closes a pyramid roof", () => {
    const bricks = expandShape(shape({ kind: "roof", x: 0, y: 0, w: 5, d: 5, style: "pyramid", color: "red" }));
    bricks.forEach((a, i) => bricks.forEach((b, j) => j > i && expect(overlaps(a, b)).toBe(false)));
    expect(bricks.at(-1)).toMatchObject({ w: 1, d: 1 });
  });

  it("rejects unknown colours", () => {
    expect(() => shape({ kind: "brick", x: 0, y: 0, w: 1, d: 1, color: "sparkly" })).toThrow(/palette/);
  });
});

describe("compileBlueprint", () => {
  it("drops bricks off the plate or colliding, and reports them", () => {
    const { design, notes } = compileBlueprint(
      blueprintSchema.parse({
        name: "Test",
        plate: { w: 8, d: 8 },
        parts: [
          { name: "Base", shapes: [{ kind: "plate", x: 0, y: 0, w: 8, d: 8, color: "lightGray" }] },
          {
            name: "Stuff",
            shapes: [
              { kind: "brick", x: 7, y: 7, z: 1, w: 2, d: 2, color: "red" },
              { kind: "plate", x: 1, y: 1, w: 2, d: 2, color: "red" },
              { kind: "brick", x: 2, y: 2, z: 1, w: 2, d: 2, color: "blue" },
            ],
          },
        ],
      }),
    );
    expect(design.id).toBe("custom");
    expect(design.sections.map((section) => section.bricks.length)).toEqual([1, 1]);
    expect(notes.join(" ")).toMatch(/off the 8×8 baseplate/);
    expect(notes.join(" ")).toMatch(/collided/);
  });

  it("refuses a blueprint that leaves nothing to build", () => {
    expect(() =>
      compileBlueprint(
        blueprintSchema.parse({
          name: "Nothing",
          plate: { w: 6, d: 6 },
          parts: [{ name: "Far away", shapes: [{ kind: "brick", x: 20, y: 20, w: 1, d: 1, color: "red" }] }],
        }),
      ),
    ).toThrow(/no bricks left/);
  });

  it("compiles the demo blueprint cleanly and lays it out for any bag count", () => {
    const { design, notes } = compileBlueprint(DEMO_BLUEPRINT);
    expect(notes).toEqual([]);
    for (let bags = 1; bags <= 12; bags += 1) {
      const book = {
        id: "lb_demo",
        design,
        bags: Array.from({ length: bags }, (_, i) => ({ id: `b${i}`, steps: [{}, {}, {}] })),
        master: { steps: [] },
      };
      const layout = layoutModel(book);
      expect(layout.design.name).toBe("Weather station");
      expect(layout.bricks).toHaveLength(design.sections.reduce((n, s) => n + s.bricks.length, 0));
    }
  });
});
