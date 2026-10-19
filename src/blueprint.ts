// Blueprints: the planning agent designs the model on the box for each task
// with a few high-level shapes (walls with openings, striped towers, roofs,
// trees, single bricks). compileBlueprint expands them into bricks, keeps
// everything on the baseplate, and drops bricks that would collide.
import { z } from "zod";
import { overlaps, type Design, type DesignBrick, type SlopeDir } from "./designs";

/** Named colours the agent can use; any #rrggbb also works. */
export const PALETTE: Record<string, string> = {
  red: "#C91A09",
  darkRed: "#9C2A1B",
  orange: "#FE8A18",
  yellow: "#F2CD37",
  tan: "#E4CD9E",
  brown: "#7C503A",
  green: "#237841",
  brightGreen: "#58AB41",
  lime: "#A5CA18",
  blue: "#1E6FD0",
  darkBlue: "#0A3463",
  azure: "#36AEBF",
  glass: "#9BD3F0",
  water: "#2E78C7",
  purple: "#6C3FA8",
  pink: "#E86FA7",
  white: "#F4F4F4",
  lightGray: "#A0A5A9",
  darkGray: "#6C6E68",
  black: "#2B2D2F",
};

const MAX_BRICKS = 220;
const MAX_HEIGHT = 90;
const B = 3;

const color = z
  .string()
  .trim()
  .refine((value) => value in PALETTE || /^#[0-9a-fA-F]{6}$/u.test(value), {
    message: `Use a palette colour (${Object.keys(PALETTE).join(", ")}) or #rrggbb`,
  });
const at = z.number().int().min(0).max(40);
const size = z.number().int().min(1).max(24);
const level = z.number().int().min(0).max(MAX_HEIGHT).default(0);
const dir = z.enum(["+x", "-x", "+y", "-y"]);

const brickShape = z.object({
  kind: z.literal("brick"),
  x: at,
  y: at,
  z: level,
  w: size,
  d: size,
  h: z.number().int().min(1).max(36).default(B).describe("Height in plates; a brick is 3"),
  color,
  studs: z.boolean().default(true),
});
const plateShape = z.object({ kind: z.literal("plate"), x: at, y: at, z: level, w: size, d: size, color });
const tileShape = z.object({ kind: z.literal("tile"), x: at, y: at, z: level, w: size, d: size, color });
const slopeShape = z.object({
  kind: z.literal("slope"),
  x: at,
  y: at,
  z: level,
  w: size,
  d: size,
  h: z.number().int().min(1).max(36).default(B),
  color,
  dir: dir.describe("The side it falls towards: +y faces front-left, +x faces front-right"),
});
const opening = z.object({
  side: z.enum(["front", "right", "back", "left"]),
  at: z.number().int().min(0).max(23).describe("Offset along the side from its first stud"),
  width: z.number().int().min(1).max(24),
  from: z.number().int().min(0).max(11).default(0).describe("First course of the opening"),
  courses: z.number().int().min(1).max(12).default(1),
  fill: color.optional().describe("Fill it with this colour (glass for windows, brown for doors); omit to leave a gap"),
});
const wallShape = z.object({
  kind: z.literal("wall"),
  x: at,
  y: at,
  z: level,
  w: z.number().int().min(2).max(24),
  d: z.number().int().min(2).max(24),
  courses: z.number().int().min(1).max(12),
  color,
  openings: z.array(opening).max(16).default([]),
});
const towerShape = z.object({
  kind: z.literal("tower"),
  x: at,
  y: at,
  z: level,
  w: size,
  d: size,
  courses: z.number().int().min(1).max(24),
  colors: z.array(color).min(1).max(6).describe("Course colours, repeated as stripes"),
});
const roofShape = z.object({
  kind: z.literal("roof"),
  x: at,
  y: at,
  z: level,
  w: z.number().int().min(1).max(24),
  d: z.number().int().min(1).max(24),
  style: z.enum(["gable-x", "gable-y", "pyramid", "flat"]).describe("gable-x has its ridge along x; gable-y along y"),
  color,
  gable: color.optional().describe("Colour of the gable-end infill; defaults to the roof colour"),
});
const treeShape = z.object({
  kind: z.literal("tree"),
  x: at,
  y: at,
  z: level,
  height: z.number().int().min(1).max(4).default(2).describe("Trunk height in bricks"),
  leaves: color.default("brightGreen"),
});

export const shapeSchema = z.discriminatedUnion("kind", [
  brickShape,
  plateShape,
  tileShape,
  slopeShape,
  wallShape,
  towerShape,
  roofShape,
  treeShape,
]);
export type Shape = z.output<typeof shapeSchema>;

