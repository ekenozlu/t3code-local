import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronProtocol from "../../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_MENU_BAR_USAGE_CHANNEL } from "../channels.ts";

const MenuBarUsageState = Schema.Struct({
  enabled: Schema.Boolean,
  title: Schema.NullOr(Schema.String.check(Schema.isMaxLength(16))),
  tooltip: Schema.String.check(Schema.isMaxLength(1_024)),
});

// The web app renders the popover at this hash route, without the app shell.
const MENU_BAR_USAGE_ROUTE = "#/menubar-usage";
const POPOVER_SIZE = { width: 360, height: 560 } as const;
const POPOVER_GAP = 4;
const SCREEN_MARGIN = 8;
// A click on the menu bar item blurs (and hides) an open popover first; that click must not reopen it.
const REOPEN_GUARD_MS = 250;

// An 18pt gauge, drawn black on clear so macOS tints it as a template image.
const ICON_1X =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAw0lEQVR42mNgGJHABYibgXg+FDdDxYgGPkB8G4j/48C3oWrwgmYkDceBuADqChco+ziSfDMuQ3KgCj4DcQgey0Kgav5D9aAAFSD+DsS/gdiGgKslgHgyVO13qF44mEzIuVAAsuQ6EDsgBcNkZAXPoYISaBpZgDgAikFh9BiITZBc9h+qF0XgMhYXTEcK3PdArIEmfxnZAQpQzn4sBt1HMug+Fvn9UDmQGQwcUD8bEHDRdCzyBlC9HITSFXIYsTCMAooAADM1PORci6mAAAAAAElFTkSuQmCC";
const ICON_2X =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAABbUlEQVR42u1VoW7DMBAtKCjIBxQO9iMCAvcJBv2MggKDSPuAwsDBgMLBgAGDgn3AYGBBYEFAwXaRrpJ3vfNc29uqyU96UpTkzs++d+fZLCMj476xBJbAClniu1/DAqiALXAAfggc8B+FMT8iRAOPDhESjxibTNhUij5ACGWPuaKwBZ6FBUagATbAGtngu1GIOWPOIOyEpMbDGxevGSHHLuRkOC+ogI0pwXvbWzxDy3SIbOcl5qDlq3y6qWfEFAma44ER1X/XfZopU4pBtwaegBumfNp1OvRnFSlkjp035XrHU1LMpheS+Wg3xZboTfCg8dl4m/B0Hq2r5ZXxIN18yyUZyNDzGfUFeqBDTs9PVpfusWycPUZy91215a3lKhyD7zL85o54GvuleUrysfEQpB1iXjziGxJT0mFof6w9EnYOQZ1HfE1iqrsWtAI+W1xHlkx7Dkt7zVXs9JVMbRJdNcGiaNv/mZiMjIyMf4lPtwXzgvTFLU8AAAAASUVORK5CYII=";

function trayIcon(): Electron.NativeImage {
  const image = Electron.nativeImage.createFromDataURL(ICON_1X);
  image.addRepresentation({ scaleFactor: 2, dataURL: ICON_2X });
  image.setTemplateImage(true);
  return image;
}

export function resolvePopoverPosition(input: {
  readonly trayBounds: Electron.Rectangle;
  readonly workArea: Electron.Rectangle;
  readonly size: { readonly width: number; readonly height: number };
}): { readonly x: number; readonly y: number } {
  const { trayBounds, workArea, size } = input;
  const centeredX = Math.round(trayBounds.x + trayBounds.width / 2 - size.width / 2);
  const x = Math.min(
    Math.max(centeredX, workArea.x + SCREEN_MARGIN),
    workArea.x + workArea.width - size.width - SCREEN_MARGIN,
  );
  // The menu bar sits above the work area; open below it.
  const y = Math.max(trayBounds.y + trayBounds.height + POPOVER_GAP, workArea.y + POPOVER_GAP);
  return { x, y };
}

