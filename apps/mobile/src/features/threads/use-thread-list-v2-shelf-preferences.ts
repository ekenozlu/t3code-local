import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SidebarThreadGrouping } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

const NO_KEYS: ReadonlyArray<string> = [];

export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const snoozedShelfExpanded =
    loaded && preferencesResult.value.threadListSnoozedShelfExpanded === true;
  const settledShelfExpanded =
    loaded && preferencesResult.value.threadListSettledShelfExpanded === true;
  const workingShelfEnabled = loaded && preferencesResult.value.workingShelfEnabled !== false;
  const workingShelfExpanded =
    loaded && preferencesResult.value.threadListWorkingShelfExpanded === true;
  const groupByProject = loaded && preferencesResult.value.threadListGrouping === "project";
  const collapsedProjectKeys =
    (loaded ? preferencesResult.value.collapsedProjectGroups : undefined) ?? NO_KEYS;

  // Transforms read optimistic state so same-frame presses toggle twice.
  const toggleSnoozedShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListSnoozedShelfExpanded: current.threadListSnoozedShelfExpanded !== true,
      }),
    });
  };
  const toggleSettledShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListSettledShelfExpanded: current.threadListSettledShelfExpanded !== true,
      }),
    });
  };
  const toggleWorkingShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListWorkingShelfExpanded: current.threadListWorkingShelfExpanded !== true,
      }),
    });
  };

  const setThreadListGrouping = (threadListGrouping: SidebarThreadGrouping) => {
    if (!loaded) return;
    savePreferences({ threadListGrouping });
  };
  const toggleProjectSection = (projectKey: string) => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => {
        const collapsed = current.collapsedProjectGroups ?? [];
        return {
          collapsedProjectGroups: collapsed.includes(projectKey)
            ? collapsed.filter((key) => key !== projectKey)
            : [...collapsed, projectKey],
        };
      },
    });
  };

  return {
    loaded,
    groupByProject,
    collapsedProjectKeys,
    setThreadListGrouping,
    toggleProjectSection,
    settledShelfExpanded,
    snoozedShelfExpanded,
    workingShelfEnabled,
    workingShelfExpanded,
    toggleSettledShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
  } as const;
}
