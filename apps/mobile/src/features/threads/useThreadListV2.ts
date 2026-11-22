import { PROJECT_THREAD_PAGE_SIZE } from "@t3tools/client-runtime/state/project-thread-paging";
import {
  unloadedOlderSettledCount,
  type OlderSettledScope,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useState, useSyncExternalStore } from "react";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  buildThreadListV2ProjectSections,
  type ThreadListV2ListItem,
  type ThreadListV2ProjectSectionInput,
  getThreadListV2OrderedSection,
  threadListInboxReturns,
  threadListV2LayoutTime,
} from "./threadListV2";
import { computeThreadMoveAvailability } from "./threadOrder";

/**
 * Screens' select handlers read the content-only key set; a fresh one per list rebuild gave
 * every row a new handler whenever any thread shell changed. Keyed by a string, the set keeps
 * its identity until its keys change.
 */
function useKeySet(newlineSeparatedKeys: string): ReadonlySet<string> {
  return useMemo(
    () => new Set(newlineSeparatedKeys.length === 0 ? [] : newlineSeparatedKeys.split("\n")),
    [newlineSeparatedKeys],
  );
}

type LayoutInput = Parameters<typeof buildThreadListV2Items>[0];

/**
 * The React Compiler drops unread dependencies, so pass the expired-grace version through
 * this call to keep inbox updates tied to its subscription.
 */
function observeInbox(
  threads: Parameters<typeof threadListInboxReturns.observe>[0],
  _expiredGraceVersion: number,
) {
  return threadListInboxReturns.observe(threads);
}

/**
 * Shelf callbacks prevent compiler caching across the whole derivation, so each stage keeps
 * its own memo boundary to preserve the list's identity during unrelated navigation renders.
 */