export const blueprintSchema = z.object({
  name: z.string().trim().min(1).max(40).describe("What the model is, e.g. Weather station"),
  plate: z.object({
    w: z.number().int().min(6).max(24),
    d: z.number().int().min(6).max(24),
    color: color.default("green"),
  }),
  parts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        shapes: z.array(shapeSchema).min(1).max(40),
      }),
    )
    .min(1)
    .max(16)
    .describe("Bottom-up, in the order the Master Builder attaches bags; ideally one part per bag"),
});
export type Blueprint = z.output<typeof blueprintSchema>;

export class BlueprintError extends Error {
  override name = "BlueprintError";
}

function hex(name: string): string {
  return PALETTE[name] ?? name;
}

function box(x: number, y: number, zz: number, w: number, d: number, h: number, colour: string, studs = true): DesignBrick {
  return { x, y, z: zz, w, d, h, color: hex(colour), studs };
}

function wedge(x: number, y: number, zz: number, w: number, d: number, h: number, colour: string, slope: SlopeDir): DesignBrick {
  return { x, y, z: zz, w, d, h, color: hex(colour), slope, studs: false };
}

/** Runs of equal colour along one wall side, as bricks. */
function wallRuns(
  cells: Array<string | null>,
  place: (start: number, length: number, colour: string) => DesignBrick,
): DesignBrick[] {
  const bricks: DesignBrick[] = [];
  let start = 0;
  while (start < cells.length) {
    const colour = cells[start];
    let end = start + 1;
    while (end < cells.length && cells[end] === colour) end += 1;
    if (colour !== null && colour !== undefined) bricks.push(place(start, end - start, colour));
    start = end;
  }
  return bricks;
}

function expandWall(shape: z.output<typeof wallShape>): DesignBrick[] {
  const { x, y, w, d } = shape;
  const sides = {
    front: { length: w, place: (s: number, n: number, c: string, zz: number) => box(x + s, y + d - 1, zz, n, 1, B, c) },
    back: { length: w, place: (s: number, n: number, c: string, zz: number) => box(x + s, y, zz, n, 1, B, c) },
    left: { length: Math.max(0, d - 2), place: (s: number, n: number, c: string, zz: number) => box(x, y + 1 + s, zz, 1, n, B, c) },
    right: { length: Math.max(0, d - 2), place: (s: number, n: number, c: string, zz: number) => box(x + w - 1, y + 1 + s, zz, 1, n, B, c) },
  } as const;
  const bricks: DesignBrick[] = [];
  for (let course = 0; course < shape.courses; course += 1) {
    const zz = shape.z + course * B;
    for (const [name, side] of Object.entries(sides) as Array<[keyof typeof sides, (typeof sides)[keyof typeof sides]]>) {
      const cells: Array<string | null> = Array.from({ length: side.length }, () => shape.color);
      for (const hole of shape.openings) {
        if (hole.side !== name || course < hole.from || course >= hole.from + hole.courses) continue;
        for (let i = hole.at; i < Math.min(side.length, hole.at + hole.width); i += 1) cells[i] = hole.fill ?? null;
      }
      bricks.push(...wallRuns(cells, (s, n, c) => side.place(s, n, c, zz)));
    }
  }
  return bricks;
}

function expandRoof(shape: z.output<typeof roofShape>): DesignBrick[] {
  const { x, y, w, d, color: c } = shape;
  const infill = shape.gable ?? c;
  const bricks: DesignBrick[] = [];
  if (shape.style === "flat") return [box(x, y, shape.z, w, d, 1, c)];
  if (shape.style === "pyramid") {
    for (let i = 0; ; i += 1) {
      const rx = x + i;
      const ry = y + i;
      const rw = w - 2 * i;
      const rd = d - 2 * i;
      const zz = shape.z + i * B;
      if (rw <= 0 || rd <= 0) break;
      if (rw === 1 || rd === 1) {
        bricks.push(box(rx, ry, zz, rw, rd, 2, c, false));
        break;
      }
      bricks.push(wedge(rx, ry, zz, rw, 1, B, c, "-y"), wedge(rx, ry + rd - 1, zz, rw, 1, B, c, "+y"));
      if (rd > 2) bricks.push(wedge(rx, ry + 1, zz, 1, rd - 2, B, c, "-x"), wedge(rx + rw - 1, ry + 1, zz, 1, rd - 2, B, c, "+x"));
      if (rw > 2 && rd > 2) bricks.push(box(rx + 1, ry + 1, zz, rw - 2, rd - 2, B, infill, false));
    }
    return bricks;
  }
  // Gables: rows of slopes step inward from both eaves until they meet.
  const alongX = shape.style === "gable-x";
  const span = alongX ? d : w;
  for (let i = 0; ; i += 1) {
    const lo = i;
    const hi = span - 1 - i;
    const zz = shape.z + i * B;
    if (lo > hi) break;
    if (lo === hi) {
      bricks.push(alongX ? box(x, y + lo, zz, w, 1, 2, c, false) : box(x + lo, y, zz, 1, d, 2, c, false));
      break;
    }
    if (alongX) {
      bricks.push(wedge(x, y + lo, zz, w, 1, B, c, "-y"), wedge(x, y + hi, zz, w, 1, B, c, "+y"));
      if (hi - lo > 1) bricks.push(box(x, y + lo + 1, zz, w, hi - lo - 1, B, infill, false));
    } else {
      bricks.push(wedge(x + lo, y, zz, 1, d, B, c, "-x"), wedge(x + hi, y, zz, 1, d, B, c, "+x"));
      if (hi - lo > 1) bricks.push(box(x + lo + 1, y, zz, hi - lo - 1, d, B, infill, false));
    }
  }
  return bricks;
}

