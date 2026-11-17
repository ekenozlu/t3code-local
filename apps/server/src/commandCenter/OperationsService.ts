import {
  type AgentProfile,
  type OperationsApplyInput,
  type OperationsApplyResult,
  type OperationsJob,
  type OperationsMetrics,
  OperationsMetricsError,
  type OperationsMetricsInput,
  OrchestratorMcpFailure,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the Operation Center reads about the Command Center's jobs, and the changes it applies. */
export class OperationsService extends Context.Service<
  OperationsService,
  {
    readonly metrics: (
      input: OperationsMetricsInput,
    ) => Effect.Effect<OperationsMetrics, OperationsMetricsError>;
    readonly apply: (
      input: OperationsApplyInput,
    ) => Effect.Effect<OperationsApplyResult, OrchestratorMcpFailure>;
  }
>()("t3/commandCenter/OperationsService") {}

const iso = (value: DateTime.Utc | null) => (value === null ? null : DateTime.formatIso(value));

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const failed = (detail: string) => (cause: unknown) =>
    new OperationsMetricsError({ detail, cause });

  /** Tokens, turns and the user's own messages on a job's thread here; zero for one elsewhere. */
  const jobThreadStats = Effect.fnUntraced(function* (threadId: ThreadId) {
    const records = yield* threads
      .getThreadRecords(threadId, ["runs", "messages", "providerTurns"])
      .pipe(Effect.orElseSucceed(() => null));
    if (records === null) return { inputTokens: 0, outputTokens: 0, turns: 0, interventions: 0 };
    let inputTokens = 0;
    let outputTokens = 0;
    for (const turn of records.providerTurns) {
      inputTokens += turn.turnTokenUsage?.inputTokens ?? 0;
      outputTokens += turn.turnTokenUsage?.outputTokens ?? 0;
    }
    return {
      inputTokens,
      outputTokens,
      turns: records.runs.length,
      // The task arrives from the Command Center's thread; anything else the user typed.
      interventions: records.messages.filter(
        (message) => message.role === "user" && message.senderThreadId === undefined,
      ).length,
    };
  });

  const toJob = Effect.fnUntraced(function* (
    commandCenterThreadId: ThreadId,
    task: OrchestrationV2Subagent,
  ) {
    const threadId = task.remoteChild?.threadId ?? task.childThreadId;
    const stats =
      threadId === null
        ? { inputTokens: 0, outputTokens: 0, turns: 0, interventions: 0 }
        : yield* jobThreadStats(threadId);
    const durationMs =
      task.startedAt === null || task.completedAt === null
        ? null
        : Math.max(
            0,
            DateTime.toEpochMillis(task.completedAt) - DateTime.toEpochMillis(task.startedAt),
          );
    return {
      commandCenterThreadId,
      threadId,
      title: task.remoteChild?.title ?? task.title ?? "Untitled job",
      agent: task.remoteChild?.agent ?? null,
      project: task.remoteChild?.label ?? "Command Center",
      model: task.model ?? task.modelSelection?.model ?? null,
      status: task.status,
      startedAt: iso(task.startedAt),
      completedAt: iso(task.completedAt),
      durationMs,
      ...stats,
    } satisfies OperationsJob;
  });

  const metrics: OperationsService["Service"]["metrics"] = Effect.fn("OperationsService.metrics")(
    function* (input) {
      const current = yield* settings.getSettings.pipe(Effect.mapError(failed("settings")));
      const since = DateTime.toEpochMillis(yield* DateTime.now) - input.sinceDays * DAY_MS;
      const jobs: Array<OperationsJob> = [];
      for (const commandCenterThreadId of current.commandCenter.threadIds) {
        const records = yield* threads
          .getThreadRecords(commandCenterThreadId, ["subagents"])
          .pipe(Effect.orElseSucceed(() => null));
        if (records === null) continue;
        for (const task of records.subagents) {
          if (task.origin !== "app_owned") continue;
          if (DateTime.toEpochMillis(task.startedAt ?? task.updatedAt) < since) continue;
          jobs.push(yield* toJob(commandCenterThreadId, task));
        }
      }
      return {
        since: DateTime.formatIso(DateTime.makeUnsafe(since)),
        jobs: jobs.toSorted((left, right) =>
          (right.startedAt ?? "").localeCompare(left.startedAt ?? ""),
        ),
      };
    },
  );

  const invalid = (message: string) =>
    new OrchestratorMcpFailure({ code: "invalid_request", message });

  const apply: OperationsService["Service"]["apply"] = Effect.fn("OperationsService.apply")(
    function* (input) {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(() => invalid("Unable to read server settings.")),
      );
      const applied: Array<string> = [];
      let agentProfiles: ReadonlyArray<AgentProfile> | undefined;
      if (input.agent !== undefined) {
        const change = input.agent;
        const wanted = change.name.toLowerCase();
        const profile = current.agentProfiles.find(
          (candidate) => candidate.name.toLowerCase() === wanted,
        );
        if (profile === undefined) {
          return yield* invalid(
            `No saved agent is named "${change.name}". Saved agents: ${current.agentProfiles.map((candidate) => candidate.name).join(", ")}.`,
          );
        }
        const next: AgentProfile = {
          ...profile,
          ...(change.description === undefined ? {} : { description: change.description }),
          ...(change.instructions === undefined ? {} : { instructions: change.instructions }),
          ...(change.modelSelection === undefined ? {} : { modelSelection: change.modelSelection }),
        };
        agentProfiles = current.agentProfiles.map((candidate) =>
          candidate.id === profile.id ? next : candidate,
        );
        if (change.description !== undefined) applied.push(`${profile.name}: description`);
        if (change.instructions !== undefined) applied.push(`${profile.name}: instructions`);
        if (change.modelSelection !== undefined) applied.push(`${profile.name}: model`);
      }
      if (input.commandCenterGuidance !== undefined) applied.push("Command Center guidance");
      if (applied.length === 0) return yield* invalid("Pass `agent` or `commandCenterGuidance`.");
      yield* settings
        .updateSettings({
          ...(agentProfiles === undefined ? {} : { agentProfiles }),
          ...(input.commandCenterGuidance === undefined
            ? {}
            : { commandCenter: { instructions: input.commandCenterGuidance } }),
        })
        .pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: "Unable to save the change.",
              }),
          ),
        );
      return { applied };
    },
  );

  return OperationsService.of({ metrics, apply });
});

export const layer = Layer.effect(OperationsService, make);
