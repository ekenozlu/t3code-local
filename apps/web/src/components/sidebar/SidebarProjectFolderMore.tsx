import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { sidebarProjectFolderMoreCount, sidebarProjectFolderWantedSettled } from "../Sidebar.logic";
import { sidebarFolderRowId } from "./SidebarProjectFolderHeader";

function folderScopes(group: SidebarProjectSnapshot) {
  const projectIdsByEnvironment = new Map<EnvironmentId, ProjectId[]>();
  for (const ref of group.memberProjectRefs) {
    const projectIds = projectIdsByEnvironment.get(ref.environmentId) ?? [];
    projectIds.push(ref.projectId);
    projectIdsByEnvironment.set(ref.environmentId, projectIds);
  }
  return [...projectIdsByEnvironment].map(([environmentId, projectIds]) => ({
    environmentId,
    projectIds,
  }));
}

/**
 * The "See more" row under an open "By project" folder. Shells leave older settled threads on
 * the server, so this row also reads the project's next older pages until the folder can show
 * `shownCount` rows; it stays mounted while the folder is open to keep those pages loaded.
 */
export function SidebarProjectFolderMore(props: {
  group: SidebarProjectSnapshot;
  /** Every thread of the project this client holds, in any section. */
  loadedThreads: readonly EnvironmentThreadShell[];
  settledThreadKeys: ReadonlySet<string>;
  shownCount: number;
  onShowMore: (group: SidebarProjectSnapshot) => void;
}) {
  const { group, loadedThreads, settledThreadKeys, shownCount } = props;
  const loadedSettled = loadedThreads.filter((thread) =>
    settledThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
  const shelf = useOlderSettledShelf({
    scopes: folderScopes(group),
    expanded: true,
    visibleCount: sidebarProjectFolderWantedSettled({
      loadedCount: loadedThreads.length,
      loadedSettledCount: loadedSettled.length,
      shownCount,
    }),
  });
  useOlderSettledShelfGrowth(shelf, loadedSettled.filter(shelf.isListed));
  const moreCount = sidebarProjectFolderMoreCount({
    loadedCount: loadedThreads.length,
    unloadedCount: shelf.unloadedCount(loadedThreads),
    shownCount,
  });
  if (moreCount === 0 && !shelf.failed) return null;
  const busy = shelf.loading && moreCount > 0 && loadedThreads.length < shownCount;
  return (
    <li className="list-none">
      <button
        type="button"
        data-sidebar-row={`folder-more:${group.projectKey}`}
        data-sidebar-parent={sidebarFolderRowId(group.projectKey)}
        aria-disabled={busy}
        onClick={() => {
          if (busy) return;
          if (shelf.failed) {
            shelf.retry();
            return;
          }
          props.onShowMore(group);
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md ps-9 pe-2.5 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground aria-disabled:cursor-default"
      >
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {busy ? "Loading…" : shelf.failed ? "Could not load older threads. Retry" : "See more"}
        </span>
        {!busy && !shelf.failed ? (
          <span className="shrink-0 tabular-nums" aria-label={`${moreCount} more threads`}>
            {moreCount}
          </span>
        ) : null}
      </button>
    </li>
  );
}
