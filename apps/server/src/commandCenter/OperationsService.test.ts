import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as OperationsService from "./OperationsService.ts";

const DAY = 24 * 60 * 60 * 1000;
const center = ThreadId.make("thread:command-center:1");
const jobThread = ThreadId.make("thread:job");
const at = (days: number) => DateTime.makeUnsafe(days * DAY);

const task = (fields: object) =>
  ({
    origin: "app_owned",
    childThreadId: null,
    title: null,
    model: "claude-haiku",
    status: "completed",
    startedAt: null,
    completedAt: null,
    updatedAt: at(10),
    ...fields,
  }) as never;

const records: Record<string, object> = {
  [center]: {
    subagents: [
      task({
        status: "failed",
        startedAt: at(9),
        completedAt: at(9.5),
        remoteChild: { threadId: jobThread, label: "web", title: "Fix login", agent: "Bug fixer" },
      }),
      // Older than the window.
      task({ startedAt: at(1), completedAt: at(1.1) }),
      task({ origin: "provider_native", startedAt: at(9) }),
    ],
  },
  [jobThread]: {
    runs: [{}, {}],
    providerTurns: [
      { turnTokenUsage: { inputTokens: 100, outputTokens: 20 } },
      { turnTokenUsage: { inputTokens: 50, outputTokens: 5 } },
      {},
    ],
    messages: [{ role: "user", senderThreadId: center }, { role: "assistant" }, { role: "user" }],
  },
};

const bugFixer = {
  id: "bug-fixer",
  name: "Bug fixer",
  description: "Fixes bugs.",
  instructions: "Reproduce first.",
  modelSelection: null,
  runtimeMode: null,
  interactionMode: null,
  isolation: "worktree" as const,
};

const layer = OperationsService.layer.pipe(
  Layer.provide(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadRecords: (threadId) =>
        records[threadId] === undefined
          ? Effect.die("unknown thread")
          : Effect.succeed(records[threadId] as never),
    }),
  ),
  Layer.provideMerge(
    ServerSettings.layerTest({
      commandCenter: { threadIds: [center], instructions: "" },
      agentProfiles: [bugFixer],
    }),
  ),
);

describe("OperationsService", () => {
  it.effect(
    "reads the Command Center's jobs in the window with their tokens and interventions",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(10 * DAY);
        const operations = yield* OperationsService.OperationsService;
        const { jobs } = yield* operations.metrics({ sinceDays: 7 });
        assert.deepStrictEqual(jobs, [
          {
            commandCenterThreadId: center,
            threadId: jobThread,
            title: "Fix login",
            agent: "Bug fixer",
            project: "web",
            model: "claude-haiku",
            status: "failed",
            startedAt: DateTime.formatIso(at(9)),
            completedAt: DateTime.formatIso(at(9.5)),
            durationMs: DAY / 2,
            inputTokens: 150,
            outputTokens: 25,
            turns: 2,
            interventions: 1,
          },
        ]);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "applies an approved change to an agent and the guidance, and refuses unknown agents",
    () =>
      Effect.gen(function* () {
        const operations = yield* OperationsService.OperationsService;
        const model = { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet" };
        const result = yield* operations.apply({
          agent: {
            name: "bug FIXER",
            instructions: "Write a failing test first.",
            modelSelection: model,
          },
          commandCenterGuidance: "web is Next.js.",
        });
        assert.deepStrictEqual(result.applied, [
          "Bug fixer: instructions",
          "Bug fixer: model",
          "Command Center guidance",
        ]);
        const saved = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
        assert.strictEqual(saved.agentProfiles[0]?.instructions, "Write a failing test first.");
        assert.deepStrictEqual(saved.agentProfiles[0]?.modelSelection, model);
        assert.strictEqual(saved.agentProfiles[0]?.description, "Fixes bugs.");
        assert.strictEqual(saved.commandCenter.instructions, "web is Next.js.");

        const unknown = yield* operations
          .apply({ agent: { name: "Release", instructions: "x" } })
          .pipe(Effect.flip);
        assert.include(unknown.message, "Saved agents: Bug fixer.");
      }).pipe(Effect.provide(layer)),
  );
});
