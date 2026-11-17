import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2Subagent } from "./orchestrationV2.ts";

export const OperationsMetricsInput = Schema.Struct({
  /** Jobs started in the last this many days. */
  sinceDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
});
export type OperationsMetricsInput = typeof OperationsMetricsInput.Type;

/** One job a Command Center thread dispatched, and what it took. */
export const OperationsJob = Schema.Struct({
  commandCenterThreadId: ThreadId,
  /** The job's own thread; null while it has not started. */
  threadId: Schema.NullOr(ThreadId),
  title: Schema.String,
  /** The saved agent it ran as; null for jobs dispatched without one or before agents were recorded. */
  agent: Schema.NullOr(Schema.String),
  project: Schema.String,
  model: Schema.NullOr(Schema.String),
  status: OrchestrationV2Subagent.fields.status,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  durationMs: Schema.NullOr(NonNegativeInt),
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  turns: NonNegativeInt,
  /** Messages the user sent the job's thread after its task: each is a correction or steer. */
  interventions: NonNegativeInt,
});
export type OperationsJob = typeof OperationsJob.Type;

export const OperationsMetrics = Schema.Struct({
  since: Schema.String,
  jobs: Schema.Array(OperationsJob),
});
export type OperationsMetrics = typeof OperationsMetrics.Type;

export class OperationsMetricsError extends Schema.TaggedError<OperationsMetricsError>()(
  "OperationsMetricsError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `Could not read operations metrics: ${this.detail}`;
  }
}

/** An approved change the Operation Center applies; fields left out stay as they are. */
export const OperationsApplyInput = Schema.Struct({
  agent: Schema.optional(
    Schema.Struct({
      name: TrimmedNonEmptyString.annotate({
        description:
          "The saved agent to change, by name from `orchestrator_capabilities` `agents`.",
      }),
      description: Schema.optional(Schema.String),
      instructions: Schema.optional(
        Schema.String.annotate({ description: "The agent's full new instructions." }),
      ),
      modelSelection: Schema.optional(
        Schema.NullOr(ModelSelection).annotate({
          description: "Its model; null to inherit the Command Center's.",
        }),
      ),
    }),
  ),
  commandCenterGuidance: Schema.optional(
    Schema.String.annotate({ description: "The Command Center's full new guidance." }),
  ),
});
export type OperationsApplyInput = typeof OperationsApplyInput.Type;

export const OperationsApplyResult = Schema.Struct({ applied: Schema.Array(Schema.String) });
export type OperationsApplyResult = typeof OperationsApplyResult.Type;

export interface OperationsAgentSummary {
  readonly agent: string;
  readonly jobs: number;
  readonly failed: number;
  readonly medianDurationMs: number | null;
  readonly tokens: number;
  readonly interventions: number;
}

const FAILED = new Set<OperationsJob["status"]>(["failed", "cancelled", "interrupted"]);

export const isFailedOperationsJob = (job: OperationsJob): boolean => FAILED.has(job.status);

const median = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

/** Per-agent totals, busiest first; jobs without an agent group under "(no agent)". */
export function summarizeOperationsJobs(
  jobs: ReadonlyArray<OperationsJob>,
): ReadonlyArray<OperationsAgentSummary> {
  const byAgent = new Map<string, Array<OperationsJob>>();
  for (const job of jobs) {
    const agent = job.agent ?? "(no agent)";
    byAgent.set(agent, [...(byAgent.get(agent) ?? []), job]);
  }
  return [...byAgent.entries()]
    .map(([agent, group]) => ({
      agent,
      jobs: group.length,
      failed: group.filter(isFailedOperationsJob).length,
      medianDurationMs: median(group.flatMap((job) => job.durationMs ?? [])),
      tokens: group.reduce((sum, job) => sum + job.inputTokens + job.outputTokens, 0),
      interventions: group.reduce((sum, job) => sum + job.interventions, 0),
    }))
    .sort((left, right) => right.jobs - left.jobs);
}

export const medianOperationsDuration = (jobs: ReadonlyArray<OperationsJob>): number | null =>
  median(jobs.flatMap((job) => job.durationMs ?? []));
