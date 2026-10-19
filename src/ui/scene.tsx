// The isometric scenes: the main model on its baseplate and each bag's part
// on the table. Free of host APIs so they can also render outside bb.
import { useMemo, type CSSProperties } from "react";
import type { BagState, BookState } from "../book";
import { attachOrder, layoutModel, type DesignBrick, type ModelLayout } from "../designs";
import {
  BRICK_HEX,
  BUILDER_SHIRTS,
  Brick,
  HAND_OFFSET,
  Minifig,
  PartsBag,
  PLATE_HEIGHT,
  PLATE_PX,
  STUD,
  iso,
  viewBoxFor,
  type Box,
  type BrickVariant,
} from "./iso";
import type { Motion } from "./motion";


/** The book's model layout; stable for the whole build. */
export function useLayout(book: BookState): ModelLayout {
  const signature = [
    book.id,
    book.model ?? "",
    book.bags.map((bag) => `${bag.id}:${bag.steps.length}`).join(","),
    book.master.steps.map((step) => step.attaches.join("+")).join("|"),
  ].join("/");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => layoutModel(book), [signature]);
}

function brickBox(brick: DesignBrick, baseZ: number): Box {
  return { x: brick.x, y: brick.y, z: baseZ + brick.z * PLATE_PX, w: brick.w, d: brick.d, h: brick.h * PLATE_PX };
}

/** Studs hidden under another solid brick are not drawn. */
function studMasker(solid: DesignBrick[]) {
  const covered = new Set<string>();
  for (const brick of solid) {
    for (let i = 0; i < brick.w; i += 1) for (let j = 0; j < brick.d; j += 1) covered.add(`${brick.x + i},${brick.y + j},${brick.z}`);
  }
  return (brick: DesignBrick) => (i: number, j: number) => !covered.has(`${brick.x + i},${brick.y + j},${brick.z + brick.h}`);
}

const FIGURE_HEIGHT = 48;

function figureBox(x: number, y: number, z: number): Box {
  return { x: x - 0.6, y: y - 0.6, z, w: 1.2, d: 1.2, h: FIGURE_HEIGHT };
}

/**
 * Style for a brick flying from a figure's hands to its place: the offset
 * from the brick's resting spot back to the hands, for the carry keyframes.
 */
function flightFrom(hands: [number, number], anchor: [number, number], delayMs = 0): CSSProperties {
  return {
    "--fx": `${(hands[0] - anchor[0]).toFixed(1)}px`,
    "--fy": `${(hands[1] - anchor[1]).toFixed(1)}px`,
    ...(delayMs > 0 ? { animationDelay: `${delayMs}ms` } : {}),
  } as CSSProperties;
}

function handsAt(feet: [number, number]): [number, number] {
  return [feet[0] + HAND_OFFSET[0], feet[1] + HAND_OFFSET[1]];
}

/** Where the Master Builder stands to attach a bag: the front edge, in line with it. */
function standingSpot(layout: ModelLayout, bagId: string | null): number {
  const plate = layout.design.plate;
  const bounds = bagId === null ? undefined : layout.byBag.get(bagId)?.bounds;
  return bounds ? Math.min(plate.w - 1, Math.max(1, (bounds.x1 + bounds.x2) / 2)) : plate.w / 2;
}

