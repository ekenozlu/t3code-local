import type { EnvironmentThreadShell } from "./models.ts";
import { resolveThreadActivityTimestamp, toSortableTimestamp } from "./threadSort.ts";

/** Rows a "By project" section shows at first, and adds per "See more". */
export const PROJECT_THREAD_PAGE_SIZE = 5;

/** Most recent activity first; ties by id so the order is stable across renders. */
export function sortThreadsByRecentActivity<
  TThread extends Pick<
    EnvironmentThreadShell,
    "id" | "latestUserMessageAt" | "latestRun" | "updatedAt"
  >,
>(threads: readonly TThread[]): TThread[] {
  return threads
    .map((thread) => ({
      thread,
      timestampMs: toSortableTimestamp(resolveThreadActivityTimestamp(thread) ?? undefined) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.timestampMs - left.timestampMs ||
        (left.thread.id < right.thread.id ? -1 : left.thread.id > right.thread.id ? 1 : 0),
    )
    .map(({ thread }) => thread);
}

/**
 * One "By project" section's rows: the first `shownCount` of its sorted threads, plus the open
 * thread wherever it sits, so the open row never disappears behind "See more".
 */
export function pageProjectThreads<TThread>(input: {
  readonly threads: readonly TThread[];
  readonly shownCount: number;
  readonly routeThreadKey: string | null;
  readonly keyOf: (thread: TThread) => string;
}): TThread[] {
  const shown = input.threads.slice(0, Math.max(0, input.shownCount));
  if (input.routeThreadKey === null) return shown;
  if (shown.some((thread) => input.keyOf(thread) === input.routeThreadKey)) return shown;
  const route = input.threads.find((thread) => input.keyOf(thread) === input.routeThreadKey);
  return route === undefined ? shown : [...shown, route];
}

/**
 * Threads behind a section's "See more": every thread the project has, loaded or still on the
 * server, past the rows it shows. Zero hides the row.
 */
export function projectThreadsMoreCount(input: {
  readonly loadedCount: number;
  readonly unloadedCount: number;
  readonly shownCount: number;
}): number {
  return Math.max(0, input.loadedCount + input.unloadedCount - input.shownCount);
}

/**
 * Settled rows a section needs loaded to fill `shownCount`, after the unsettled rows it already
 * holds. Older settled threads are the only rows the server pages, so they are what "See more"
 * fetches.
 */
export function projectThreadsWantedSettled(input: {
  readonly loadedCount: number;
  readonly loadedSettledCount: number;
  readonly shownCount: number;
}): number {
  return Math.max(0, input.shownCount - (input.loadedCount - input.loadedSettledCount));
}
