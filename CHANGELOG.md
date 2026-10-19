# Changelog

All notable changes to Lego are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `lego_bag_blocked` (and `bb lego blocked --reason`): a builder that cannot build its bag says why, the bag fails, and the planning thread is told.

### Changed

- The build setup form fits BB's interaction card without scrolling, and its Start and Not now buttons stay in view on short windows. Whether every builder shares a model is now a toggle beside the builders' model picker.
- The banner and the side panel show the last copy of a book at once when BB remounts them, instead of a loading line while BB is slow.
- Deleting a thread unlinks it from its books. A set whose planning thread was deleted stays on the shelf, not clickable and marked "thread deleted", and the plugin stops messaging that thread. A builder or Master Builder deleted mid-work fails its bag or the assembly, so a retry starts a fresh thread. Deletions made while the plugin was unloaded are found when it starts.
- The shelf orders sets, and dates their placards, by when they were finished rather than when the book last changed.

### Fixed

- A builder that stopped without finishing its bag had its last message taken as the bag's report, so a blocked bag was marked built and left for the Master Builder. A builder that stops short is now asked once to report, and the bag fails if it stops short again. The Master Builder is held to the same rule.
- Starting a builder or the Master Builder failed the bag at the first HTTP 5xx or dispatch-hook timeout. Those are now retried twice, after 3 and 10 seconds, while the build still needs the thread.
- In a narrow side panel the title shrank to an ellipsis beside the status pill; the pill now wraps under it. A narrow banner shows the status as a dot, and its text no longer runs under the Open build button.

## 0.1.0 - 2026-10-19

### Added

- `lego_create_book`: the planning agent prints an instruction book of bags (parallel sub-assemblies with owned files and steps), the shared connection points every bag must honour, and the Master Builder's assembly steps.
- Blueprints: the planning agent designs a Lego model that depicts the task from walls, towers, roofs, slopes, trees and bricks; the plugin compiles it, keeps it on the baseplate and reports what it fixed. Eight ready-made models cover books without one.
- `lego_setup_build`: a form in the composer that asks how many builders to use, whether they share a provider and model, which model they run, and which model runs the Master Builder.
- Parallel builder threads that pick up the next ready bag, and a Master Builder that starts when every bag is built.
- A live banner above the composer, a side-panel workbench with the model, bag trays, instruction pages and crew, and a Lego Build page that shelves every finished model.
- Minifigure builders and Master Builder, brick-by-brick animation, and a celebration when a set is complete.
- Failure handling: failed bags message the planning thread, and `lego_retry` and `lego_cancel_build` recover or stop a build.
- `bb lego` CLI: list, status, cancel, retry, demo, and reporting fallbacks for builder and Master Builder threads.
