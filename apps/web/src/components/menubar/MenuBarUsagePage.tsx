import { useAtomValue } from "@effect/atom-react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { ensureLocalApi } from "../../localApi";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import {
  formatResetCountdown,
  formatUpdatedAgo,
  sortProviderUsage,
  summarizeProviderUsage,
  type ProviderUsageSummary,
  type ProviderUsageWindowSummary,
  type UsageSeverity,
} from "./menuBarUsage.logic";

// Countdowns read in minutes, so a minute tick keeps them honest without repainting.
const CLOCK_TICK_MS = 60_000;
// The server re-probes on its own; this only asks for fresh numbers while the popover is open.
const OPEN_REFRESH_INTERVAL_MS = 5 * 60_000;
const SHOW_INACTIVE_KEY = "t3code:menubar-usage:show-inactive";

const SEVERITY_BAR: Record<UsageSeverity, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  critical: "bg-error",
};
const SEVERITY_TEXT: Record<UsageSeverity, string> = {
  ok: "text-foreground",
  warning: "text-warning",
  critical: "text-error",
};

function useVisibleClock(onVisible: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const handleVisible = useEffectEvent(onVisible);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the popover window is hidden and shown by the menu bar item; refresh and tick only while it is on screen
  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | null = null;
    let refresh: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (tick !== null) clearInterval(tick);
      if (refresh !== null) clearInterval(refresh);
      tick = refresh = null;
    };
    const sync = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      handleVisible();
      tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
      refresh = setInterval(() => handleVisible(), OPEN_REFRESH_INTERVAL_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, []);
  return now;
}

function UsageWindowRow({
  window,
  now,
}: {
  readonly window: ProviderUsageWindowSummary;
  readonly now: number;
}) {
  const countdown = formatResetCountdown(window.resetsAtMs, now);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{window.label}</span>
        <span
          className={cn(
            "shrink-0 font-medium tabular-nums",
            window.stale ? "text-muted-foreground" : SEVERITY_TEXT[window.severity],
          )}
        >
          {window.usedPercent}%
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={`${window.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={window.usedPercent}
      >
        <div
          className={cn(
            "h-full rounded-full",
            window.stale ? "bg-muted-foreground/40" : SEVERITY_BAR[window.severity],
          )}
          style={{ width: `${Math.max(window.usedPercent, window.usedPercent > 0 ? 2 : 0)}%` }}
        />
      </div>
      {countdown ? <span className="text-2xs text-muted-foreground">{countdown}</span> : null}
    </div>
  );
}

function ProviderUsageCard({
  summary,
  now,
}: {
  readonly summary: ProviderUsageSummary;
  readonly now: number;
}) {
  const updated = formatUpdatedAgo(summary.checkedAtMs, now);
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground",
        !summary.active && "opacity-70",
      )}
      aria-label={summary.name}
    >
      <header className="flex items-center gap-2.5">
        <ProviderInstanceIcon
          driverKind={summary.driver}
          displayName={summary.name}
          accentColor={summary.accentColor}
          className="size-6"
          iconClassName="size-5"
          showBadge={false}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{summary.name}</span>
          {summary.email ? (
            <span className="truncate text-2xs text-muted-foreground">{summary.email}</span>
          ) : null}
        </div>
        {summary.plan ? (
          <span className="max-w-32 shrink-0 truncate rounded-full border px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {summary.plan}
          </span>
        ) : null}
      </header>
      {summary.windows.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {summary.windows.map((window) => (
            <UsageWindowRow key={`${window.kind}:${window.id}`} window={window} now={now} />
          ))}
        </div>
      ) : null}
      {summary.zeroSpendCap ? (
        <p className="text-xs text-muted-foreground">Extra usage is capped at $0.</p>
      ) : null}
      {summary.message ? (
        <p
          className={cn(
            "text-xs",
            summary.state === "error" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {summary.message}
        </p>
      ) : null}
      {summary.resetCredits !== null || updated || summary.externalUsage ? (
        <footer className="flex items-center gap-2 text-2xs text-muted-foreground">
          {summary.resetCredits !== null ? (
            <span>
              {summary.resetCredits} reset {summary.resetCredits === 1 ? "credit" : "credits"}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{summary.state === "ok" ? updated : null}</span>
          {summary.externalUsage ? (
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => void ensureLocalApi().shell.openExternal(summary.externalUsage!.url)}
            >
              {summary.externalUsage.label}
              <ExternalLinkIcon aria-hidden />
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

/** The menu bar popover: one card per provider on this machine's server. */
export function MenuBarUsagePage() {
  const environmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [showInactive, setShowInactive] = useLocalStorage(SHOW_INACTIVE_KEY, false, Schema.Boolean);
  const refresh = (automatic: boolean) => {
    if (environmentId === null) return;
    if (!automatic) setRefreshing(true);
    void refreshUsageLimits(
      environmentId,
      () => refreshProviders({ environmentId, input: {} }),
      automatic,
    )
      .catch(() => undefined)
      .finally(() => {
        if (!automatic) setRefreshing(false);
      });
  };
  const now = useVisibleClock(() => refresh(true));
  const summaries = sortProviderUsage(
    providers.map((provider) => summarizeProviderUsage(provider, now)),
  );
  const active = summaries.filter((summary) => summary.active);
  const inactive = summaries.filter((summary) => !summary.active);

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground select-none">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="flex-1 text-sm font-semibold">AI usage</h1>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Refresh usage"
          title="Refresh usage"
          disabled={refreshing || environmentId === null}
          onClick={() => refresh(false)}
        >
          <RefreshIcon refreshing={refreshing} />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {environmentId === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Connecting to this machine's server…
          </p>
        ) : summaries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No providers are set up yet.
          </p>
        ) : null}
        {active.map((summary) => (
          <ProviderUsageCard key={summary.instanceId} summary={summary} now={now} />
        ))}
        {inactive.length > 0 ? (
          <button
            type="button"
            aria-expanded={showInactive}
            onClick={() => setShowInactive((value) => !value)}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDownIcon
              aria-hidden
              className={cn("size-3.5 transition-transform", !showInactive && "-rotate-90")}
            />
            {`${inactive.length} disabled or not installed`}
          </button>
        ) : null}
        {showInactive
          ? inactive.map((summary) => (
              <ProviderUsageCard key={summary.instanceId} summary={summary} now={now} />
            ))
          : null}
      </div>
    </main>
  );
}
