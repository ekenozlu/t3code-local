import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatResetCountdown,
  menuBarUsageTitle,
  sortProviderUsage,
  summarizeProviderUsage,
  usageSeverity,
} from "./menuBarUsage.logic";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");

function provider(
  overrides: Partial<Omit<ServerProvider, "driver">> & { driver: string },
): ServerProvider {
  const { driver, ...rest } = overrides;
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-22T11:59:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...rest,
  };
}

function limits(overrides: Partial<ServerProviderUsageLimits>): ServerProviderUsageLimits {
  return { checkedAt: "2026-11-22T11:58:00.000Z", windows: [], ...overrides };
}

describe("summarizeProviderUsage", () => {
  it("normalizes windows, plan and reset credits", () => {
    const summary = summarizeProviderUsage(
      provider({
        driver: "claudeAgent",
        auth: { status: "authenticated", label: "Claude Max Subscription", email: "a@b.c" },
        usageLimits: limits({
          windows: [
            {
              id: "five_hour",
              kind: "session",
              label: "5-hour",
              usedPercent: 72.4,
              resetsAt: "2026-11-22T14:14:00.000Z",
            },
            {
              id: "seven_day",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 95,
              resetsAt: "2026-11-21T00:00:00.000Z",
            },
          ],
          resetCredits: { availableCount: 2 },
        }),
      }),
      NOW,
    );
    expect(summary).toMatchObject({
      name: "Claude",
      state: "ok",
      plan: "Claude Max",
      email: "a@b.c",
      resetCredits: 2,
      checkedAtMs: Date.parse("2026-11-22T11:58:00.000Z"),
      message: null,
    });
    expect(summary.windows).toEqual([
      expect.objectContaining({ usedPercent: 72, severity: "warning", stale: false }),
      expect.objectContaining({ usedPercent: 95, severity: "critical", stale: true }),
    ]);
  });

  it("explains every provider without numbers instead of inventing them", () => {
    const states = [
      provider({ driver: "kiro" }),
      provider({ driver: "codex", auth: { status: "unauthenticated" } }),
      provider({ driver: "cursor", installed: false }),
      provider({ driver: "grok", enabled: false }),
      provider({
        driver: "antigravity",
        usageLimits: limits({ unavailable: { reason: "probeFailed", message: "Token expired" } }),
      }),
      provider({ driver: "opencode" }),
    ].map((entry) => {
      const summary = summarizeProviderUsage(entry, NOW);
      return [summary.driver, summary.state, summary.message, summary.windows.length];
    });
    expect(states).toEqual([
      ["kiro", "unavailable", "This provider doesn't report subscription usage.", 0],
      ["codex", "signed-out", "Not signed in.", 0],
      ["cursor", "not-installed", "Not installed.", 0],
      ["grok", "disabled", "Disabled.", 0],
      ["antigravity", "error", "Token expired", 0],
      ["opencode", "unavailable", "No usage reported yet.", 0],
    ]);
  });

  it("keeps the last good bars after a failed probe and says so", () => {
    const summary = summarizeProviderUsage(
      provider({
        driver: "codex",
        usageLimits: limits({
          windows: [{ id: "primary", kind: "session", label: "5h", usedPercent: 10 }],
          unavailable: { reason: "probeFailed" },
        }),
      }),
      NOW,
    );
    expect(summary.state).toBe("ok");
    expect(summary.message).toBe("Couldn't refresh; showing the last reading.");
  });
});

describe("menu bar title and ordering", () => {
  const withPercent = (driver: string, usedPercent: number, resetsAt?: string) =>
    summarizeProviderUsage(
      provider({
        driver,
        usageLimits: limits({
          windows: [
            {
              id: "w",
              kind: "session",
              label: "Session",
              usedPercent,
              ...(resetsAt ? { resetsAt } : {}),
            },
          ],
        }),
      }),
      NOW,
    );

  it("shows the busiest live window and ignores stale or inactive ones", () => {
    expect(
      menuBarUsageTitle([
        withPercent("codex", 41),
        withPercent("claudeAgent", 99, "2026-11-22T11:00:00.000Z"),
        withPercent("cursor", 63),
      ]),
    ).toBe("63%");
    expect(menuBarUsageTitle([summarizeProviderUsage(provider({ driver: "kiro" }), NOW)])).toBe(
      null,
    );
  });

  it("orders providers with numbers before the rest", () => {
    const sorted = sortProviderUsage([
      summarizeProviderUsage(provider({ driver: "grok", enabled: false }), NOW),
      summarizeProviderUsage(provider({ driver: "kiro" }), NOW),
      withPercent("codex", 5),
    ]);
    expect(sorted.map((summary) => summary.driver)).toEqual(["codex", "kiro", "grok"]);
  });

  it("grades severity and formats countdowns", () => {
    expect([usageSeverity(69), usageSeverity(70), usageSeverity(90)]).toEqual([
      "ok",
      "warning",
      "critical",
    ]);
    expect(formatResetCountdown(NOW + (2 * 60 + 14) * 60_000, NOW)).toBe("Resets in 2h 14m");
    expect(formatResetCountdown(NOW - 1, NOW)).toBe("Reset, refreshing");
    expect(formatResetCountdown(null, NOW)).toBe(null);
  });
});
