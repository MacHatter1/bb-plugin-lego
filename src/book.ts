// The instruction book: what the planning agent writes (BookSpec) and the
// live build state the server keeps (BookState). app.tsx imports these
// types only; the zod schemas run on the server boundary.
import { z } from "zod";
import { blueprintSchema } from "./blueprint";
import { MODEL_HINTS, MODEL_IDS, type Design, type ModelId } from "./designs";

export const BRICK_COLORS = [
  "red",
  "blue",
  "yellow",
  "green",
  "orange",
  "azure",
  "lime",
  "purple",
  "pink",
  "tan",
  "teal",
  "magenta",
] as const;
export type BrickColor = (typeof BRICK_COLORS)[number];

export const MAX_BAGS = 12;
export const MAX_STEPS = 12;
export const MAX_BUILDERS = 8;

const stepSpec = z.object({
  title: z.string().trim().min(1).max(140),
  detail: z.string().trim().max(2000).optional(),
});

const bagSpec = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/u, "Bag ids are lowercase slugs like api-routes")
    .optional(),
  name: z.string().trim().min(1).max(60),
  goal: z.string().trim().min(1).max(2000),
  files: z.array(z.string().trim().min(1).max(300)).max(60).default([]),
  dependsOn: z.array(z.string().trim().min(1)).max(MAX_BAGS).default([]),
  steps: z.array(stepSpec).min(1).max(MAX_STEPS),
});

const assemblyStepSpec = stepSpec.extend({
  attaches: z.array(z.string().trim().min(1)).max(MAX_BAGS).default([]),
});

export const bookSpecSchema = z.object({
  title: z.string().trim().min(1).max(80),
  model: z
    .enum(MODEL_IDS)
    .optional()
    .describe(
      `A ready-made model, used only when you do not send a blueprint: ${MODEL_IDS.map((id) => `${id} (${MODEL_HINTS[id]})`).join("; ")}.`,
    ),
  blueprint: blueprintSchema
    .optional()
    .describe(
      "The picture on the box, designed for this task: a Lego model that depicts what is being built, assembled from parts that map to the bags. See the lego skill for the shapes and an example.",
    ),
  task: z.string().trim().min(1).max(8000),
  studs: z.string().trim().max(8000).optional(),
  bags: z.array(bagSpec).min(1).max(MAX_BAGS),
  assembly: z.object({
    steps: z.array(assemblyStepSpec).min(1).max(MAX_STEPS),
    verification: z.string().trim().max(4000).optional(),
  }),
});
export type BookSpec = z.input<typeof bookSpecSchema>;
export type ParsedBookSpec = z.output<typeof bookSpecSchema>;

export const agentChoiceSchema = z.object({
  providerId: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  reasoningLevel: z.string().trim().min(1).max(40),
  serviceTier: z.string().trim().min(1).max(40).optional(),
});
export type AgentChoice = z.infer<typeof agentChoiceSchema>;

export const buildSetupSchema = z.object({
  builders: z.array(agentChoiceSchema).min(1).max(MAX_BUILDERS),
  sameForAll: z.boolean(),
  master: agentChoiceSchema,
});
export type BuildSetup = z.infer<typeof buildSetupSchema>;

export type PermissionMode = "accept-edits" | "auto" | "full";

export type BookStatus =
  | "draft"
  | "configuring"
  | "building"
  | "assembling"
  | "complete"
  | "failed"
  | "cancelled";

export type BagStatus =
  | "waiting"
  | "building"
  | "built"
  | "attached"
  | "failed";

export interface StepState {
  title: string;
  detail: string | null;
  done: boolean;
  note: string | null;
}

