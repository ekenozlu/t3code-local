import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** macOS desktop: the menu bar item with each provider's subscription usage. */
export function MenuBarUsageSettingsSection() {
  const enabled = useClientSettings((settings) => settings.menuBarUsageEnabled);
  const showPercent = useClientSettings((settings) => settings.menuBarUsageShowPercent);
  return (
    <SettingsSection id="menu-bar" title="Menu bar">
      <SettingsRow
        {...searchableSetting("menu-bar-usage")}
        description="Show subscription usage for your AI providers in the macOS menu bar. Click it for plan, limits and reset times."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              void updateClientSettings({ menuBarUsageEnabled: Boolean(checked) })
            }
            aria-label="Usage in the menu bar"
          />
        }
      />
      {enabled ? (
        <SettingsRow
          title="Show highest usage"
          description="Show the busiest limit's percentage next to the menu bar icon."
          control={
            <Switch
              checked={showPercent}
              onCheckedChange={(checked) =>
                void updateClientSettings({ menuBarUsageShowPercent: Boolean(checked) })
              }
              aria-label="Show highest usage in the menu bar"
            />
          }
        />
      ) : null}
    </SettingsSection>
  );
}
