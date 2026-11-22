import { describe, expect, it } from "vite-plus/test";

import { resolvePopoverPosition } from "./menuBarUsage.ts";

describe("resolvePopoverPosition", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  const size = { width: 360, height: 560 };

  it("centers under the menu bar item and keeps the popover on screen", () => {
    const at = (x: number) =>
      resolvePopoverPosition({ trayBounds: { x, y: 0, width: 30, height: 24 }, workArea, size });
    expect(at(700)).toEqual({ x: 535, y: 29 });
    // Near the right edge the popover shifts left instead of running off the display.
    expect(at(1400)).toEqual({ x: 1072, y: 29 });
    expect(at(0)).toEqual({ x: 8, y: 29 });
  });
});
