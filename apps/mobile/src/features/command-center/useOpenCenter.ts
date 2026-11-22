import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";
import { CENTER_LABELS, type Center } from "./centers";

/**
 * Opens a center's newest unsettled thread on a machine, or starts one with its default model,
 * as the web sidebar does.
 */
export function useOpenCenter() {
  const configs = useServerConfigs();
  const selectDetail = useSelectWorkspaceDetail();
  const ensure = useAtomCommand(serverEnvironment.ensureCommandCenterThread, {
    reportFailure: false,
  });
  return async (
    environmentId: EnvironmentId,
    options: { readonly center: Center; readonly startNew?: boolean },
  ) => {
    const fail = (detail: string) =>
      Dialog.alert(`Could not open the ${CENTER_LABELS[options.center]}`, detail);
    const modelSelection = scheduledTaskDefaultModel(configs.get(environmentId) ?? null, null);
    if (modelSelection === null) return fail("Set up a provider in Settings → Providers first.");
    const result = await ensure({
      environmentId,
      input: { modelSelection, startNew: options.startNew === true, center: options.center },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      return fail(error instanceof Error ? error.message : "An error occurred.");
    }
    selectDetail({
      name: "Thread",
      params: { environmentId: String(environmentId), threadId: String(result.value.threadId) },
    });
  };
}