export interface BagState {
  id: string;
  number: number;
  name: string;
  goal: string;
  files: string[];
  dependsOn: string[];
  color: BrickColor;
  steps: StepState[];
  status: BagStatus;
  builder: number | null;
  summary: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export type BuilderStatus = "idle" | "working" | "failed";

export interface BuilderState {
  index: number;
  name: string;
  choice: AgentChoice;
  threadId: string | null;
  bagId: string | null;
  bagsBuilt: string[];
  status: BuilderStatus;
  dispatchedAt: number | null;
  /** The bag this builder was asked to report on after stopping short; one nudge per bag. */
  nudgedBag?: string | null;
}

export type MasterStatus = "waiting" | "working" | "done" | "failed";

export interface AssemblyStepState extends StepState {
  attaches: string[];
}

export interface MasterState {
  choice: AgentChoice | null;
  threadId: string | null;
  status: MasterStatus;
  steps: AssemblyStepState[];
  summary: string | null;
  error: string | null;
  dispatchedAt: number | null;
  /** Whether the Master Builder was asked to report after stopping short. */
  nudged?: boolean;
}

export interface BookEvent {
  at: number;
  kind: "info" | "brick" | "bag" | "attach" | "done" | "error";
  text: string;
}

export interface BookState {
  id: string;
  setNumber: number;
  threadId: string;
  projectId: string;
  environmentId: string | null;
  title: string;
  /** A built-in model on the box; older books have none and get one from their id. */
  model?: ModelId | null;
  /** The model compiled from the planning agent's blueprint, when it sent one. */
  design?: Design | null;
  /** What compiling the blueprint had to fix, for the planning agent. */
  designNotes?: string[];
  task: string;
  studs: string | null;
  verification: string | null;
  status: BookStatus;
  permissionMode: PermissionMode | null;
  bags: BagState[];
  builders: BuilderState[];
  master: MasterState;
  events: BookEvent[];
  error: string | null;
  notified: boolean;
  /** A `bb lego demo` book driven by simulated workers. */
  demo?: boolean;
  /** How a demo book is staffed when someone presses Play. */
  demoSetup?: { builders: number; choice: AgentChoice };
  createdAt: number;
  updatedAt: number;
}

/** Payload of the "build-setup" pending interaction (server → form). */
export interface SetupPayload {
  bookId: string;
  title: string;
  setNumber: number;
  bagCount: number;
  pieceCount: number;
  parallelWidth: number;
  recommendedBuilders: number;
  maxBuilders: number;
  environmentId: string | null;
  defaults: {
    builder: AgentChoice | null;
    master: AgentChoice | null;
  };
  note: string | null;
}

export const EVENT_LIMIT = 40;

/** Total bricks (bag steps) and assembly steps, the set's "piece count". */
export function pieceCount(book: Pick<BookState, "bags" | "master">): number {
  return (
    book.bags.reduce((total, bag) => total + bag.steps.length, 0) +
    book.master.steps.length
  );
}

export function bricksPlaced(book: Pick<BookState, "bags" | "master">): number {
  return (
    book.bags.reduce(
      (total, bag) => total + bag.steps.filter((step) => step.done).length,
      0,
    ) + book.master.steps.filter((step) => step.done).length
  );
}

/**
 * Bags grouped into dependency layers; the widest layer is how many builders
 * can usefully work at once.
 */
export function dependencyLayers(
  bags: ReadonlyArray<Pick<BagState, "id" | "dependsOn">>,
): string[][] {
  const depth = new Map<string, number>();
  const byId = new Map(bags.map((bag) => [bag.id, bag]));
  const visit = (id: string, trail: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0;
    trail.add(id);
    const bag = byId.get(id);
    const value =
      bag === undefined || bag.dependsOn.length === 0
        ? 0
        : 1 + Math.max(...bag.dependsOn.map((dep) => visit(dep, trail)));
    trail.delete(id);
    depth.set(id, value);
    return value;
  };
  const layers: string[][] = [];
  for (const bag of bags) {
    const level = visit(bag.id, new Set());
    (layers[level] ??= []).push(bag.id);
  }
  return layers.filter((layer) => layer !== undefined);
}

export function parallelWidth(
  bags: ReadonlyArray<Pick<BagState, "id" | "dependsOn">>,
): number {
  return Math.max(1, ...dependencyLayers(bags).map((layer) => layer.length));
}
