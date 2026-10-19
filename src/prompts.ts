// Prompts for builder and Master Builder threads. Plan text came from the
// planning agent, so it is presented as quoted data inside fixed framing.
import type { BagState, BookState } from "./book";

function bagLine(bag: BagState): string {
  const files = bag.files.length > 0 ? ` — owns: ${bag.files.join(", ")}` : "";
  return `- Bag ${bag.number} "${bag.name}" (${bag.id})${files}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function builderPrompt(book: BookState, bag: BagState, builderName: string): string {
  const others = book.bags.filter((other) => other.id !== bag.id);
  const steps = bag.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.title}${step.detail === null ? "" : `\n   ${step.detail.replace(/\n/gu, "\n   ")}`}`,
    )
    .join("\n");
  const deps = bag.dependsOn
    .map((id) => book.bags.find((other) => other.id === id))
    .filter((other): other is BagState => other !== undefined);
  const depNotes = deps
    .map(
      (dep) =>
        `- Bag ${dep.number} "${dep.name}" is already built. Its builder reported:\n${quote(dep.summary ?? "(no report)")}`,
    )
    .join("\n");
  return [
    `You are ${builderName}, one of several builder agents working in parallel on a Lego-style build (Set ${book.setNumber}: "${book.title}").`,
    `Your job is to build ONE sub-assembly ("bag") exactly as the instruction book describes. A Master Builder will attach every bag to the main model after all builders finish, so build your bag to fit the shared connection points ("studs") rather than wiring it into other bags yourself.`,
    "",
    "## The overall task",
    quote(book.task),
    "",
    book.studs === null
      ? ""
      : `## Studs: shared connection points every bag must honour\n${quote(book.studs)}\n`,
    "## Other bags being built at the same time (do not edit their files)",
    others.length === 0 ? "- (none)" : others.map(bagLine).join("\n"),
    "",
    deps.length === 0 ? "" : `## Bags you build on\n${depNotes}\n`,
    `## Your bag: Bag ${bag.number} "${bag.name}"`,
    `Goal:\n${quote(bag.goal)}`,
    bag.files.length > 0
      ? `Files you own (create or edit only these unless a step clearly requires a new file of your own):\n${bag.files.map((file) => `- ${file}`).join("\n")}`
      : "",
    "",
    "Steps:",
    steps,
    "",
    "## How to report progress",
    `- After you finish each step, call the \`lego_step_done\` tool with that step's number. Each call snaps a brick onto your bag in the user's live view.`,
    `- When the whole bag is built, call \`lego_bag_complete\` with a short report for the Master Builder: what you built, files you changed, the exact names/interfaces other bags or the Master Builder need, and anything left undone.`,
    `- If those tools are unavailable, run \`bb lego step <number>\` and \`bb lego bag-done --summary "<report>"\` in the shell instead.`,
    "",
    "## Rules",
    "- Stay inside your bag. Another builder is editing the other bags' files right now.",
    "- Do not commit, push, or open pull requests; the Master Builder integrates everything.",
    "- Do not wait for or message other builders. If something you need from another bag is missing, code against the studs and say so in your report.",
    "- Finish your turn after calling lego_bag_complete.",
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}

export function nextBagPrompt(book: BookState, bag: BagState, builderName: string): string {
  return [
    `Nice work. Here is your next bag for Set ${book.setNumber}. Your earlier bag is done; do not edit it further.`,
    "",
    builderPrompt(book, bag, builderName),
  ].join("\n");
}

export function masterPrompt(book: BookState): string {
  const bags = book.bags
    .map((bag) =>
      [
        `### Bag ${bag.number} "${bag.name}" (${bag.id})`,
        `Goal:\n${quote(bag.goal)}`,
        bag.files.length > 0 ? `Files: ${bag.files.join(", ")}` : "",
        `Builder report:\n${quote(bag.summary ?? "(the builder sent no report; inspect the files)")}`,
      ]
        .filter((line) => line !== "")
        .join("\n"),
    )
    .join("\n\n");
  const steps = book.master.steps
    .map((step, index) => {
      const attaches = step.attaches
        .map((id) => book.bags.find((bag) => bag.id === id))
        .filter((bag): bag is BagState => bag !== undefined)
        .map((bag) => `Bag ${bag.number} "${bag.name}"`);
      return `${index + 1}. ${step.title}${attaches.length > 0 ? ` [attaches ${attaches.join(", ")}]` : ""}${step.detail === null ? "" : `\n   ${step.detail.replace(/\n/gu, "\n   ")}`}`;
    })
    .join("\n");
  return [
    `You are the Master Builder for a Lego-style build (Set ${book.setNumber}: "${book.title}").`,
    `Builder agents have each built one sub-assembly ("bag") in this workspace in parallel. Your job is to attach every bag to the main model: integrate the pieces, resolve any mismatches at the seams, and make the whole thing work end to end.`,
    "",
    "## The overall task",
    quote(book.task),
    "",
    book.studs === null ? "" : `## Studs: the shared connection points\n${quote(book.studs)}\n`,
    "## The bags, as built",
    bags,
    "",
    "## Assembly steps",
    steps,
    "",
    book.verification === null ? "" : `## How to verify the finished model\n${quote(book.verification)}\n`,
    "## How to report progress",
    "- After each assembly step, call `lego_assembly_step` with the step number. Bags listed on that step snap onto the main model in the user's live view.",
    "- When the model is complete and verified, call `lego_build_complete` with a summary: what was assembled, what you fixed at the seams, verification results, and anything still open.",
    '- If those tools are unavailable, run `bb lego assembled <number>` and `bb lego complete --summary "<summary>"` in the shell instead.',
    "",
    "## Rules",
    "- Read each bag's files before changing them; prefer small fixes at the seams over rewrites.",
    "- Run the project's checks (build, typecheck, tests) that apply.",
    "- Do not commit or push unless the task explicitly asked for it.",
    "- Finish your turn after calling lego_build_complete.",
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}

export function completionNotice(book: BookState): string {
  return [
    `[Lego] Set ${book.setNumber} "${book.title}" is complete. The Master Builder attached all ${book.bags.length} bags.`,
    "",
    "Master Builder summary:",
    quote(book.master.summary ?? "(no summary)"),
    "",
    "Tell the user the build is finished: summarise what was built and anything the Master Builder left open. The banner above the composer already shows the finished model; do not paste a ::lego directive.",
  ].join("\n");
}

export function failureNotice(book: BookState, what: string): string {
  return [
    `[Lego] Set ${book.setNumber} "${book.title}" hit a problem: ${what}`,
    "",
    `The other builders keep going. Tell the user what failed. To try that bag again, call \`lego_retry\` with bookId "${book.id}" (and the bagId), or \`lego_cancel_build\` to stop the whole build.`,
  ].join("\n");
}
