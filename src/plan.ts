// Turns a validated BookSpec into a fresh BookState, rejecting plans that
// cannot be built: duplicate bag ids, unknown or cyclic dependencies, and
// assembly steps that attach bags that do not exist.
import {
  BRICK_COLORS,
  type BagState,
  type BookState,
  type ParsedBookSpec,
} from "./book";
import { BlueprintError, compileBlueprint } from "./blueprint";
import { pickModel } from "./designs";

export class PlanError extends Error {
  override name = "PlanError";
}

function slug(name: string, number: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 24);
  return base === "" ? `bag-${number}` : base;
}

function findCycle(bags: ReadonlyArray<BagState>): string[] | null {
  const byId = new Map(bags.map((bag) => [bag.id, bag]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") {
      return [...stack.slice(stack.indexOf(id)), id];
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const cycle = visit(dep);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const bag of bags) {
    const cycle = visit(bag.id);
    if (cycle !== null) return cycle;
  }
  return null;
}

/** Stable, friendly set number derived from the book id. */
export function setNumberFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 10000 + (hash % 89999);
}

/** The agent's blueprint compiled, else a built-in model chosen or matched from the task. */
function modelOnTheBox(spec: ParsedBookSpec): Pick<BookState, "model" | "design" | "designNotes"> {
  if (spec.blueprint !== undefined) {
    try {
      const { design, notes } = compileBlueprint(spec.blueprint);
      return { model: null, design, designNotes: notes };
    } catch (error) {
      if (error instanceof BlueprintError) throw new PlanError(error.message);
      throw error;
    }
  }
  return { model: spec.model ?? pickModel(`${spec.title} ${spec.task}`), design: null, designNotes: [] };
}

export function bookFromSpec(
  spec: ParsedBookSpec,
  context: {
    id: string;
    threadId: string;
    projectId: string;
    environmentId: string | null;
    now: number;
  },
): BookState {
  const used = new Set<string>();
  const bags: BagState[] = spec.bags.map((bag, index) => {
    const number = index + 1;
    let id = bag.id ?? slug(bag.name, number);
    if (bag.id !== undefined && used.has(id)) {
      throw new PlanError(`Two bags share the id "${id}". Bag ids must be unique.`);
    }
    if (used.has(id)) id = `${id}-${number}`;
    used.add(id);
    return {
      id,
      number,
      name: bag.name,
      goal: bag.goal,
      files: bag.files,
      dependsOn: [...new Set(bag.dependsOn)],
      color: BRICK_COLORS[index % BRICK_COLORS.length],
      steps: bag.steps.map((step) => ({
        title: step.title,
        detail: step.detail ?? null,
        done: false,
        note: null,
      })),
      status: "waiting",
      builder: null,
      summary: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
  });

  // Resolve dependency references by id first, then by bag name or number,
  // because planners often refer to bags the way they named them.
  const resolve = (reference: string): string | undefined => {
    const exact = bags.find((bag) => bag.id === reference);
    if (exact !== undefined) return exact.id;
    const lowered = reference.toLowerCase();
    const named = bags.find(
      (bag) =>
        bag.name.toLowerCase() === lowered ||
        String(bag.number) === reference ||
        `bag-${bag.number}` === lowered ||
        `bag ${bag.number}` === lowered,
    );
    return named?.id;
  };
  for (const bag of bags) {
    bag.dependsOn = bag.dependsOn.map((reference) => {
      const id = resolve(reference);
      if (id === undefined) {
        throw new PlanError(
          `Bag "${bag.name}" depends on "${reference}", which is not a bag in this book.`,
        );
      }
      if (id === bag.id) {
        throw new PlanError(`Bag "${bag.name}" cannot depend on itself.`);
      }
      return id;
    });
  }
  const cycle = findCycle(bags);
  if (cycle !== null) {
    throw new PlanError(
      `Bags depend on each other in a loop: ${cycle.join(" → ")}. Break the loop so every bag can start.`,
    );
  }

  const attached = new Set<string>();
  const steps = spec.assembly.steps.map((step) => {
    const attaches = [...new Set(step.attaches)].map((reference) => {
      const id = resolve(reference);
      if (id === undefined) {
        throw new PlanError(
          `Assembly step "${step.title}" attaches "${reference}", which is not a bag in this book.`,
        );
      }
      attached.add(id);
      return id;
    });
    return {
      title: step.title,
      detail: step.detail ?? null,
      done: false,
      note: null,
      attaches,
    };
  });
  // Every bag must end up on the model: attach leftovers in the final step.
  const leftovers = bags.filter((bag) => !attached.has(bag.id)).map((bag) => bag.id);
  if (leftovers.length > 0) {
    const last = steps[steps.length - 1];
    if (last !== undefined) last.attaches = [...last.attaches, ...leftovers];
  }

  return {
    id: context.id,
    setNumber: setNumberFor(context.id),
    threadId: context.threadId,
    projectId: context.projectId,
    environmentId: context.environmentId,
    title: spec.title,
    ...modelOnTheBox(spec),
    task: spec.task,
    studs: spec.studs ?? null,
    verification: spec.assembly.verification ?? null,
    status: "draft",
    permissionMode: null,
    bags,
    builders: [],
    master: {
      choice: null,
      threadId: null,
      status: "waiting",
      steps,
      summary: null,
      error: null,
      dispatchedAt: null,
    },
    events: [
      {
        at: context.now,
        kind: "info",
        text: `Instruction book printed: ${bags.length} bag${bags.length === 1 ? "" : "s"}, ${steps.length} assembly step${steps.length === 1 ? "" : "s"}.`,
      },
    ],
    error: null,
    notified: false,
    createdAt: context.now,
    updatedAt: context.now,
  };
}
