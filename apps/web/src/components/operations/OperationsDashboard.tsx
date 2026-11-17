import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isFailedOperationsJob,
  medianOperationsDuration,
  type OperationsJob,
  summarizeOperationsJobs,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { openCommandCenter } from "../../lib/commandCenter";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { formatDuration, formatTokens, jobsNeedingAttention } from "./operationsDashboard.logic";

const PERIODS = [7, 30, 90] as const;

function Tile(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="text-lg font-medium tabular-nums">{props.value}</div>
    </div>
  );
}

function Section(props: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{props.title}</h2>
      {props.children}
    </section>
  );
}

function JobsTable(props: { readonly jobs: ReadonlyArray<OperationsJob> }) {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Time</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Steers</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.jobs.map((job) => (
          <TableRow
            key={`${job.commandCenterThreadId}:${job.threadId ?? job.title}:${job.startedAt}`}
          >
            <TableCell>
              {job.threadId === null || environmentId === null ? (
                <span className="block max-w-64 truncate">{job.title}</span>
              ) : (
                <Link
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(scopeThreadRef(environmentId, job.threadId))}
                  className="block max-w-64 truncate hover:underline"
                >
                  {job.title}
                </Link>
              )}
            </TableCell>
            <TableCell>{job.agent ?? "None"}</TableCell>
            <TableCell>{job.project}</TableCell>
            <TableCell>
              <span
                className={isFailedOperationsJob(job) ? "text-destructive-foreground" : undefined}
              >
                {job.status}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <span className="tabular-nums">{formatDuration(job.durationMs)}</span>
            </TableCell>
            <TableCell className="text-right">
              <span className="tabular-nums">
                {formatTokens(job.inputTokens + job.outputTokens)}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <span className="tabular-nums">{job.interventions}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The Command Center's jobs over a period: the numbers the Operation Center reviews. */
export function OperationsDashboard() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const [sinceDays, setSinceDays] = useState<(typeof PERIODS)[number]>(7);
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.operationsMetrics({ environmentId, input: { sinceDays } }),
  );
  const jobs = data?.jobs ?? [];
  const agents = summarizeOperationsJobs(jobs);
  const attention = jobsNeedingAttention(jobs, agents);
  const tokens = jobs.reduce((sum, job) => sum + job.inputTokens + job.outputTokens, 0);

  return (
    <AppRouteModal label="Operations">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2">
          <h1 className="text-sm font-medium">Operations</h1>
          <ToggleGroup
            aria-label="Operations period"
            variant="segmented"
            value={[String(sinceDays)]}
            onValueChange={(next) => {
              const value = PERIODS.find((days) => String(days) === next[0]);
              if (value !== undefined) setSinceDays(value);
            }}
          >
            {PERIODS.map((days) => (
              <Toggle key={days} value={String(days)}>
                {days}d
              </Toggle>
            ))}
          </ToggleGroup>
          <div className="ms-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openCommandCenter({ navigate }, { center: "operations" })}
            >
              Ask the Operation Center
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={refresh}>
              <RefreshIcon size="sm" refreshing={isPending} />
            </Button>
            <AppRouteModalClose />
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {error !== null ? (
              <p className="text-sm text-destructive-foreground">{error}</p>
            ) : data === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Command Center jobs in the last {sinceDays} days.
              </p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Tile label="Jobs" value={String(jobs.length)} />
                  <Tile label="Failed" value={String(jobs.filter(isFailedOperationsJob).length)} />
                  <Tile
                    label="Median time"
                    value={formatDuration(medianOperationsDuration(jobs))}
                  />
                  <Tile label="Tokens" value={formatTokens(tokens)} />
                  <Tile
                    label="Steers"
                    value={String(jobs.reduce((sum, job) => sum + job.interventions, 0))}
                  />
                </div>
                <Section title="By agent">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead className="text-right">Jobs</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                        <TableHead className="text-right">Median time</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Steers</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agents.map((agent) => (
                        <TableRow key={agent.agent}>
                          <TableCell>{agent.agent}</TableCell>
                          <TableCell className="text-right">
                            <span className="tabular-nums">{agent.jobs}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="tabular-nums">{agent.failed}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="tabular-nums">
                              {formatDuration(agent.medianDurationMs)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="tabular-nums">{formatTokens(agent.tokens)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="tabular-nums">{agent.interventions}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Section>
                {attention.length === 0 ? null : (
                  <Section title="Needs attention">
                    <p className="text-xs text-muted-foreground">
                      Failed, steered by you, or over twice their agent's median time.
                    </p>
                    <JobsTable jobs={attention} />
                  </Section>
                )}
                <Section title="Recent jobs">
                  <JobsTable jobs={jobs.slice(0, 50)} />
                </Section>
              </div>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </AppRouteModal>
  );
}
