import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CommandCenterService from "./CommandCenterService.ts";

const scratch = ProjectId.make("project:scratch");
const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "claude-haiku" };

describe("CommandCenterService", () => {
  it.effect("keeps one live main thread and starts another once it is archived", () =>
    Effect.gen(function* () {
      const launched = yield* Ref.make<ReadonlyArray<ThreadLaunch.ThreadLaunchInput>>([]);
      const archived = yield* Ref.make(new Set<ThreadId>());
      const layer = CommandCenterService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeServices.layer,
            NodeCrypto.layer,
            Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
              namedProjectsRoot: "/projects",
              ensureScratchProject: Effect.succeed({ projectId: scratch }),
            }),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: (threadId) =>
                Ref.get(archived).pipe(
                  Effect.map(
                    (gone) =>
                      ({
                        id: threadId,
                        projectId: scratch,
                        deletedAt: null,
                        archivedAt: gone.has(threadId) ? DateTime.makeUnsafe(0) : null,
                      }) as never,
                  ),
                ),
            }),
            Layer.mock(ThreadLaunch.ThreadLaunchService)({
              launch: (input) =>
                Ref.update(launched, (seen) => [...seen, input]).pipe(
                  Effect.as({ threadId: input.threadId! } as never),
                ),
            }),
          ),
        ),
        Layer.provideMerge(
          ServerSettings.layerTest({ commandCenter: { instructions: "Prefer Haiku." } }),
        ),
      );
      yield* Effect.gen(function* () {
        const service = yield* CommandCenterService.CommandCenterService;
        const first = yield* service.ensureThread({ modelSelection });
        const again = yield* service.ensureThread({ modelSelection });
        assert.deepStrictEqual(again, first);
        const [launch] = yield* Ref.get(launched);
        assert.strictEqual(launch?.projectId, scratch);
        assert.strictEqual(launch?.runtimeMode, "full-access");
        assert.include(launch?.initialMessage?.text, "Prefer Haiku.");

        yield* Ref.update(archived, (gone) => new Set([...gone, first.threadId]));
        const replaced = yield* service.ensureThread({ modelSelection });
        assert.notStrictEqual(replaced.threadId, first.threadId);
        assert.lengthOf(yield* Ref.get(launched), 2);
        const settings = yield* ServerSettings.ServerSettingsService;
        assert.strictEqual((yield* settings.getSettings).commandCenter.threadId, replaced.threadId);
      }).pipe(Effect.provide(layer));
    }),
  );
});
