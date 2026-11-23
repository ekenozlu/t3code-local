import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { createThreadNotificationGate } from "@t3tools/client-runtime/state/thread-notification-gate";
import { RunId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import {
  observeThreadForNotification,
  threadNotificationTitle,
} from "./threadResponseNotifications.logic";

const id = ThreadId.make("thread-1");
const runId = RunId.make("run-1");

function thread(overrides: Partial<EnvironmentThreadShell> = {}) {
  return makeThreadShellFixture({ id, title: "Fix login", ...overrides });
}

const working = thread({
  runtime: { ...thread().runtime!, status: "running" },
  latestRun: {
    runId,
    status: "running",
    requestedAt: null,
    startedAt: "2026-11-23T10:00:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  },
});
const completed = thread({
  runtime: null,
  latestRun: {
    ...working.latestRun!,
    status: "completed",
    completedAt: "2026-11-23T10:01:00.000Z",
  },
});

const completedAgain = thread({
  runtime: null,
  latestRun: { ...completed.latestRun!, completedAt: "2026-11-23T10:05:00.000Z" },
});

describe("observeThreadForNotification", () => {
  it("notifies once when a watched thread's turn completes, never on first sight", () => {
    const notify = vi.fn();
    const gate = createThreadNotificationGate<ThreadId>(notify);
    const options = { archived: false, quiet: false };

    gate.observe(id, undefined, observeThreadForNotification(completed), options);
    expect(notify).not.toHaveBeenCalled();

    const busy = observeThreadForNotification(working);
    gate.observe(id, observeThreadForNotification(completed), busy, options);
    const done = observeThreadForNotification(completedAgain);
    expect(done).toMatchObject({ status: "ready", settled: true, attention: null });
    gate.observe(id, busy, done, options);
    gate.observe(id, done, observeThreadForNotification(completedAgain), options);
    expect(notify.mock.calls).toEqual([[id, "completion"]]);
  });

  it("keys a pending approval by its request, and a subagent's by run since it has no id", () => {
    const own = observeThreadForNotification(
      thread({
        ...working,
        hasPendingApprovals: true,
        source: {
          ...working.source,
          pendingRuntimeRequest: {
            ...working.source.pendingRuntimeRequest!,
            id: RuntimeRequestId.make("request-7"),
          },
        },
      }),
    );
    expect(own).toMatchObject({ status: "approval", requestId: "request-7" });
    expect(own.attention).toBe("approval:request-7");

    const subagent = observeThreadForNotification(
      thread({ ...working, pendingSubagentRequest: "approval" }),
    );
    expect(subagent).toMatchObject({ status: "approval", requestId: null });
    expect(subagent.attention).toBe("run-1:approval");
    expect(threadNotificationTitle("input", subagent.status)).toBe("Approval needed");
    expect(threadNotificationTitle("completion", "ready")).toBe("Agent replied");
  });
});
