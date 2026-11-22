import { createFileRoute } from "@tanstack/react-router";

import { MenuBarUsagePage } from "../components/menubar/MenuBarUsagePage";

// The desktop menu bar popover; it renders without the app shell.
export const Route = createFileRoute("/menubar-usage")({
  component: MenuBarUsagePage,
});