/** Where the crew stands on the baseplate, and what they are doing. */
function modelFigures(book: BookState, layout: ModelLayout) {
  const plate = layout.design.plate;
  const front = plate.d - 0.7;
  const master = { shirt: "#F57D20", master: true as const };
  if (book.status === "complete") {
    const crew = [
      ...book.builders.map((builder) => ({ shirt: BUILDER_SHIRTS[(builder.index - 1) % BUILDER_SHIRTS.length] ?? "#C91A09", master: false, key: `b${builder.index}` })),
      { ...master, key: "master" },
    ];
    // The Master Builder takes the middle of the line-up.
    const middle = Math.floor(crew.length / 2);
    const ordered = [...crew.slice(0, -1).slice(0, middle), crew[crew.length - 1]!, ...crew.slice(0, -1).slice(middle)];
    return ordered.map((figure, index) => ({
      ...figure,
      x: 1 + ((plate.w - 2) * (index + 0.5)) / ordered.length,
      y: front,
      pose: "cheer" as const,
      holding: null,
      delay: index * 90,
    }));
  }
  if (book.status === "assembling") {
    const order = attachOrder(book.bags, book.master);
    const target = order.map((id) => book.bags.find((bag) => bag.id === id)).find((bag) => bag !== undefined && bag.status !== "attached");
    const x = standingSpot(layout, target?.id ?? null);
    return [{ ...master, key: "master", x, y: front, pose: "work" as const, holding: target ? BRICK_HEX[target.color] : null, delay: 0 }];
  }
  return [{ ...master, key: "master", x: plate.w - 1.4, y: front, pose: "idle" as const, holding: null, delay: 0 }];
}

/** Motion for scenes that never animate, such as models on the shelf. */
export const STILL: Motion = { isFresh: () => false, brick: () => ({ className: "" }) };

export function ModelScene({
  book,
  motion,
  className = "lego-scene-model",
  display = false,
}: {
  book: BookState;
  motion: Motion;
  className?: string;
  /** A finished model on show: no crew, no animation, a plain display base. */
  display?: boolean;
}) {
  const layout = useLayout(book);
  const { design } = layout;
  const plate: Box = { x: 0, y: 0, z: 0, w: design.plate.w, d: design.plate.d, h: PLATE_HEIGHT };
  const bags = new Map(book.bags.map((bag) => [bag.id, bag]));
  const isAttached = (bagId: string) => bags.get(bagId)?.status === "attached";
  const solid = layout.bricks.filter((placed) => isAttached(placed.bagId));
  const mask = studMasker(solid.map((placed) => placed.brick));
  const plateCovered = new Set<string>();
  for (const { brick } of solid) {
    if (brick.z !== 0) continue;
    for (let i = 0; i < brick.w; i += 1) for (let j = 0; j < brick.d; j += 1) plateCovered.add(`${brick.x + i},${brick.y + j}`);
  }
  const complete = book.status === "complete";
  const figures = display ? [] : modelFigures(book, layout);
  const attachedCount = book.bags.filter((bag) => bag.status === "attached").length;
  const view = viewBoxFor(
    [
      plate,
      ...layout.bricks.map((placed) => brickBox(placed.brick, PLATE_HEIGHT)),
      ...figures.map((figure) => figureBox(figure.x, figure.y, PLATE_HEIGHT)),
    ],
    8,
    34,
  );
  // The flag goes on the highest point of the finished model.
  const peak = layout.bricks.reduce<DesignBrick | null>(
    (best, placed) => (best === null || placed.brick.z + placed.brick.h > best.z + best.h ? placed.brick : best),
    null,
  );
  let order = 0;
  return (
    <svg viewBox={view.viewBox} className={`lego-scene ${className}`} role="img" aria-label={`${design.name}: ${attachedCount} of ${book.bags.length} bags attached`}>
      <Brick
        box={plate}
        color={design.plate.color}
        variant="solid"
        studs={!display}
        studMask={(i, j) => !plateCovered.has(`${i},${j}`)}
        className={complete && !display ? "lego-plate-done" : undefined}
      />
      {book.bags.map((bag) => {
        const bounds = layout.byBag.get(bag.id)?.bounds;
        if (display || !bounds || bag.status !== "attached" || !motion.isFresh(`${bag.id}:attached`)) return null;
        const [cx, cy] = iso((bounds.x1 + bounds.x2) / 2, (bounds.y1 + bounds.y2) / 2, PLATE_HEIGHT + bounds.z1 * PLATE_PX);
        const rx = ((bounds.x2 - bounds.x1 + bounds.y2 - bounds.y1) / 2) * STUD * 0.8;
        return <ellipse key={`impact-${bag.id}`} className="lego-impact" cx={cx} cy={cy} rx={rx} ry={rx * 0.577} />;
      })}
      {layout.bricks.map((placed) => {
        const bag = bags.get(placed.bagId);
        const box = brickBox(placed.brick, PLATE_HEIGHT);
        if (!bag || bag.status !== "attached") {
          return (
            <g key={`${placed.index}-ghost`} className={`lego-ghost-slot${bag?.status === "built" && book.status === "assembling" ? " lego-next" : ""}`}>
              <Brick box={box} color={placed.brick.color} variant="ghost" slope={placed.brick.slope} />
            </g>
          );
        }
        // A freshly attached bag is carried in from the Master Builder's hands
        // as one piece; whatever was already on the model builds up instead.
        let move: { className: string; style?: CSSProperties };
        if (motion.isFresh(`${bag.id}:attached`)) {
          const bounds = layout.byBag.get(bag.id)!.bounds;
          const hands = handsAt(iso(standingSpot(layout, bag.id), design.plate.d - 0.7, PLATE_HEIGHT));
          const anchor = iso((bounds.x1 + bounds.x2) / 2, (bounds.y1 + bounds.y2) / 2, PLATE_HEIGHT + bounds.z1 * PLATE_PX);
          move = { className: "lego-carry lego-carry-bag", style: flightFrom(hands, anchor) };
        } else {
          move = motion.brick(`${bag.id}:${placed.step}`, order++);
        }
        return (
          <Brick
            key={`${placed.index}-solid`}
            box={box}
            color={placed.brick.color}
            variant="solid"
            slope={placed.brick.slope}
            studs={placed.brick.studs}
            studMask={mask(placed.brick)}
            lite={display}
            className={display ? undefined : move.className}
            style={display ? undefined : move.style}
            title={display ? undefined : `Bag ${bag.number} · ${bag.name}`}
          />
        );
      })}
      {complete && peak !== null ? (
        <Flag
          at={iso(peak.x + peak.w / 2, peak.y + peak.d / 2, PLATE_HEIGHT + (peak.z + peak.h) * PLATE_PX)}
          raise={!display && motion.isFresh("status:complete")}
        />
      ) : null}
      {figures.map((figure) => (
        <Minifig
          key={figure.key}
          at={iso(figure.x, figure.y, PLATE_HEIGHT)}
          pose={figure.pose}
          shirt={figure.shirt}
          master={figure.master}
          holding={figure.holding}
          beat={figure.master ? attachedCount : undefined}
          stride={figure.master ? Math.round(figure.x * 10) : undefined}
          style={figure.delay ? ({ "--lego-fig-delay": `${figure.delay}ms` } as CSSProperties) : undefined}
          title={figure.master ? "Master Builder" : undefined}
        />
      ))}
    </svg>
  );
}

