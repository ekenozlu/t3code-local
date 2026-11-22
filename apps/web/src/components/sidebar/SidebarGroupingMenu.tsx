import type { SidebarThreadGrouping } from "@t3tools/contracts/settings";
import { FoldersIcon, InboxIcon } from "lucide-react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const GROUPING_OPTIONS = [
  { value: "status", label: "By status", Icon: InboxIcon },
  { value: "project", label: "By project", Icon: FoldersIcon },
] as const satisfies ReadonlyArray<{ value: SidebarThreadGrouping; label: string; Icon: unknown }>;

/** Switches the thread list between the status inbox and per-project sections. */
export function SidebarGroupingMenu() {
  const grouping = useClientSettings((settings) => settings.sidebarThreadGrouping);
  const current =
    GROUPING_OPTIONS.find((option) => option.value === grouping) ?? GROUPING_OPTIONS[0];
  return (
    <Menu>
      <MenuTrigger
        render={<SidebarHeaderIconButton label={`Group threads: ${current.label.toLowerCase()}`} />}
      >
        <current.Icon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuGroup>
          <MenuGroupLabel>Group threads</MenuGroupLabel>
          <MenuRadioGroup
            value={grouping}
            onValueChange={(next) => {
              const option = GROUPING_OPTIONS.find((candidate) => candidate.value === next);
              if (option) void updateClientSettings({ sidebarThreadGrouping: option.value });
            }}
          >
            {GROUPING_OPTIONS.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2">
                  <option.Icon aria-hidden />
                  <span className="flex-1">{option.label}</span>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
