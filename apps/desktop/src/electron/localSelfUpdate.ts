import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

/** What scripts/mac-self-update/updater.sh last wrote to its status.json. */
export const LocalUpdateStatus = Schema.Struct({
  state: Schema.Literals(["current", "building", "ready", "installed", "failed"]),
  tag: Schema.String,
  at: Schema.Number,
  message: Schema.String,
});
export type LocalUpdateStatus = typeof LocalUpdateStatus.Type;

export type LocalCheckOutcome =
  | { readonly type: "pending" }
  | { readonly type: "none" }
  | { readonly type: "available"; readonly version: string }
  | { readonly type: "failed"; readonly message: string };

export type LocalDownloadOutcome =
  | { readonly type: "pending" }
  | { readonly type: "downloaded"; readonly version: string }
  | { readonly type: "failed"; readonly message: string };

const versionOf = (tag: string) => tag.replace(/^v/, "");

const newer = (tag: string, appVersion: string) =>
  tag !== "" && compareSemverVersions(versionOf(tag), appVersion) > 0;

/**
 * A check asks the updater to run, then reads the status it writes. A build already under way
 * answers at once: it holds the updater's lock, so the requested run never writes.
 */
export function localCheckOutcome(
  status: LocalUpdateStatus | null,
  appVersion: string,
  requestedAt: number,
): LocalCheckOutcome {
  if (status === null) return { type: "pending" };
  if (status.state === "building" && newer(status.tag, appVersion)) {
    return { type: "available", version: versionOf(status.tag) };
  }
  if (status.at < requestedAt) return { type: "pending" };
  switch (status.state) {
    case "failed":
      return { type: "failed", message: status.message || "The update build failed." };
    case "ready":
      return newer(status.tag, appVersion)
        ? { type: "available", version: versionOf(status.tag) }
        : { type: "none" };
    default:
      return { type: "none" };
  }
}

/** A download waits for the updater's build of the offered tag. */
export function localDownloadOutcome(
  status: LocalUpdateStatus | null,
  appVersion: string,
): LocalDownloadOutcome {
  if (status?.state === "building") return { type: "pending" };
  if (status?.state === "failed") {
    return { type: "failed", message: status.message || "The update build failed." };
  }
  if (status?.state === "ready" && newer(status.tag, appVersion)) {
    return { type: "downloaded", version: versionOf(status.tag) };
  }
  return { type: "failed", message: "No update is being built. Check for updates again." };
}
