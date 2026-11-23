import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  ThreadNotificationKind,
  ThreadNotificationObservation,
} from "@t3tools/client-runtime/state/thread-notification-gate";
import { monitorHoldsWakeCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

import { resolveThreadListV2Status, type ThreadListV2Status } from "../threads/threadListV2";

export interface ThreadResponseObservation extends ThreadNotificationObservation {
  readonly status: ThreadListV2Status;
}

/** What the notification gate needs to know about one thread, as the desktop coordinator reads it. */
export function observeThreadForNotification(
  thread: EnvironmentThreadShell,
): ThreadResponseObservation {
  let status = resolveThreadListV2Status(thread);
  if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
  const needsAttention =
    status === "input" ||
    status === "request" ||
    status === "approval" ||
    status === "failed" ||
    status === "limited";
  // A subagent's request is known only by kind, so it never borrows the parent's request id.
  const ownRequest =
    (status === "approval" && thread.hasPendingApprovals) ||
    (status === "input" && thread.hasPendingUserInput);
  const requestId =
    needsAttention && ownRequest ? (thread.source.pendingRuntimeRequest?.id ?? null) : null;
  const attention = !needsAttention
    ? null
    : requestId !== null
      ? `${status}:${requestId}`
      : `${thread.latestRun?.runId ?? ""}:${status}`;
  const completed = status === "ready" && thread.latestRun?.status === "completed";
  const settled = completed && !monitorHoldsWakeCompletion(thread.source);
  const parsedCompletedAt = Date.parse(thread.latestRun?.completedAt ?? "");
  const completedAt = settled && Number.isFinite(parsedCompletedAt) ? parsedCompletedAt : null;
  return {
    status,
    attention,
    requestId,
    settled,
    completedAt,
    backgroundWake: thread.source.latestRunBackgroundWake === true,
  };
}

export function threadNotificationTitle(
  kind: ThreadNotificationKind,
  status: ThreadListV2Status,
): string {
  if (kind === "completion") return "Agent replied";
  switch (status) {
    case "approval":
      return "Approval needed";
    case "limited":
      return "Usage limit reached";
    case "failed":
      return "Thread failed";
    case "request":
      return "Guest request";
    default:
      return "Input needed";
  }
}
