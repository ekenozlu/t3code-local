import {
  CommandId,
  MessageId,
  ServerEnsureCommandCenterThreadError,
  type ServerEnsureCommandCenterThreadInput,
  type ServerEnsureCommandCenterThreadResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import { commandCenterFirstMessage } from "./brief.ts";

/** The Command Center's one main agent thread, which delegates work to saved agents across projects. */
export class CommandCenterService extends Context.Service<
  CommandCenterService,
  {
    /** The main agent's thread, started in Scratch when there is none or it was archived or deleted. */
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
  // Two clients opening it at once would each start a thread.
  const lock = yield* Semaphore.make(1);

  const failed = (detail: string) => (cause: unknown) =>
    new ServerEnsureCommandCenterThreadError({ detail, cause });

  const ensureThread: CommandCenterService["Service"]["ensureThread"] = Effect.fn(
    "CommandCenterService.ensureThread",
  )(function* (input) {
    const current = yield* settings.getSettings.pipe(Effect.mapError(failed("settings")));
    const existingId = current.commandCenter.threadId;
    if (existingId !== null) {
      const shell = yield* threads
        .getThreadShell(existingId)
        .pipe(Effect.mapError(failed("thread lookup")));
      if (shell !== null && shell.deletedAt === null && shell.archivedAt === null) {
        return { threadId: shell.id, projectId: shell.projectId };
      }
    }
    const { projectId } = yield* folders.ensureScratchProject.pipe(
      Effect.mapError(failed("the Scratch project")),
    );
    const id = yield* random.uuidV4().pipe(Effect.mapError(failed("an id")));
    const launched = yield* launches
      .launch({
        commandId: CommandId.make(`command:command-center:${id}`),
        threadId: ThreadId.make(`thread:command-center:${id}`),
        projectId,
        title: "Command Center",
        modelSelection: input.modelSelection,
        // Its tasks run at most at its own modes.
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        initialMessage: {
          messageId: MessageId.make(`message:command-center:${id}`),
          text: commandCenterFirstMessage(current.commandCenter.instructions),
          attachments: [],
        },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(failed("the main agent's thread")));
    yield* settings
      .updateSettings({ commandCenter: { threadId: launched.threadId } })
      .pipe(Effect.mapError(failed("settings")));
    return { threadId: launched.threadId, projectId };
  }, lock.withPermits(1));

  return CommandCenterService.of({ ensureThread });
});

export const layer = Layer.effect(CommandCenterService, make);
