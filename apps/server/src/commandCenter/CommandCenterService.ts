import {
  CommandId,
  type ProjectId,
  ServerEnsureCommandCenterThreadError,
  type ServerEnsureCommandCenterThreadInput,
  type ServerEnsureCommandCenterThreadResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import { commandCenterBrief, operationCenterBrief } from "./brief.ts";

type Center = NonNullable<ServerEnsureCommandCenterThreadInput["center"]>;

const CENTERS = {
  command: { settingsKey: "commandCenter", title: "Command Center", brief: commandCenterBrief },
  operations: {
    settingsKey: "operationCenter",
    title: "Operation Center",
    brief: operationCenterBrief,
  },
} as const;

/** The Command and Operation Centers' main agent threads, which live in Scratch. */
export class CommandCenterService extends Context.Service<
  CommandCenterService,
  {
    /** The newest unsettled main agent thread, or a new one in Scratch when asked or none is. */
    readonly ensureThread: (
      input: ServerEnsureCommandCenterThreadInput,
    ) => Effect.Effect<ServerEnsureCommandCenterThreadResult, ServerEnsureCommandCenterThreadError>;
  }
>()("t3/commandCenter/CommandCenterService") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const random = yield* SecureRandom.SecureRandom;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Two clients opening it at once would each start a thread.
  const lock = yield* Semaphore.make(1);

  const failed = (detail: string) => (cause: unknown) =>
    new ServerEnsureCommandCenterThreadError({ detail, cause });

  const remember = (center: Center, threadIds: ReadonlyArray<ThreadId>) =>
    settings
      .updateSettings(
        center === "operations"
          ? { operationCenter: { threadIds } }
          : { commandCenter: { threadIds } },
      )
      .pipe(Effect.asVoid, Effect.mapError(failed("settings")));

  // Every provider reads these from its working folder, so the brief needs no visible message.
  const writeBrief = (center: Center, folder: string | null, instructions: string) =>
    folder === null
      ? Effect.void
      : Effect.all([
          fileSystem.writeFileString(
            path.join(folder, "AGENTS.md"),
            `${CENTERS[center].brief(instructions)}\n`,
          ),
          fileSystem.writeFileString(path.join(folder, "CLAUDE.md"), "@AGENTS.md\n"),
        ]).pipe(Effect.asVoid, Effect.mapError(failed("the main agent's brief")));

  const ensureThread: CommandCenterService["Service"]["ensureThread"] = Effect.fn(
    "CommandCenterService.ensureThread",
  )(function* (input) {
    const center = input.center ?? "command";
    const { settingsKey, title } = CENTERS[center];
    const current = (yield* settings.getSettings.pipe(Effect.mapError(failed("settings"))))[
      settingsKey
    ];
    const kept: Array<ThreadId> = [];
    let open: { threadId: ThreadId; projectId: ProjectId; worktreePath: string | null } | undefined;
    for (const threadId of current.threadIds) {
      const shell = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(failed("thread lookup")));
      if (shell === null || shell.deletedAt !== null) continue;
      kept.push(threadId);
      if (shell.archivedAt === null && shell.settledAt === null) {
        open = { threadId: shell.id, projectId: shell.projectId, worktreePath: shell.worktreePath };
      }
    }
    if (input.startNew !== true && open !== undefined) {
      if (kept.length !== current.threadIds.length) yield* remember(center, kept);
      yield* writeBrief(center, open.worktreePath, current.instructions);
      return { threadId: open.threadId, projectId: open.projectId };
    }
    const { projectId } = yield* folders.ensureScratchProject.pipe(
      Effect.mapError(failed("the Scratch project")),
    );
    const id = yield* random.uuidV4().pipe(Effect.mapError(failed("an id")));
    const launched = yield* launches
      .launch({
        commandId: CommandId.make(`command:${center}-center:${id}`),
        threadId: ThreadId.make(`thread:${center}-center:${id}`),
        projectId,
        title,
        modelSelection: input.modelSelection,
        // Its tasks run at most at its own modes.
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(failed("the main agent's thread")));
    yield* writeBrief(center, launched.projection.thread.worktreePath, current.instructions);
    yield* remember(center, [...kept, launched.threadId]);
    return { threadId: launched.threadId, projectId };
  }, lock.withPermits(1));

  return CommandCenterService.of({ ensureThread });
});

export const layer = Layer.effect(CommandCenterService, make);
