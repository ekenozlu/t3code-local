import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  pageProjectThreads,
  projectThreadsMoreCount,
  projectThreadsWantedSettled,
  sortThreadsByRecentActivity,
} from "./projectThreadPaging.ts";

describe("By project paging", () => {
  const thread = (id: string, latestUserMessageAt: string | null, updatedAt: string) => ({
    id: ThreadId.make(id),
    latestUserMessageAt,
    latestRun: null,
    updatedAt,
  });

  it("orders threads by latest activity, falling back to updatedAt", () => {
    const sorted = sortThreadsByRecentActivity([
      thread("old", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      thread("untouched", null, "2026-03-01T00:00:00.000Z"),
      thread("recent", "2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      thread("recent-tie", "2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["untouched", "recent", "recent-tie", "old"]);
  });

  it("pages rows and keeps the open thread past the page", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"];
    const page = (shownCount: number, routeThreadKey: string | null) =>
      pageProjectThreads({ threads: keys, shownCount, routeThreadKey, keyOf: (key) => key });
    expect(page(5, null)).toEqual(["a", "b", "c", "d", "e"]);
    expect(page(10, null)).toEqual(keys);
    expect(page(5, "g")).toEqual(["a", "b", "c", "d", "e", "g"]);
    expect(page(5, "b")).toEqual(["a", "b", "c", "d", "e"]);
    expect(page(5, "missing")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("counts unloaded server threads behind See more", () => {
    expect(projectThreadsMoreCount({ loadedCount: 3, unloadedCount: 0, shownCount: 5 })).toBe(0);
    expect(projectThreadsMoreCount({ loadedCount: 7, unloadedCount: 0, shownCount: 5 })).toBe(2);
    // Only older settled threads remain on the server; See more still offers them.
    expect(projectThreadsMoreCount({ loadedCount: 5, unloadedCount: 12, shownCount: 5 })).toBe(12);
  });

  it("asks for settled pages only past the unsettled rows it holds", () => {
    expect(
      projectThreadsWantedSettled({ loadedCount: 4, loadedSettledCount: 1, shownCount: 5 }),
    ).toBe(2);
    expect(
      projectThreadsWantedSettled({ loadedCount: 9, loadedSettledCount: 0, shownCount: 5 }),
    ).toBe(0);
    expect(
      projectThreadsWantedSettled({ loadedCount: 6, loadedSettledCount: 4, shownCount: 10 }),
    ).toBe(8);
  });
});
