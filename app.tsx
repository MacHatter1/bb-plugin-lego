// bb-plugin-lego — frontend entry. A banner above the thread composer shows
// the live build; the full workbench opens as a side-panel tab; the
// build-setup interaction replaces the composer while lego_setup_build asks
// the user how to staff the build. The Lego Build page in the sidebar is the
// collector's shelf of every finished model.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { BuildPanel } from "./src/ui/BuildPanel";
import { BuildBanner } from "./src/ui/BuildBanner";
import { LegoChip } from "./src/ui/LegoChip";
import { CollectorsShelf } from "./src/ui/Shelf";
import { SetupForm } from "./src/ui/SetupForm";
import { PANEL_ACTION_ID } from "./src/ui/useBook";
import "./src/ui/lego.css";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "shelf", title: "Lego Build", icon: "lego/brick", path: "shelf", component: CollectorsShelf });
  app.composer.customize({
    id: "lego",
    scopes: ["thread"],
    banners: [{ id: "build", chrome: "bare", component: BuildBanner }],
  });
  app.slots.messageDirective({ id: "lego", component: LegoChip });
  app.slots.threadPanelAction({ id: PANEL_ACTION_ID, title: "Lego build", component: BuildPanel });
  app.slots.pendingInteraction({ id: "build-setup", component: SetupForm });
});
