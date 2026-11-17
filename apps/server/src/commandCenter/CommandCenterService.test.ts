import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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
  it.effect(
    "opens the newest live main thread, starts more on request, and forgets deleted ones",
    () =>
      Effect.gen(function* () {
        const launched = yield* Ref.make<ReadonlyArray<ThreadLaunch.ThreadLaunchInput>>([]);
        const archived = yield* Ref.make(new Set<ThreadId>());
        const deleted = yield* Ref.make(new Set<ThreadId>());
        const settled = yield* Ref.make(new Set<ThreadId>());
        const fileSystem = yield* FileSystem.FileSystem;
        const folder = yield* fileSystem.makeTempDirectoryScoped();
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
                  Effect.all([Ref.get(archived), Ref.get(deleted), Ref.get(settled)]).pipe(
                    Effect.map(
                      ([shelved, gone, done]) =>
                        ({
                          id: threadId,
                          projectId: scratch,
                          worktreePath: folder,
                          deletedAt: gone.has(threadId) ? DateTime.makeUnsafe(0) : null,
                          archivedAt: shelved.has(threadId) ? DateTime.makeUnsafe(0) : null,
                          settledAt: done.has(threadId) ? DateTime.makeUnsafe(0) : null,
                        }) as never,
                    ),
                  ),
              }),
              Layer.mock(ThreadLaunch.ThreadLaunchService)({
                launch: (input) =>
                  Ref.update(launched, (seen) => [...seen, input]).pipe(
                    Effect.as({
                      threadId: input.threadId!,
                      projection: { thread: { worktreePath: folder } },
                    } as never),
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
          assert.isUndefined(launch?.initialMessage);
          assert.include(yield* fileSystem.readFileString(`${folder}/AGENTS.md`), "Prefer Haiku.");
          assert.strictEqual(
            yield* fileSystem.readFileString(`${folder}/CLAUDE.md`),
            "@AGENTS.md\n",
          );

          const second = yield* service.ensureThread({ modelSelection, startNew: true });
          assert.notStrictEqual(second.threadId, first.threadId);
          assert.deepStrictEqual(yield* service.ensureThread({ modelSelection }), second);

          yield* Ref.update(settled, (done) => new Set([...done, second.threadId]));
          assert.deepStrictEqual(yield* service.ensureThread({ modelSelection }), first);

          yield* Ref.update(deleted, (gone) => new Set([...gone, first.threadId]));
          const third = yield* service.ensureThread({ modelSelection });
          assert.lengthOf(yield* Ref.get(launched), 3);
          const settings = yield* ServerSettings.ServerSettingsService;
          assert.deepStrictEqual((yield* settings.getSettings).commandCenter.threadIds, [
            second.threadId,
            third.threadId,
          ]);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
