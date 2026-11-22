import {
  formatDuration,
  formatTokens,
  jobsNeedingAttention,
} from "@t3tools/client-runtime/operations-dashboard";
import {
  isFailedOperationsJob,
  medianOperationsDuration,
  summarizeOperationsJobs,
  type OperationsJob,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { cn } from "../../lib/cn";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { CenterEnvironmentPicker, useCenterTarget } from "./centerSettingsTarget";
import { useOpenCenter } from "./useOpenCenter";

const PERIODS = [7, 30, 90] as const;

function Tile(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="min-w-[30%] flex-1 rounded-2xl bg-grouped-card px-4 py-3">
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
      <Text className="text-xl font-semibold text-foreground tabular-nums">{props.value}</Text>
    </View>
  );
}

function JobRow(props: {
  readonly job: OperationsJob;
  readonly borderTop: boolean;
  readonly onOpen: (() => void) | null;
}) {
  const { job } = props;
  const failed = isFailedOperationsJob(job);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.onOpen === null}
      onPress={props.onOpen ?? undefined}
      className={cn(
        "gap-0.5 px-4 py-3 active:opacity-70",
        props.borderTop && "border-t border-border-subtle",
      )}
    >
      <Text numberOfLines={1} className="text-base text-foreground">
        {job.title}
      </Text>
      <Text numberOfLines={1} className="text-sm text-foreground-muted">
        {[job.agent ?? "No agent", job.project].join(" · ")}
        {" · "}
        <Text
          className={cn("text-sm", failed ? "text-danger-foreground" : "text-foreground-muted")}
        >
          {job.status}
        </Text>
      </Text>
      <Text className="text-xs text-foreground-muted tabular-nums">
        {formatDuration(job.durationMs)} · {formatTokens(job.inputTokens + job.outputTokens)} tokens
        · {job.interventions} steers
      </Text>
    </Pressable>
  );
}

/** The Command Center's jobs over a period: the numbers the Operation Center reviews. */
export function SettingsOperationsRouteScreen() {
  const insets = useSafeAreaInsets();
  const center = useCenterTarget();
  const environmentId = center.target?.environmentId ?? null;
  const openCenter = useOpenCenter();
  const selectDetail = useSelectWorkspaceDetail();
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
  const openJob = (job: OperationsJob) =>
    job.threadId === null || environmentId === null
      ? null
      : () =>
          selectDetail({
            name: "Thread",
            params: { environmentId: String(environmentId), threadId: String(job.threadId) },
          });
  const jobRows = (list: ReadonlyArray<OperationsJob>) =>
    list.map((job, index) => (
      <JobRow
        key={`${job.commandCenterThreadId}:${job.threadId ?? job.title}:${job.startedAt}`}
        job={job}
        borderTop={index > 0}
        onOpen={openJob(job)}
      />
    ));

  return (
    <SettingsScreen
      title="Operations"
      refresh={{ accessibilityLabel: "Refresh", disabled: isPending, onPress: refresh }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <CenterEnvironmentPicker {...center} />
        <SegmentedControl
          options={PERIODS.map((days) => ({ value: days, label: `${days} days` }))}
          selected={sinceDays}
          onSelect={setSinceDays}
        />
        {environmentId !== null ? (
          <Button
            fullWidth
            tone="primary"
            icon="checkmark.circle"
            label="Ask the Operation Center"
            onPress={() => void openCenter(environmentId, { center: "operations" })}
          />
        ) : null}
        {environmentId === null ? (
          <EmptyState
            variant="plain"
            title="No environment connected"
            detail="Connect to a T3 Code server to see its jobs."
          />
        ) : error !== null ? (
          <EmptyState variant="plain" title="Could not load operations" detail={error} />
        ) : data === null ? (
          <View className="items-center py-8">
            <AppActivityIndicator colorClassName="accent-foreground-muted" />
          </View>
        ) : jobs.length === 0 ? (
          <EmptyState
            variant="plain"
            title="No jobs yet"
            detail={`No Command Center jobs in the last ${sinceDays} days.`}
          />
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2">
              <Tile label="Jobs" value={String(jobs.length)} />
              <Tile label="Failed" value={String(jobs.filter(isFailedOperationsJob).length)} />
              <Tile label="Median time" value={formatDuration(medianOperationsDuration(jobs))} />
              <Tile label="Tokens" value={formatTokens(tokens)} />
              <Tile
                label="Steers"
                value={String(jobs.reduce((sum, job) => sum + job.interventions, 0))}
              />
            </View>
            <SettingsSection title="By agent">
              {agents.map((agent, index) => (
                <View
                  key={agent.agent}
                  className={cn("gap-0.5 px-4 py-3", index > 0 && "border-t border-border-subtle")}
                >
                  <View className="flex-row items-baseline justify-between gap-3">
                    <Text numberOfLines={1} className="flex-1 text-base text-foreground">
                      {agent.agent}
                    </Text>
                    <Text className="text-sm text-foreground-muted tabular-nums">
                      {agent.jobs} jobs
                    </Text>
                  </View>
                  <Text className="text-xs text-foreground-muted tabular-nums">
                    {agent.failed} failed · {formatDuration(agent.medianDurationMs)} median ·{" "}
                    {formatTokens(agent.tokens)} tokens · {agent.interventions} steers
                  </Text>
                </View>
              ))}
            </SettingsSection>
            {attention.length > 0 ? (
              <SettingsSection
                title="Needs attention"
                footer="Failed, steered by you, or over twice their agent's median time."
              >
                {jobRows(attention)}
              </SettingsSection>
            ) : null}
            <SettingsSection title="Recent jobs">{jobRows(jobs.slice(0, 50))}</SettingsSection>
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
