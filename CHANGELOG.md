# Changelog

All notable changes to Lego are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-10-19

### Added

- `lego_create_book`: the planning agent prints an instruction book of bags (parallel sub-assemblies with owned files and steps), the shared connection points every bag must honour, and the Master Builder's assembly steps.
- Blueprints: the planning agent designs a Lego model that depicts the task from walls, towers, roofs, slopes, trees and bricks; the plugin compiles it, keeps it on the baseplate and reports what it fixed. Eight ready-made models cover books without one.
- `lego_setup_build`: a form in the composer that asks how many builders to use, whether they share a provider and model, which model they run, and which model runs the Master Builder.
- Parallel builder threads that pick up the next ready bag, and a Master Builder that starts when every bag is built.
- A live banner above the composer, a side-panel workbench with the model, bag trays, instruction pages and crew, and a Lego Build page that shelves every finished model.
- Minifigure builders and Master Builder, brick-by-brick animation, and a celebration when a set is complete.
- Failure handling: failed bags message the planning thread, and `lego_retry` and `lego_cancel_build` recover or stop a build.
- `lego_bag_blocked`: a builder that cannot build its bag says why, and the bag fails rather than passing for built. A builder or Master Builder that stops short is asked once to report, then fails. Starting a worker is retried twice when BB is briefly unavailable.
- Deleted threads are unlinked: a set whose planning thread was deleted stays on the shelf without a link, and a worker deleted mid-work fails its bag so a retry starts a fresh thread.
- `bb lego` CLI: list, status, cancel, retry, demo, and reporting fallbacks for builder and Master Builder threads.
