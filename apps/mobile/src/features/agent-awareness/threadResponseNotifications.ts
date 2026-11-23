import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import { createThreadNotificationGate } from "@t3tools/client-runtime/state/thread-notification-gate";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Notifications from "expo-notifications";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { AppState, Platform } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { encodeThreadDeepLink } from "./notificationPayload";
import { getAgentAwarenessRegistrationStatus } from "./remoteRegistration";
import {
  observeThreadForNotification,
  threadNotificationTitle,
  type ThreadResponseObservation,
} from "./threadResponseNotifications.logic";

interface ObservedThread {
  readonly raw: OrchestrationV2ThreadShell;
  readonly title: string;
  readonly observation: ThreadResponseObservation;
}

interface WatchedEnvironment {
  readonly unsubscribe: () => void;
}

let deepLinkOnScreen: string | null = null;
// Delivered notification ids by thread deep link, so opening the thread clears its banner.
const deliveredByDeepLink = new Map<string, string>();

const notificationIdentifier = (deepLink: string) => `thread-response:${deepLink}`;

/** Called with the thread deep link on screen, or null, on every navigation change. */
export function setThreadResponseNotificationScreen(deepLink: string | null): void {
  deepLinkOnScreen = deepLink;
  if (deepLink === null) return;
  const identifier = deliveredByDeepLink.get(deepLink);
  if (identifier === undefined) return;
  deliveredByDeepLink.delete(deepLink);
  void Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
}

function present(
  environmentId: EnvironmentId,
  thread: ObservedThread,
  kind: "input" | "completion",
): void {
  // A device registered with T3 Connect already gets these as remote pushes.
  if (getAgentAwarenessRegistrationStatus() === "registered") return;
  const deepLink = encodeThreadDeepLink({ environmentId, threadId: thread.raw.id });
  if (deepLink === null) return;
  if (AppState.currentState === "active" && deepLink === deepLinkOnScreen) return;
  const identifier = notificationIdentifier(deepLink);
  deliveredByDeepLink.set(deepLink, identifier);
  void Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: threadNotificationTitle(kind, thread.observation.status),
      body: thread.title,
      data: { environmentId, threadId: thread.raw.id, deepLink },
      sound: "default",
    },
    trigger: Platform.OS === "android" ? { channelId: "agent-alerts" } : null,
  }).catch((error: unknown) => {
    console.warn("[thread-response-notifications] schedule failed", error);
  });
}

function watchEnvironment(environmentId: EnvironmentId): WatchedEnvironment {
  let previous = new Map<ThreadId, ObservedThread>();
  let reconnecting = false;
  const gate = createThreadNotificationGate<ThreadId>((threadId, kind) => {
    const thread = previous.get(threadId);
    if (thread) present(environmentId, thread, kind);
  });

  const observe = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) => {
    const hidden = appAtomRegistry.get(environmentThreadShells.hiddenThreadKeysAtom);
    const delegatedUnderParent = appAtomRegistry.get(
      environmentThreadShells.delegatedUnderParentAtom,
    );
    const subagentRequests = appAtomRegistry.get(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
    );
    const next = new Map<ThreadId, ObservedThread>();
    const changed: Array<[ObservedThread | undefined, ObservedThread]> = [];
    for (const raw of threads) {
      const ref = { environmentId, threadId: raw.id };
      // Delegated tasks report through their parent, and hidden threads stay quiet.
      if (isShownUnderParent(ref, raw.lineage, delegatedUnderParent)) continue;
      if (hidden.has(threadKey(ref))) continue;
      const prior = previous.get(raw.id);
      if (!reconnecting && prior?.raw === raw) {
        next.set(raw.id, prior);
        continue;
      }
      const shell = presentThreadShell(environmentId, raw, subagentRequests.get(raw.id) ?? null);
      const state = { raw, title: shell.title, observation: observeThreadForNotification(shell) };
      next.set(raw.id, state);
      changed.push([prior, state]);
    }
    reconnecting = false;
    previous = next;
    gate.retain(new Set(next.keys()));
    for (const [prior, state] of changed) {
      gate.observe(state.raw.id, prior?.observation, state.observation, {
        archived: state.raw.archivedAt !== null,
        quiet: state.raw.latestRunStopRequested === true,
      });
    }
  };

  const unsubscribe = appAtomRegistry.subscribe(
    environmentShell.stateValueAtom(environmentId),
    (shell) => {
      if (shell.status === "live" && Option.isSome(shell.snapshot)) {
        observe(shell.snapshot.value.threads);
        return;
      }
      reconnecting = true;
      gate.pause();
    },
    { immediate: true },
  );
  return {
    unsubscribe: () => {
      unsubscribe();
      gate.clear();
    },
  };
}

/**
 * Local notifications for thread responses: an agent finishing a turn, asking a question, or
 * waiting on an approval. They come from the live connection, so they reach the device while
 * the app runs or iOS still lets it finish work after backgrounding, not once it is suspended.
 */
export function installThreadResponseNotifications(): () => void {
  const watched = new Map<EnvironmentId, WatchedEnvironment>();
  let enabled = false;

  const sync = () => {
    const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
    const ids = enabled && catalog.isReady ? [...enabledEnvironmentIds(catalog)] : [];
    const active = new Set(ids);
    for (const [environmentId, entry] of watched) {
      if (active.has(environmentId)) continue;
      entry.unsubscribe();
      watched.delete(environmentId);
    }
    for (const environmentId of ids) {
      if (!watched.has(environmentId)) watched.set(environmentId, watchEnvironment(environmentId));
    }
  };

  const unsubscribePreferences = appAtomRegistry.subscribe(
    mobilePreferencesAtom,
    (result) => {
      enabled =
        AsyncResult.isSuccess(result) && result.value.threadResponseNotificationsEnabled === true;
      sync();
    },
    { immediate: true },
  );
  const unsubscribeCatalog = appAtomRegistry.subscribe(environmentCatalog.catalogValueAtom, sync);

  return () => {
    unsubscribePreferences();
    unsubscribeCatalog();
    for (const entry of watched.values()) entry.unsubscribe();
    watched.clear();
  };
}
