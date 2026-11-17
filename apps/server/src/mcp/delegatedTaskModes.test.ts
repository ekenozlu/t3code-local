import { type AgentProfile, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyAgentProfile } from "./delegatedTaskModes.ts";

const releaser: AgentProfile = {
  id: "agent-release",
  name: "Release",
  description: "Cuts releases.",
  instructions: "Follow RELEASING.md.",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-haiku" },
  runtimeMode: "auto-accept-edits",
  interactionMode: null,
  isolation: "worktree",
};

describe("applyAgentProfile", () => {
  it.effect("fills what the caller left out, and the caller's fields win", () =>
    Effect.gen(function* () {
      const applied = yield* applyAgentProfile({ task: "Ship 1.2.", agent: "release" }, [releaser]);
      assert.deepStrictEqual(applied, {
        task: "Follow RELEASING.md.\n\nShip 1.2.",
        title: "Release",
        target: { providerInstanceId: releaser.modelSelection!.instanceId, model: "claude-haiku" },
        runtimeMode: "auto-accept-edits",
        interactionMode: undefined,
        isolation: "worktree",
      });

      const overridden = yield* applyAgentProfile(
        {
          task: "Ship 1.2.",
          agent: "agent-release",
          title: "Ship",
          target: { model: "claude-opus", projectId: ProjectId.make("project:app") },
          runtimeMode: "approval-required",
          isolation: "shared",
        },
        [releaser],
      );
      // Naming a model drops the agent's whole selection, so its instance cannot mismatch.
      assert.deepStrictEqual(overridden.target, {
        model: "claude-opus",
        projectId: ProjectId.make("project:app"),
      });
      assert.strictEqual(overridden.title, "Ship");
      assert.strictEqual(overridden.runtimeMode, "approval-required");
      assert.strictEqual(overridden.isolation, "shared");
    }),
  );

  it.effect("an unknown agent fails with the saved names", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        applyAgentProfile({ task: "Fix it.", agent: "Bugs" }, [releaser]),
      );
      assert.strictEqual(error.code, "invalid_request");
      assert.include(error.message, "Saved agents: Release.");
    }),
  );
});