/**
 * The macOS menu bar item with subscription usage. The main window's renderer reports whether it
 * is on and what title to show; clicking the item opens a popover window on the same app origin.
 */
export const installMenuBarUsage = Effect.fn("desktop.ipc.installMenuBarUsage")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcess.Platform;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const context = yield* Effect.context<
    ElectronWindow.ElectronWindow | DesktopWindow.DesktopWindow
  >();
  const runPromise = Effect.runPromiseWith(context);

  let tray: Electron.Tray | null = null;
  let popover: Electron.BrowserWindow | null = null;
  let lastBlurHideAt = Number.NEGATIVE_INFINITY;

  const createPopover = async (): Promise<Electron.BrowserWindow> => {
    const window = await runPromise(
      electronWindow.create(
        {
          ...POPOVER_SIZE,
          show: false,
          frame: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: true,
          vibrancy: "popover",
          visualEffectState: "active",
          backgroundColor: "#00000000",
          title: "AI usage",
          webPreferences: {
            preload: environment.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
        { auxiliary: true, appWindow: true },
      ),
    );
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("blur", () => {
      if (window.isDestroyed() || !window.isVisible()) return;
      lastBlurHideAt = performance.now();
      window.hide();
    });
    window.on("closed", () => {
      if (popover === window) popover = null;
    });
    await window.loadURL(
      `${ElectronProtocol.getDesktopUrl(environment.isDevelopment)}${MENU_BAR_USAGE_ROUTE}`,
    );
    return window;
  };

  const showPopover = async () => {
    if (tray === null) return;
    if (popover === null || popover.isDestroyed()) popover = await createPopover();
    if (tray === null || popover.isDestroyed()) return;
    const trayBounds = tray.getBounds();
    const display = Electron.screen.getDisplayMatching(trayBounds);
    popover.setPosition(
      ...((): [number, number] => {
        const { x, y } = resolvePopoverPosition({
          trayBounds,
          workArea: display.workArea,
          size: POPOVER_SIZE,
        });
        return [x, y];
      })(),
    );
    popover.show();
    popover.focus();
  };

  const togglePopover = () => {
    if (popover !== null && !popover.isDestroyed() && popover.isVisible()) {
      popover.hide();
      return;
    }
    if (performance.now() - lastBlurHideAt < REOPEN_GUARD_MS) return;
    void showPopover().catch((cause: unknown) =>
      runPromise(Effect.logWarning("Could not open the menu bar usage popover", cause)),
    );
  };

  const destroy = () => {
    if (popover !== null && !popover.isDestroyed()) popover.destroy();
    popover = null;
    tray?.destroy();
    tray = null;
  };

  const ensureTray = (): Electron.Tray => {
    if (tray !== null) return tray;
    const created = new Electron.Tray(trayIcon());
    created.setIgnoreDoubleClickEvents(true);
    created.on("click", togglePopover);
    created.on("right-click", () => {
      created.popUpContextMenu(
        Electron.Menu.buildFromTemplate([
          { label: "Show Usage", click: togglePopover },
          {
            label: `Open ${environment.displayName}`,
            click: () => void runPromise(desktopWindow.activate).catch(() => undefined),
          },
          { type: "separator" },
          { label: `Quit ${environment.displayName}`, click: () => Electron.app.quit() },
        ]),
      );
    });
    tray = created;
    return created;
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_MENU_BAR_USAGE_CHANNEL,
      payload: MenuBarUsageState,
      result: Schema.Void,
      handler: (state) =>
        Effect.sync(() => {
          // Tray items outside macOS have no title and no anchored popover; the feature is macOS-only.
          if (platform !== "darwin" || !state.enabled) {
            destroy();
            return;
          }
          const item = ensureTray();
          item.setTitle(state.title ?? "", { fontType: "monospacedDigit" });
          item.setToolTip(state.tooltip);
        }),
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(destroy));
});