export function expandShape(shape: Shape): DesignBrick[] {
  switch (shape.kind) {
    case "brick":
      return [box(shape.x, shape.y, shape.z, shape.w, shape.d, shape.h, shape.color, shape.studs)];
    case "plate":
      return [box(shape.x, shape.y, shape.z, shape.w, shape.d, 1, shape.color)];
    case "tile":
      return [box(shape.x, shape.y, shape.z, shape.w, shape.d, 1, shape.color, false)];
    case "slope":
      return [wedge(shape.x, shape.y, shape.z, shape.w, shape.d, shape.h, shape.color, shape.dir)];
    case "wall":
      return expandWall(shape);
    case "tower":
      return Array.from({ length: shape.courses }, (_, course) =>
        box(shape.x, shape.y, shape.z + course * B, shape.w, shape.d, B, shape.colors[course % shape.colors.length] ?? "white"),
      );
    case "roof":
      return expandRoof(shape);
    case "tree": {
      const top = shape.z + shape.height * B;
      return [
        box(shape.x, shape.y, shape.z, 1, 1, shape.height * B, "brown"),
        box(shape.x - 1, shape.y - 1, top, 3, 3, B, shape.leaves),
        box(shape.x, shape.y, top + B, 1, 1, B, shape.leaves),
      ];
    }
  }
}

/**
 * Expand a blueprint into a design. Bricks off the baseplate or colliding
 * with an earlier brick are dropped and reported in `notes`; a blueprint
 * that leaves nothing to build is an error.
 */
export function compileBlueprint(blueprint: Blueprint): { design: Design; notes: string[] } {
  const notes: string[] = [];
  const placed: DesignBrick[] = [];
  const sections: Design["sections"] = [];
  let total = 0;
  for (const part of blueprint.parts) {
    let outside = 0;
    let collided = 0;
    let overflow = 0;
    const bricks: DesignBrick[] = [];
    for (const brick of part.shapes.flatMap(expandShape)) {
      if (brick.x < 0 || brick.y < 0 || brick.x + brick.w > blueprint.plate.w || brick.y + brick.d > blueprint.plate.d || brick.z + brick.h > MAX_HEIGHT) {
        outside += 1;
        continue;
      }
      if (placed.some((other) => overlaps(other, brick))) {
        collided += 1;
        continue;
      }
      if (total >= MAX_BRICKS) {
        overflow += 1;
        continue;
      }
      placed.push(brick);
      bricks.push(brick);
      total += 1;
    }
    if (outside > 0) notes.push(`${part.name}: dropped ${outside} brick${outside === 1 ? "" : "s"} off the ${blueprint.plate.w}×${blueprint.plate.d} baseplate.`);
    if (collided > 0) notes.push(`${part.name}: dropped ${collided} brick${collided === 1 ? "" : "s"} that collided with earlier bricks.`);
    if (overflow > 0) notes.push(`${part.name}: dropped ${overflow} brick${overflow === 1 ? "" : "s"} over the ${MAX_BRICKS}-brick limit.`);
    if (bricks.length === 0) {
      notes.push(`${part.name}: nothing left to build, so the part was removed.`);
      continue;
    }
    sections.push({ name: part.name, bricks });
  }
  if (sections.length === 0) {
    throw new BlueprintError("The blueprint has no bricks left after placing it on the baseplate. Check coordinates against the plate size.");
  }
  const floating = placed.filter(
    (brick) =>
      brick.z > 0 &&
      !placed.some(
        (below) =>
          below !== brick &&
          below.z + below.h === brick.z &&
          below.x < brick.x + brick.w &&
          brick.x < below.x + below.w &&
          below.y < brick.y + brick.d &&
          brick.y < below.y + below.d,
      ),
  ).length;
  if (floating > 0) notes.push(`${floating} brick${floating === 1 ? " floats" : "s float"} with nothing underneath (allowed, but check the z values).`);
  return {
    design: {
      id: "custom",
      name: blueprint.name,
      plate: { w: blueprint.plate.w, d: blueprint.plate.d, color: hex(blueprint.plate.color) },
      sections,
    },
    notes,
  };
}
