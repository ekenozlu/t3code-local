import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ServerConfig, ServerSettings, ThreadId } from "@t3tools/contracts";

export type Center = "command" | "operations";

export const CENTERS: ReadonlyArray<Center> = ["command", "operations"];

export const CENTER_LABELS: Record<Center, string> = {
  command: "Command Center",
  operations: "Operation Center",
};

export const centerThreadIds = (settings: ServerSettings, center: Center): readonly ThreadId[] =>
  center === "operations" ? settings.operationCenter.threadIds : settings.commandCenter.threadIds;

/**
 * Splits off each environment's Command and Operation Center threads, which Home lists in its
 * own section instead of under the Scratch project they live in.
 */
export function partitionCenterThreads<T extends EnvironmentThreadShell>(
  threads: readonly T[],
  configs: ReadonlyMap<EnvironmentId, Pick<ServerConfig, "settings">>,
): { readonly listed: readonly T[]; readonly centers: ReadonlyMap<string, Center> } {
  const centers = new Map<string, Center>();
  for (const [environmentId, config] of configs) {
    for (const center of CENTERS) {
      for (const threadId of centerThreadIds(config.settings, center)) {
        centers.set(`${environmentId}\u0000${threadId}`, center);
      }
    }
  }
  if (centers.size === 0) return { listed: threads, centers };
  return {
    listed: threads.filter((thread) => !centers.has(`${thread.environmentId}\u0000${thread.id}`)),
    centers,
  };
}

export const centerOf = (
  centers: ReadonlyMap<string, Center>,
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
): Center | undefined => centers.get(`${thread.environmentId}\u0000${thread.id}`);
