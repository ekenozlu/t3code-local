import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";

/**
 * What a provider can say about its subscription. Only `ok` carries numbers; every other state
 * explains why there are none, so the popover never shows a guessed bar.
 */
export type ProviderUsageState =
  | "ok"
  | "unavailable"
  | "error"
  | "signed-out"
  | "not-installed"
  | "disabled";

export type UsageSeverity = "ok" | "warning" | "critical";

export interface ProviderUsageWindowSummary {
  readonly id: string;
  readonly kind: ServerProviderUsageWindow["kind"];
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAtMs: number | null;
  /** The reset time passed after the last read, so the bar is from the previous window. */
  readonly stale: boolean;
  readonly severity: UsageSeverity;
}

export interface ProviderUsageSummary {
  readonly instanceId: ServerProvider["instanceId"];
  readonly driver: ServerProvider["driver"];
  readonly name: string;
  readonly accentColor: string | undefined;
  readonly state: ProviderUsageState;
  readonly plan: string | null;
  readonly email: string | null;
  readonly windows: readonly ProviderUsageWindowSummary[];
  readonly resetCredits: number | null;
  readonly zeroSpendCap: boolean;
  readonly externalUsage: { readonly label: string; readonly url: string } | null;
  readonly checkedAtMs: number | null;
  readonly message: string | null;
  /** Enabled and installed; inactive providers fold behind a toggle. */
  readonly active: boolean;
}

// Drivers whose probes or turn events report subscription windows (see their usageLimits modules).
const DRIVERS_REPORTING_LIMITS = new Set<string>([
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
  "muse",
]);

const WARNING_PERCENT = 70;
const CRITICAL_PERCENT = 90;

export function usageSeverity(usedPercent: number): UsageSeverity {
  if (usedPercent >= CRITICAL_PERCENT) return "critical";
  if (usedPercent >= WARNING_PERCENT) return "warning";
  return "ok";
}

function parseMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** "ChatGPT Plus Subscription" reads as "ChatGPT Plus" on a badge. */
function planBadge(label: string | undefined): string | null {
  const trimmed = label?.replace(/\s+subscription$/i, "").trim();
  return trimmed ? trimmed : null;
}

function unavailableMessage(provider: ServerProvider): string {
  const reported = provider.usageLimits?.unavailable?.message;
  if (reported) return reported;
  if (provider.usageLimits?.externalUsage) return "Usage is shown on the provider's site.";
  return DRIVERS_REPORTING_LIMITS.has(provider.driver)
    ? "No usage reported yet."
    : "This provider doesn't report subscription usage.";
}

export function summarizeProviderUsage(
  provider: ServerProvider,
  now: number,
): ProviderUsageSummary {
  const limits = provider.usageLimits;
  const windows = (limits?.windows ?? []).map((window): ProviderUsageWindowSummary => {
    const resetsAtMs = parseMs(window.resetsAt);
    const usedPercent = Math.round(Math.min(100, Math.max(0, window.usedPercent)));
    return {
      id: window.id,
      kind: window.kind,
      label: window.label,
      usedPercent,
      resetsAtMs,
      stale: resetsAtMs !== null && resetsAtMs <= now,
      severity: usageSeverity(usedPercent),
    };
  });
  const active = provider.enabled && provider.installed;
  const state: ProviderUsageState = !provider.enabled
    ? "disabled"
    : !provider.installed
      ? "not-installed"
      : provider.auth.status === "unauthenticated"
        ? "signed-out"
        : windows.length > 0
          ? "ok"
          : limits?.unavailable?.reason === "probeFailed"
            ? "error"
            : "unavailable";
  const message =
    state === "ok"
      ? // A failed probe keeps the last good bars; say they may be old.
        limits?.unavailable?.reason === "probeFailed"
        ? (limits.unavailable.message ?? "Couldn't refresh; showing the last reading.")
        : null
      : state === "error"
        ? (limits?.unavailable?.message ?? "Couldn't read usage.")
        : state === "unavailable"
          ? unavailableMessage(provider)
          : state === "signed-out"
            ? "Not signed in."
            : state === "not-installed"
              ? "Not installed."
              : "Disabled.";
  return {
    instanceId: provider.instanceId,
    driver: provider.driver,
    name: provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
    accentColor: provider.accentColor,
    state,
    plan: state === "signed-out" ? null : planBadge(provider.auth.label),
    email: provider.auth.email ?? null,
    windows,
    resetCredits:
      limits?.resetCredits && limits.resetCredits.availableCount > 0
        ? limits.resetCredits.availableCount
        : null,
    zeroSpendCap: limits?.zeroSpendCap === true,
    externalUsage: limits?.externalUsage ?? null,
    checkedAtMs: parseMs(limits?.checkedAt) ?? parseMs(provider.checkedAt),
    message,
    active,
  };
}

const STATE_ORDER: Record<ProviderUsageState, number> = {
  ok: 0,
  error: 1,
  "signed-out": 2,
  unavailable: 3,
  "not-installed": 4,
  disabled: 5,
};

/** Highest live percent, for ordering and the menu bar title. Stale windows have reset. */
function peakUsedPercent(summary: ProviderUsageSummary): number | null {
  let peak: number | null = null;
  for (const window of summary.windows) {
    if (window.stale) continue;
    peak = peak === null ? window.usedPercent : Math.max(peak, window.usedPercent);
  }
  return peak;
}

/** Providers with numbers first, then by what the user can act on; names break ties. */
export function sortProviderUsage(
  summaries: readonly ProviderUsageSummary[],
): ProviderUsageSummary[] {
  return summaries.toSorted(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.name.localeCompare(right.name),
  );
}

/** The menu bar title: the busiest live window across active providers, or nothing. */
export function menuBarUsageTitle(summaries: readonly ProviderUsageSummary[]): string | null {
  let peak: number | null = null;
  for (const summary of summaries) {
    if (!summary.active || summary.state !== "ok") continue;
    const providerPeak = peakUsedPercent(summary);
    if (providerPeak !== null) peak = peak === null ? providerPeak : Math.max(peak, providerPeak);
  }
  return peak === null ? null : `${peak}%`;
}

/** One line per provider with numbers, for the menu bar tooltip. */
export function menuBarUsageTooltip(summaries: readonly ProviderUsageSummary[]): string {
  const lines = summaries.flatMap((summary) => {
    if (!summary.active || summary.state !== "ok") return [];
    const peak = peakUsedPercent(summary);
    return peak === null ? [] : [`${summary.name}: ${peak}%`];
  });
  return lines.length === 0 ? "AI usage" : `AI usage\n${lines.join("\n")}`;
}

export function formatResetCountdown(resetsAtMs: number | null, now: number): string | null {
  if (resetsAtMs === null) return null;
  if (resetsAtMs <= now) return "Reset, refreshing";
  return `Resets in ${formatDuration(resetsAtMs - now)}`;
}

export function formatUpdatedAgo(checkedAtMs: number | null, now: number): string | null {
  if (checkedAtMs === null) return null;
  const elapsed = now - checkedAtMs;
  if (elapsed < 60_000) return "Updated just now";
  return `Updated ${formatDuration(elapsed)} ago`;
}