export function useThreadListV2(input: {
  readonly threads: LayoutInput["threads"];
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs: LayoutInput["projectRefs"];
  readonly searchQuery: string;
  /** Threads that match the search by content, keyed like `threadSearchMatchKey`. */
  readonly searchMatches: ReadonlyMap<string, unknown>;
  readonly settlementEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly snoozeEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly pinReorderEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly activeReorderEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys: ReadonlySet<string>;
  readonly settledLimit: number;
  readonly now: string;
  readonly pendingOrder: LayoutInput["pendingOrder"];
  readonly shelfPreferencesLoaded: boolean;
  readonly workingShelfEnabled: boolean;
  readonly workingShelfExpanded: boolean;
  readonly snoozedShelfExpanded: boolean;
  readonly settledShelfExpanded: boolean;
  readonly selectedThreadKey: string | null;
  /** "By project" sections, or null for the status inbox. A search lists matches either way. */
  readonly projectSections: ReadonlyArray<ThreadListV2ProjectSectionInput> | null;
  readonly collapsedProjectKeys: ReadonlyArray<string>;
}) {
  const { threads, workingShelfEnabled } = input;
  const groupByProject = input.projectSections !== null && input.searchQuery.trim().length === 0;
  const [projectShownCounts, setProjectShownCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const layoutTime = useMemo(
    () => threadListV2LayoutTime({ threads, now: input.now, searchQuery: input.searchQuery }),
    [threads, input.now, input.searchQuery],
  );
  // A thread can stop working when the threads change, or when its exit grace expires.
  const inboxVersion = useSyncExternalStore(
    threadListInboxReturns.subscribe,
    threadListInboxReturns.getSnapshot,
  );
  const inbox = useMemo(
    () => observeInbox(workingShelfEnabled ? threads : null, inboxVersion),
    [threads, workingShelfEnabled, inboxVersion],
  );
  // Compute move availability per section; per-row planning is quadratic.
  const moveAvailability = useMemo(() => {
    const sectionAvailability = (section: "pinned" | "active") =>
      computeThreadMoveAvailability({
        allThreads: threads,
        section,
        pendingOrder: input.pendingOrder,
        reorderableEnvironmentIds:
          section === "pinned" ? input.pinReorderEnvironmentIds : input.activeReorderEnvironmentIds,
        ordered: getThreadListV2OrderedSection({
          threads,
          section,
          pendingOrder: input.pendingOrder,
          now: layoutTime,
          settlementEnvironmentIds: input.settlementEnvironmentIds,
          snoozeEnvironmentIds: input.snoozeEnvironmentIds,
          queuedThreadKeys: input.queuedThreadKeys,
        }),
      });
    return new Map([
      ...sectionAvailability("pinned"),
      ...(workingShelfEnabled ? [] : sectionAvailability("active")),
    ]);
  }, [
    threads,
    input.pendingOrder,
    input.pinReorderEnvironmentIds,
    input.activeReorderEnvironmentIds,
    layoutTime,
    input.settlementEnvironmentIds,
    input.snoozeEnvironmentIds,
    input.queuedThreadKeys,
    workingShelfEnabled,
  ]);
  // Older settled threads load in pages; the shelf lists them only as far as they are loaded.
  const scopes = useMemo(
    () =>
      olderSettledScopes({
        environmentId: input.environmentId,
        projectRefs: input.projectRefs,
        settlementEnvironmentIds: input.settlementEnvironmentIds,
      }),
    [input.environmentId, input.projectRefs, input.settlementEnvironmentIds],
  );
  const olderSettledShelf = useOlderSettledShelf({
    scopes,
    // "By project" sections read older pages whenever one needs them to fill its page.
    expanded: groupByProject || input.settledShelfExpanded,
    // A search lists only matches, so the shelf would page forever; loaded pages stay.
    visibleCount: input.searchQuery.trim().length === 0 ? input.settledLimit : 0,
  });
  const { isListed, unloadedCount } = olderSettledShelf;
  const layout = useMemo(
    () =>
      buildThreadListV2Items({
        pendingOrder: input.pendingOrder,
        threads: threads.filter((thread) => thread.archivedAt === null),
        environmentId: input.environmentId,
        projectRefs: input.projectRefs,
        searchQuery: input.searchQuery,
        matchedThreadKeys: new Set(input.searchMatches.keys()),
        settlementEnvironmentIds: input.settlementEnvironmentIds,
        snoozeEnvironmentIds: input.snoozeEnvironmentIds,
        queuedThreadKeys: input.queuedThreadKeys,
        settledLimit: input.settledLimit,
        now: layoutTime,
        workingShelfEnabled,
        workingShelfExpanded: input.workingShelfExpanded,
        inboxReturnAt: inbox.returnedAt,
        isWorking: inbox.isWorking,
        snoozedShelfExpanded: input.snoozedShelfExpanded,
        settledShelfExpanded: input.settledShelfExpanded,
        selectedThreadKey: input.selectedThreadKey,
        isListedSettled: isListed,
        unloadedSettledCount: unloadedCount(
          threads.filter(
            (thread) =>
              thread.archivedAt === null &&
              scopes.some(
                (scope) =>
                  scope.environmentId === thread.environmentId &&
                  (scope.projectIds === null || scope.projectIds.includes(thread.projectId)),
              ),
          ),
        ),
      }),
    [
      input.pendingOrder,
      threads,
      input.environmentId,
      input.projectRefs,
      input.searchQuery,
      input.searchMatches,
      input.settlementEnvironmentIds,
      input.snoozeEnvironmentIds,
      input.queuedThreadKeys,
      input.settledLimit,
      layoutTime,
      workingShelfEnabled,
      input.workingShelfExpanded,
      inbox.returnedAt,
      inbox.isWorking,
      input.snoozedShelfExpanded,
      input.settledShelfExpanded,
      input.selectedThreadKey,
      isListed,
      unloadedCount,
      scopes,
    ],
  );
  const projectSections = useMemo(
    () =>
      groupByProject && input.projectSections !== null
        ? buildThreadListV2ProjectSections({
            threads,
            environmentId: input.environmentId,
            projectRefs: input.projectRefs,
            sections: input.projectSections,
            settlementEnvironmentIds: input.settlementEnvironmentIds,
            snoozeEnvironmentIds: input.snoozeEnvironmentIds,
            queuedThreadKeys: input.queuedThreadKeys,
            now: layoutTime,
            selectedThreadKey: input.selectedThreadKey,
            collapsedKeys: new Set(input.collapsedProjectKeys),
            shownCounts: projectShownCounts,
            pageSize: PROJECT_THREAD_PAGE_SIZE,
            unloadedCount: (projectRefs, loadedThreads) =>
              unloadedOlderSettledCount({
                olderSettled: (environmentId) =>
                  olderSettledShelf.environments.get(environmentId)?.older ?? null,
                scopes: [...new Set(projectRefs.map((ref) => ref.environmentId))].map(
                  (environmentId) => ({
                    environmentId,
                    projectIds: projectRefs.flatMap((ref) =>
                      ref.environmentId === environmentId ? [ref.projectId] : [],
                    ),
                  }),
                ),
                threads: loadedThreads,
              }),
          })
        : null,
    [
      groupByProject,
      threads,
      input.environmentId,
      input.projectRefs,
      input.projectSections,
      input.settlementEnvironmentIds,
      input.snoozeEnvironmentIds,
      input.queuedThreadKeys,
      layoutTime,
      input.selectedThreadKey,
      input.collapsedProjectKeys,
      projectShownCounts,
      olderSettledShelf.environments,
    ],
  );
  const projectNeedsOlderSettled =
    projectSections?.some((section) => section.needsOlderSettled) === true;
  // Pages load newest first across each environment, so a section that needs older threads asks
  // for one more page at a time until it has them or the server has none left.
  useOlderSettledShelfGrowth(
    projectSections === null
      ? olderSettledShelf
      : {
          ...olderSettledShelf,
          visibleCount: projectNeedsOlderSettled ? layout.listedSettledThreads.length + 1 : 0,
        },
    layout.listedSettledThreads,
  );
  const contentOnlyThreadKeys = useKeySet([...layout.contentOnlyThreadKeys].sort().join("\n"));
  const pendingTasks = useMemo(() => {
    const scopedProjectKeys =
      input.projectRefs == null
        ? null
        : new Set(
            input.projectRefs.map((ref) => scopedProjectKey(ref.environmentId, ref.projectId)),
          );
    const searchQuery = input.searchQuery.trim().toLocaleLowerCase();
    return input.pendingTasks.filter(
      (pendingTask) =>
        (input.environmentId === null || pendingTask.environmentId === input.environmentId) &&
        (scopedProjectKeys === null ||
          scopedProjectKeys.has(
            scopedProjectKey(pendingTask.environmentId, pendingTask.projectId),
          )) &&
        (searchQuery.length === 0 || pendingTask.title.toLocaleLowerCase().includes(searchQuery)),
    );
  }, [input.projectRefs, input.searchQuery, input.pendingTasks, input.environmentId]);
  const items = useMemo(
    () =>
      buildThreadListV2ListItems({
        items: layout.items,
        pendingTasks,
        workingCount: layout.workingCount,
        workingShelfExpanded: input.workingShelfExpanded,
        workingShelfHeaderIndex: layout.workingShelfHeaderIndex,
        snoozedCount: layout.snoozedCount,
        snoozedShelfExpanded: input.snoozedShelfExpanded,
        snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
        settledCount: layout.settledCount,
        settledShelfExpanded: input.settledShelfExpanded,
        settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
        snoozeLabelNow: `${input.now.slice(0, 16)}:00.000Z`,
        snoozeEnvironmentIds: input.snoozeEnvironmentIds,
        queuedThreadKeys: input.queuedThreadKeys,
        moveAvailability,
        shelfPreferencesLoading: !input.shelfPreferencesLoaded,
      }),
    [
      layout,
      pendingTasks,
      input.workingShelfExpanded,
      input.snoozedShelfExpanded,
      input.settledShelfExpanded,
      input.now,
      input.snoozeEnvironmentIds,
      input.queuedThreadKeys,
      moveAvailability,
      input.shelfPreferencesLoaded,
    ],
  );
  const projectItems = useMemo((): ThreadListV2ListItem[] | null => {
    if (projectSections === null) return null;
    const result = buildThreadListV2ListItems({ items: [], pendingTasks });
    for (const section of projectSections) {
      result.push({
        type: "v2-project-header",
        key: `v2-project:${section.key}`,
        projectKey: section.key,
        title: section.title,
        count: section.loadedCount + section.unloadedCount,
        expanded: section.expanded,
        disabled: !input.shelfPreferencesLoaded,
      });
      result.push(
        ...buildThreadListV2ListItems({
          items: section.items,
          pendingTasks: [],
          snoozeLabelNow: `${input.now.slice(0, 16)}:00.000Z`,
          snoozeEnvironmentIds: input.snoozeEnvironmentIds,
          queuedThreadKeys: input.queuedThreadKeys,
        }),
      );
      const state =
        section.needsOlderSettled && olderSettledShelf.loading
          ? "loading"
          : section.expanded && section.unloadedCount > 0 && olderSettledShelf.failed
            ? "failed"
            : undefined;
      if (section.moreCount > 0 || state === "failed") {
        result.push({
          type: "v2-project-more",
          key: `v2-project-more:${section.key}`,
          projectKey: section.key,
          moreCount: section.moreCount,
          state,
        });
      }
    }
    return result;
  }, [
    projectSections,
    pendingTasks,
    input.shelfPreferencesLoaded,
    input.now,
    input.snoozeEnvironmentIds,
    input.queuedThreadKeys,
    olderSettledShelf.loading,
    olderSettledShelf.failed,
  ]);
  const showMoreInProject = (projectKey: string) => {
    if (olderSettledShelf.failed) {
      olderSettledShelf.retry();
      return;
    }
    setProjectShownCounts((current) =>
      new Map(current).set(
        projectKey,
        (current.get(projectKey) ?? PROJECT_THREAD_PAGE_SIZE) + PROJECT_THREAD_PAGE_SIZE,
      ),
    );
  };
  return {
    layout,
    items: projectItems ?? items,
    contentOnlyThreadKeys,
    olderSettledShelf,
    groupByProject: projectItems !== null,
    showMoreInProject,
  };
}

/** The list's scope per environment: its projects there, or every project. */
function olderSettledScopes(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs: LayoutInput["projectRefs"];
  readonly settlementEnvironmentIds: ReadonlySet<EnvironmentId>;
}): ReadonlyArray<OlderSettledScope> {
  const environmentIds =
    input.environmentId === null ? [...input.settlementEnvironmentIds] : [input.environmentId];
  return environmentIds.flatMap((environmentId): ReadonlyArray<OlderSettledScope> => {
    if (input.projectRefs == null) return [{ environmentId, projectIds: null }];
    const projectIds = input.projectRefs.flatMap((ref) =>
      ref.environmentId === environmentId ? [ref.projectId] : [],
    );
    return projectIds.length === 0 ? [] : [{ environmentId, projectIds }];
  });
}
