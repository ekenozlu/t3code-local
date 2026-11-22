import type { DesktopMenuBarUsageState } from "@t3tools/contracts";

import { isElectron } from "../../env";
import {
  getClientSettings,
  isClientSettingsHydrated,
  subscribeClientSettings,
  subscribeClientSettingsHydration,
} from "../../hooks/useSettings";
import { isMacPlatform } from "~/lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { primaryServerProvidersAtom } from "../../state/server";
import {
  menuBarUsageTitle,
  menuBarUsageTooltip,
  summarizeProviderUsage,
} from "./menuBarUsage.logic";

export const MENU_BAR_USAGE_PATH = "/menubar-usage";

// Windows past their reset drop out of the title even when no new reading arrives.
const TITLE_RECHECK_MS = 60_000;

/** The popover window loads the app at this hash route; it starts only what it renders. */
export function isMenuBarUsagePopover(): boolean {
  return isElectron && window.location.hash.startsWith(`#${MENU_BAR_USAGE_PATH}`);
}

export function supportsMenuBarUsage(): boolean {
  return isElectron && isMacPlatform(navigator.platform);
}

/**
 * Keeps the desktop menu bar item in step with the setting and the primary server's provider
 * readings. Runs in the main window, which already holds both.
 */
export function startMenuBarUsageTray(): void {
  const bridge = window.desktopBridge;
  if (!supportsMenuBarUsage() || typeof bridge?.setMenuBarUsage !== "function") return;
  let sent = "";
  const push = () => {
    // Before hydration the defaults would flash the item on for a user who turned it off.
    if (!isClientSettingsHydrated()) return;
    const settings = getClientSettings();
    const summaries = appAtomRegistry
      .get(primaryServerProvidersAtom)
      .map((provider) => summarizeProviderUsage(provider, Date.now()));
    const state: DesktopMenuBarUsageState = {
      enabled: settings.menuBarUsageEnabled,
      title: settings.menuBarUsageShowPercent ? menuBarUsageTitle(summaries) : null,
      tooltip: menuBarUsageTooltip(summaries),
    };
    const key = JSON.stringify(state);
    if (key === sent) return;
    sent = key;
    void bridge.setMenuBarUsage(state).catch(() => {
      sent = "";
    });
  };
  appAtomRegistry.subscribe(primaryServerProvidersAtom, push, { immediate: true });
  subscribeClientSettings(push);
  subscribeClientSettingsHydration(push);
  setInterval(push, TITLE_RECHECK_MS);
}
