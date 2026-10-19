## What you get

- **An instruction book for every task.** The planning agent cuts the work
  into bags (sub-assemblies with the files they own and their steps), fixes
  the shared connection points every bag must honour, and writes the Master
  Builder's assembly steps.
- **You staff the crew.** A form asks how many builders to use, whether they
  all run the same provider and model, which model they run, and which model
  runs the Master Builder. Nothing starts until you submit it.
- **Builders in parallel.** Each builder is a child thread of yours, in the
  same workspace, and picks up the next bag whose dependencies are built.
- **One Master Builder.** When every bag is built it attaches them, fixes the
  seams and verifies the whole. Your thread gets a message when it finishes,
  or when a builder fails or is blocked, with retry and cancel to recover.
- **A model that depicts the task.** The planning agent designs a Lego model
  for the work, such as a weather station for a weather dashboard, and each
  part of it becomes a bag.
- **Watch it build.** A live banner above the composer and a side-panel
  workbench show minifigure builders placing bricks and the Master Builder
  attaching each bag to the model.
- **A collector's shelf.** The Lego Build page in the sidebar displays every
  finished model with a placard naming its set, task, date and crew.

## How it works

Ask for a build with `/lego` and a task. The planning agent calls
`lego_create_book`, then `lego_setup_build` to show the form. Builders report
each step and the Master Builder reports each attachment, and the banner and
panel update as they do. `bb lego demo` previews the whole thing with
simulated builders; press Play on its banner.

Everything stays in this BB install: books are stored in the plugin's own
database, and workers are ordinary BB threads you can open, stop or archive.
