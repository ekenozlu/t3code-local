import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnyRouter } from "@tanstack/react-router";

import { toastManager } from "~/components/ui/toast";
import { resolveDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readPrimaryEnvironmentId } from "~/state/environments";
import {
  primaryServerProvidersAtom,
  primaryServerSettingsAtom,
  serverEnvironment,
} from "~/state/server";
import { buildThreadRouteParams } from "~/threadRoutes";

const fail = (description: string) =>
  toastManager.add({ type: "error", title: "Could not open the Command Center", description });

/**
 * Opens the newest main agent thread on this server, or starts one with the
 * default model. Shared by the sidebar, the palette and its shortcut.
 */
export async function openCommandCenter(
  router: Pick<AnyRouter, "navigate">,
  options: { readonly startNew?: boolean } = {},
) {
  const environmentId = readPrimaryEnvironmentId();
  if (environmentId === null) return fail("Connect to a T3 Code server first.");
  const modelSelection = resolveDefaultProviderModelSelection(
    appAtomRegistry.get(primaryServerProvidersAtom),
    appAtomRegistry.get(primaryServerSettingsAtom).defaultModelSelection,
  );
  if (modelSelection === null) return fail("Set up a provider in Settings → Providers first.");
  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.ensureCommandCenterThread,
    { environmentId, input: { modelSelection, startNew: options.startNew === true } },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    return fail(error instanceof Error ? error.message : "An error occurred.");
  }
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value.threadId)),
  });
}