/** The finished-model flag: raised up its pole when the build completes, then waving. */
function Flag({ at, raise }: { at: [number, number]; raise: boolean }) {
  const [x, y] = at;
  return (
    <g className={`lego-flag${raise ? " lego-flag-raise" : ""}`}>
      <line className="lego-flag-pole" x1={x} y1={y} x2={x} y2={y - 30} stroke="#5b5b5b" strokeWidth={1.6} strokeLinecap="round" />
      <g className="lego-flag-hoist">
        <path className="lego-flag-cloth" d={`M${x} ${y - 30} L${x + 16} ${y - 25} L${x} ${y - 20} Z`} fill="#D01012" stroke="#8f0b0c" strokeWidth={0.6} />
        <circle cx={x} cy={y - 31} r={1.6} fill="#F5C518" />
      </g>
    </g>
  );
}

/** One bag's part of the model, built on the table beside its builder. */
export function BagScene({ bag, book, layout, motion }: { bag: BagState; book: BookState; layout: ModelLayout; motion: Motion }) {
  const part = layout.byBag.get(bag.id);
  if (!part) return <svg className="lego-scene lego-scene-bag" aria-hidden="true" />;
  const { bounds } = part;
  const local = part.bricks.map((placed) => ({
    ...placed,
    brick: { ...placed.brick, x: placed.brick.x - bounds.x1, y: placed.brick.y - bounds.y1, z: placed.brick.z - bounds.z1 },
  }));
  const attached = bag.status === "attached";
  const nextStep = bag.status === "building" ? bag.steps.findIndex((step) => !step.done) : -1;
  const working = bag.status === "building";
  // With a builder holding it, the next brick's spot glows; without one it hovers.
  const variantOf = (step: number): BrickVariant =>
    attached ? "faded" : bag.steps[step]?.done ? "solid" : step === nextStep && !working ? "next" : "ghost";
  const mask = studMasker(local.filter((placed) => variantOf(placed.step) !== "ghost").map((placed) => placed.brick));
  const width = bounds.x2 - bounds.x1;
  const depth = bounds.y2 - bounds.y1;
  const figureAt = { x: width + 1.1, y: depth * 0.55 };
  const feet = iso(figureAt.x, figureAt.y, 0);
  const hands = handsAt(feet);
  const builder = bag.builder === null ? null : book.builders[bag.builder - 1] ?? null;
  const shirt = BUILDER_SHIRTS[((builder?.index ?? 1) - 1) % BUILDER_SHIRTS.length] ?? "#C91A09";
  const done = bag.steps.filter((step) => step.done).length;
  const nextColor = local.find((placed) => placed.step === nextStep)?.brick.color ?? BRICK_HEX[bag.color];
  const cheering = bag.status === "built" && motion.isFresh(`${bag.id}:built`);
  const view = viewBoxFor(
    [
      ...local.map((placed) => brickBox(placed.brick, 0)),
      figureBox(figureAt.x, figureAt.y, 0),
      figureBox(figureAt.x + 0.9, figureAt.y - 0.9, 0),
    ],
    5,
  );
  const stepPosition = new Map<number, number>();
  return (
    <svg viewBox={view.viewBox} className="lego-scene lego-scene-bag" role="img" aria-label={`Bag ${bag.number}: ${done} of ${bag.steps.length} steps`}>
      {local.map((placed, position) => {
        const variant = variantOf(placed.step);
        let move: { className: string; style?: CSSProperties } | null = null;
        if (variant === "solid") {
          if (motion.isFresh(`${bag.id}:${placed.step}`)) {
            // Thrown from the builder's hands; several bricks in one step go one after another.
            const nth = stepPosition.get(placed.step) ?? 0;
            stepPosition.set(placed.step, nth + 1);
            const { brick } = placed;
            const anchor = iso(brick.x + brick.w / 2, brick.y + brick.d / 2, brick.z * PLATE_PX);
            move = { className: "lego-carry", style: flightFrom(hands, anchor, nth * 120) };
          } else {
            move = motion.brick(`${bag.id}:${placed.step}`, position);
          }
        } else if (working && placed.step === nextStep) {
          move = { className: "lego-target" };
        }
        return (
          <Brick
            key={`${placed.index}-${variant}`}
            box={brickBox(placed.brick, 0)}
            color={placed.brick.color}
            variant={variant}
            slope={placed.brick.slope}
            studs={placed.brick.studs}
            studMask={mask(placed.brick)}
            className={move?.className}
            style={move?.style}
            title={`Bag ${bag.number} · step ${placed.step + 1}: ${bag.steps[placed.step]?.title ?? ""}`}
          />
        );
      })}
      {working ? <PartsBag at={iso(figureAt.x + 0.9, figureAt.y - 0.9, 0)} number={bag.number} /> : null}
      {working ? (
        <Minifig
          at={feet}
          pose="work"
          shirt={shirt}
          holding={nextColor}
          beat={done}
          title={builder ? `${builder.name} at work` : undefined}
        />
      ) : cheering ? (
        <Minifig at={feet} pose="cheer" shirt={shirt} className="lego-fig-leave" />
      ) : null}
    </svg>
  );
}
