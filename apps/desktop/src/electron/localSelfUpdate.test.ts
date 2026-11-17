import { describe, expect, it } from "vite-plus/test";

import {
  type LocalUpdateStatus,
  localCheckOutcome,
  localDownloadOutcome,
} from "./localSelfUpdate.ts";

const status = (
  state: LocalUpdateStatus["state"],
  tag: string,
  at = 100,
  message = "",
): LocalUpdateStatus => ({ state, tag, at, message });

describe("localCheckOutcome", () => {
  it.each([
    ["no status yet", null, { type: "pending" }],
    ["an answer from before the request", status("current", "v0.1.10", 50), { type: "pending" }],
    ["the running version", status("current", "v0.1.10"), { type: "none" }],
    ["a newer ready build", status("ready", "v0.1.11"), { type: "available", version: "0.1.11" }],
    ["a ready build that is not newer", status("ready", "v0.1.10"), { type: "none" }],
    [
      "a build already under way, however old",
      status("building", "v0.1.11", 1),
      { type: "available", version: "0.1.11" },
    ],
    [
      "a failed build",
      status("failed", "v0.1.11", 100, "Boom"),
      { type: "failed", message: "Boom" },
    ],
  ] as const)("%s", (_, current, expected) => {
    expect(localCheckOutcome(current, "0.1.10", 100)).toEqual(expected);
  });
});

describe("localDownloadOutcome", () => {
  it.each([
    ["while building", status("building", "v0.1.11"), { type: "pending" }],
    ["once ready", status("ready", "v0.1.11"), { type: "downloaded", version: "0.1.11" }],
    [
      "after a failure",
      status("failed", "v0.1.11", 1, "Boom"),
      { type: "failed", message: "Boom" },
    ],
  ] as const)("%s", (_, current, expected) => {
    expect(localDownloadOutcome(current, "0.1.10")).toEqual(expected);
  });

  it("fails when nothing newer is being built", () => {
    expect(localDownloadOutcome(status("current", "v0.1.10"), "0.1.10").type).toBe("failed");
  });
});
