import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { partitionCenterThreads } from "./centers";

it("moves each machine's own center threads out of the Home list", () => {
  const local = EnvironmentId.make("environment-local");
  const remote = EnvironmentId.make("environment-remote");
  const command = ThreadId.make("thread:command-center:1");
  const operations = ThreadId.make("thread:operations-center:1");
  const plain = ThreadId.make("thread:plain");
  const configs = new Map([
    [
      local,
      {
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          commandCenter: { threadIds: [command], instructions: "" },
          operationCenter: { threadIds: [operations], instructions: "" },
        },
      },
    ],
    [remote, { settings: DEFAULT_SERVER_SETTINGS }],
  ]);
  const threads = [
    makeThreadShellFixture({ environmentId: local, id: command }),
    makeThreadShellFixture({ environmentId: local, id: operations }),
    makeThreadShellFixture({ environmentId: local, id: plain }),
    // The same id on another machine is not that machine's center thread.
    makeThreadShellFixture({ environmentId: remote, id: command }),
  ];

  const { listed, centers } = partitionCenterThreads(threads, configs);

  expect(listed.map((thread) => [thread.environmentId, thread.id])).toEqual([
    [local, plain],
    [remote, command],
  ]);
  expect([...centers.values()]).toEqual(["command", "operations"]);
});
