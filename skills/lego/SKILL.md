---
name: lego
description: Plan a coding task as a Lego instruction book, then build it with parallel builder agents and one Master Builder who assembles the result, shown live in a banner above the composer and in the side panel. Use when the user says "lego", "/lego", asks for a Lego build, or wants a task split across parallel agents with a final integrator.
---

# Lego builds

A Lego build splits a task into **bags**: sub-assemblies that separate
builder agents build at the same time in the shared workspace. When every
bag is built, one **Master Builder** agent attaches them to the main model:
it integrates the pieces, fixes the seams, and verifies the whole. The user
follows it in a banner above the composer and opens the full workbench in
the side panel.

## 1. Read before you plan

Look at the code the task touches first: entry points, existing modules,
conventions, how things are tested. A plan that guesses file layout produces
bags that do not fit together.

## 2. Write the instruction book

Call `lego_create_book` with:

- `title`: a short set name, like a box title ("Billing Dashboard").
- `blueprint`: the model on the box, designed for this task (see below).
- `task`: the user's request in full, plus anything you learned that every
  builder needs (stack, conventions, constraints).
- `studs`: the connection points every bag must honour. This is the most
  important field. Fix these before any builder starts:
  - shared types, interfaces, function signatures, and their file paths
  - API routes and payload shapes, event names, database columns
  - naming conventions and where new files go
  - who owns any file that two bags might want to touch
  Builders work blind to each other; the studs are how their pieces fit.
- `bags` (1–12): each with `name`, `goal`, `files` (the paths it owns),
  `steps` (1–12 concrete steps), and optional `dependsOn` (bag ids that must
  finish first) and `id` (a lowercase slug).
- `assembly.steps`: what the Master Builder does, in order. Use `attaches`
  to name the bags each step wires into the main model. Bags you never
  attach are attached in the last step.
- `assembly.verification`: how to prove the finished model works (commands
  to run, behaviour to check).

### Design the model on the box

Send a `blueprint`: a Lego model that depicts what is being built, so the
user watches the crew build something that means something. A weather
dashboard becomes a weather station, a payments flow a shop with a till, a
search feature a lighthouse, a CLI a robot at a terminal, a game a castle.
Be literal and specific to this task rather than generic.

- **Grid.** `x` runs to the front-right, `y` to the front-left, in studs on
  a `plate` of `w`×`d` (6–24 each). `z` is height in plates; a brick is 3
  plates, so courses sit at z 0, 3, 6… on the baseplate (or 1, 4, 7… on top
  of a 1-plate floor). The front faces the viewer at high `x` and high `y`,
  so put doors, windows and faces on the `front` and `right` sides.
- **Parts** are listed bottom-up in the order the Master Builder attaches
  bags. Give one part per bag where you can, named for what it is
  ("Instrument hut", "Mast"), and keep each part sitting on earlier ones.
- **Shapes** (all take `x`, `y`, `z`, `color`):
  - `brick` `{w, d, h?}` (h in plates, default 3), `plate` `{w, d}`, `tile` `{w, d}` (no studs)
  - `slope` `{w, d, h?, dir}`: a wedge falling towards `dir` (`+x`, `-x`, `+y`, `-y`)
  - `wall` `{w, d, courses, openings?}`: a hollow ring of bricks. Each opening is
    `{side: front|right|back|left, at, width, from?, courses?, fill?}`; use
    `fill: "glass"` for windows, `"brown"` for doors, or leave it out for a gap
  - `tower` `{w, d, courses, colors}`: a solid stack; several colours stripe it
  - `roof` `{w, d, style: gable-x|gable-y|pyramid|flat, gable?}`
  - `tree` `{height?, leaves?}`: trunk at `x, y` with a 3×3 crown
- **Colours:** red, darkRed, orange, yellow, tan, brown, green, brightGreen,
  lime, blue, darkBlue, azure, glass, water, purple, pink, white, lightGray,
  darkGray, black, or any `#rrggbb`.
- Aim for 40–150 bricks. Leave a stud of baseplate free along the front
  edges for the crew. Bricks off the plate or colliding with earlier bricks
  are dropped and reported back, so check the notes in the tool result.

