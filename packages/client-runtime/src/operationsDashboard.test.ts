import { type OperationsJob, summarizeOperationsJobs, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { formatDuration, jobsNeedingAttention } from "./operationsDashboard.ts";

const job = (title: string, fields: Partial<OperationsJob>): OperationsJob => ({
  commandCenterThreadId: ThreadId.make("thread:cc"),
  threadId: null,
  title,
  agent: "Bug fixer",
  project: "web",
  model: null,
  status: "completed",
  startedAt: null,
  completedAt: null,
  durationMs: 60_000,
  inputTokens: 0,
  outputTokens: 0,
  turns: 1,
  interventions: 0,
  ...fields,
});

it("flags failed, steered and slow jobs against their agent's median", () => {
  const jobs = [
    job("fine", {}),
    job("fine too", {}),
    job("failed", { status: "interrupted" }),
    job("steered", { interventions: 2 }),
    job("slow", { durationMs: 200_000 }),
    job("running", { status: "running", durationMs: null }),
  ];
  const flagged = jobsNeedingAttention(jobs, summarizeOperationsJobs(jobs));
  expect(flagged.map((entry) => entry.title)).toEqual(["failed", "steered", "slow"]);
});

it("formats durations from seconds to hours", () => {
  expect([null, 4_000, 125_000, 7_380_000].map(formatDuration)).toEqual([
    "n/a",
    "4s",
    "2m 5s",
    "2h 3m",
  ]);
});
