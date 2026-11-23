import { Atom } from "effect/reactivity";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import {
  createOutdatedServerDescriptionCommand,
  createOutdatedServerUpdateCommand,
} from "@t3tools/client-runtime/state/outdatedServerUpdate";
import { createEnvironmentServerConfigsAtom } from "@t3tools/client-runtime/state/shell";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSession } from "./session";

export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
  usageLimitSources: true,
  usageLimitsCommand: true,
  providerCatalogsOnDemand: true,
  providerCatalogDigests: true,
  providerStatusDeltas: true,
  omitRefreshedProviders: true,
});
export const describeOutdatedServer = createOutdatedServerDescriptionCommand(connectionAtomRuntime);
export const updateOutdatedServer = createOutdatedServerUpdateCommand(connectionAtomRuntime);
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

/**
 * Command and Operation Center threads as `environmentId:threadId<TAB>center` lines. A string
 * keeps lists from rebuilding on every settings push that leaves the centers alone.
 */
export const centerThreadKeyLinesAtom = Atom.make((get) => {
  const lines: string[] = [];
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    for (const threadId of config.settings.commandCenter.threadIds) {
      lines.push(`${environmentId}:${threadId}\tcommand`);
    }
    for (const threadId of config.settings.operationCenter.threadIds) {
      lines.push(`${environmentId}:${threadId}\toperations`);
    }
  }
  return lines.join("\n");
}).pipe(Atom.withLabel("mobile-center-thread-keys"));
