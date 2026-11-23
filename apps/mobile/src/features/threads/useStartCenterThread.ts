import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";
import { THREAD_LIST_V2_CENTERS, type ThreadListV2Center } from "./threadListV2";

/** Connected servers that can start a center thread, limited to the list's environment filter. */
export function useCenterEnvironmentIds(environmentId: EnvironmentId | null) {
  const connected = useAtomValue(connectedEnvironmentIdsAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  return connected.filter(
    (id) => configs.has(id) && (environmentId === null || id === environmentId),
  );
}

/**
 * Starts another Command or Operation Center thread with the server's default model, as the
 * desktop sidebar's + does, then opens it. With several servers it asks which one.
 */
export function useStartCenterThread(input: {
  readonly environmentId: EnvironmentId | null;
  readonly onOpenThread: (ref: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }) => void;
}) {
  const environmentIds = useCenterEnvironmentIds(input.environmentId);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const { savedConnectionsById } = useSavedRemoteConnections();
  const ensureThread = useAtomCommand(serverEnvironment.ensureCommandCenterThread, {
    reportFailure: false,
  });
  const [starting, setStarting] = useState<ThreadListV2Center | null>(null);

  const startOn = async (center: ThreadListV2Center, environmentId: EnvironmentId) => {
    const title = THREAD_LIST_V2_CENTERS.find((entry) => entry.center === center)?.title ?? "";
    const modelSelection = scheduledTaskDefaultModel(configs.get(environmentId) ?? null, null);
    if (modelSelection === null) {
      Dialog.alert(`Could not start the ${title}`, "Set up a provider on this server first.");
      return;
    }
    setStarting(center);
    const result = await ensureThread({
      environmentId,
      input: { modelSelection, startNew: true, center },
    });
    setStarting(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        `Could not start the ${title}`,
        error instanceof Error ? error.message : "An error occurred.",
      );
      return;
    }
    input.onOpenThread({ environmentId, threadId: result.value.threadId });
  };

  const start = (center: ThreadListV2Center) => {
    if (starting !== null) return;
    const [only] = environmentIds;
    if (only === undefined) {
      Dialog.alert("No server connected", "Connect to a T3 Code server first.");
      return;
    }
    if (environmentIds.length === 1) {
      void startOn(center, only);
      return;
    }
    const title = THREAD_LIST_V2_CENTERS.find((entry) => entry.center === center)?.title ?? "";
    Dialog.alert(`New ${title} thread`, "Which server should run it?", [
      ...environmentIds.map((environmentId) => ({
        text: savedConnectionsById[environmentId]?.environmentLabel ?? String(environmentId),
        onPress: () => void startOn(center, environmentId),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return { start, starting, available: environmentIds.length > 0 };
}
