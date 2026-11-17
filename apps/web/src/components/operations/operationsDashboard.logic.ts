import {
  isFailedOperationsJob,
  type OperationsAgentSummary,
  type OperationsJob,
} from "@t3tools/contracts";

/** Jobs to look at first: failed, steered by the user, or over twice their agent's median time. */
export function jobsNeedingAttention(
  jobs: ReadonlyArray<OperationsJob>,
  agents: ReadonlyArray<OperationsAgentSummary>,
): ReadonlyArray<OperationsJob> {
  const medianByAgent = new Map(agents.map((agent) => [agent.agent, agent.medianDurationMs]));
  return jobs.filter((job) => {
    if (isFailedOperationsJob(job) || job.interventions > 0) return true;
    const median = medianByAgent.get(job.agent ?? "(no agent)");
    return job.durationMs !== null && median != null && job.durationMs > median * 2;
  });
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "n/a";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