A small example (a weather station's first parts):

```json
{
  "name": "Weather station",
  "plate": { "w": 14, "d": 12, "color": "green" },
  "parts": [
    { "name": "Concrete pad", "shapes": [{ "kind": "plate", "x": 2, "y": 2, "w": 10, "d": 8, "color": "lightGray" }] },
    { "name": "Instrument hut", "shapes": [
      { "kind": "wall", "x": 3, "y": 4, "z": 1, "w": 4, "d": 4, "courses": 2, "color": "white",
        "openings": [{ "side": "front", "at": 1, "width": 2, "courses": 2, "fill": "blue" },
                     { "side": "right", "at": 0, "width": 2, "from": 1, "fill": "glass" }] },
      { "kind": "roof", "x": 2, "y": 3, "z": 7, "w": 6, "d": 6, "style": "flat", "color": "darkGray" }
    ] },
    { "name": "Mast", "shapes": [{ "kind": "tower", "x": 9, "y": 5, "z": 1, "w": 1, "d": 1, "courses": 6, "colors": ["lightGray"] }] }
  ]
}
```

If you skip the blueprint, set `model` to one of the ready-made models
(house, rocket, castle, weather, lighthouse, robot, shop, bridge), or the
plugin picks one from the title.

### Make bags parallel

- **Disjoint files.** Two bags must never edit the same file. Give shared
  glue files (routers, indexes, registries, config) to the Master Builder's
  assembly steps, not to a bag.
- **Few dependencies.** Prefer zero. Code against the studs instead of
  against another bag's output. Use `dependsOn` only when a bag truly cannot
  start without another's result (for example, generated code).
- **Balanced size.** Similar-sized bags finish together. Split a big bag;
  merge trivial ones.
- **Self-contained steps.** A builder reads only its own bag plus the
  studs. Each step should be a verifiable unit ("Add `parseInvoice()` in
  `src/billing/parse.ts` with tests"), not a vague phase.
- **Tests travel with code.** A bag that writes a module writes its tests.
- Small tasks deserve small books. One or two bags is fine; do not invent
  bags to look parallel. If the task cannot be split at all, say so and do
  it yourself instead.

## 3. Show the book and staff the build

1. After `lego_create_book`, a banner appears above the composer, and its
   **Open build** button opens the full instruction book in the side panel.
   Describe the plan in two or three sentences: the bags, and what the
   Master Builder assembles. Do not paste `::lego` directives or redraw the
   plan.
2. Call `lego_setup_build` with the `bookId`. Optionally pass
   `suggestedBuilders` and a one-line `note` (for example, which bags are
   heavy). A form replaces the composer and asks the user:
   - how many builder agents to use,
   - whether every builder runs the same provider and model,
   - which provider, model, and reasoning level the builders use,
   - which provider and model run the Master Builder.
3. The tool returns at once with a waiting notice. End your turn. When the
   user submits, the build starts and you get the tool result as a message:
   tell the user it is under way and end your turn again. Do not poll.

## 4. While it builds

- The banner and the side panel update by themselves (submitting the setup
  form opens the panel). Builders and the Master Builder run in child
  threads the user can open from the panel.
- BB posts a short report here whenever a child thread finishes a turn.
  Those are routine: do not act on them, poll, or message the builders. End
  your turn and wait for the plugin's `[Lego]` message.
- This thread receives a message when the Master Builder finishes or a
  worker fails. On completion, summarise the Master Builder's report; the
  banner already shows the finished model.
- On failure, explain what failed and offer `lego_retry` (one bag via
  `bagId`, or everything that failed) or `lego_cancel_build`.
- `lego_status` gives a text snapshot whenever the user asks.

## CLI

`bb lego list`, `bb lego status <bookId>`, `bb lego cancel <bookId>`, and
`bb lego retry <bookId> [--bag <bagId>]` mirror the tools. Builder and Master
Builder threads can report with `bb lego step <n>`, `bb lego bag-done
--summary …`, `bb lego assembled <n>`, and `bb lego complete --summary …`
when their tools are unavailable. If the user wants to see Lego without
starting real agents, `bb lego demo` prints a sample book in this thread with
simulated builders; they press Play on its banner.
