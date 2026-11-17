/**
 * Updates for a fork built on this Mac by scripts/mac-self-update. Those builds are ad-hoc signed,
 * which Squirrel.Mac refuses to install, so its launchd agent builds and installs instead. This
 * stands in for electron-updater: it writes "check" or "install" to the request file the agent
 * watches, and reads the status.json the agent writes. An install quits; the agent reopens the app.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Electron from "electron";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeEvents from "node:events";

import * as ElectronUpdater from "./ElectronUpdater.ts";
import { LocalUpdateStatus, localCheckOutcome, localDownloadOutcome } from "./localSelfUpdate.ts";

const AGENT_LABEL = "local.t3code.self-update";
const CHECK_POLLS = 180;
const DOWNLOAD_POLLS = 1800;

const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(LocalUpdateStatus));

const makeLocal = (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  paths: { readonly stateDir: string; readonly agentPlist: string; readonly log: string },
): ElectronUpdater.ElectronUpdater["Service"] => {
  const events = new NodeEvents.EventEmitter();
  const appVersion = Electron.app.getVersion();
  const noop = () => Effect.void;
  const requestPath = path.join(paths.stateDir, "request");

  const readStatus = fileSystem.readFileString(path.join(paths.stateDir, "status.json")).pipe(
    Effect.map((text) => Option.getOrNull(decodeStatus(text))),
    Effect.orElseSucceed(() => null),
  );

  const request = (action: "check" | "install") =>
    fileSystem.exists(paths.agentPlist).pipe(
      Effect.flatMap((installed) =>
        installed
          ? fileSystem.writeFileString(requestPath, `${action}\n`).pipe(Effect.as(true))
          : Effect.succeed(false),
      ),
      Effect.orElseSucceed(() => false),
    );

  const poll = Effect.fn("LocalSelfUpdater.poll")(function* <A>(
    times: number,
    interval: Duration.Input,
    step: Effect.Effect<A | undefined>,
  ) {
    for (let attempt = 0; attempt < times; attempt++) {
      const result = yield* step;
      if (result !== undefined) return result;
      yield* Effect.sleep(interval);
    }
    return undefined;
  });

  const checkError = (reason: string) =>
    new ElectronUpdater.ElectronUpdaterCheckForUpdatesError({
      channel: null,
      cause: reason,
      reason,
    });

  return ElectronUpdater.ElectronUpdater.of({
    ownsFeed: true,
    setFeedURL: noop,
    setAutoDownload: noop,
    setAutoInstallOnAppQuit: noop,
    setChannel: noop,
    setAllowPrerelease: noop,
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: noop,
    setFullChangelog: noop,
    setDisableDifferentialDownload: noop,
    checkForUpdates: Effect.gen(function* () {
      events.emit("checking-for-update");
      const requestedAt = yield* Clock.currentTimeMillis;
      if (!(yield* request("check"))) {
        return yield* checkError(
          `The background updater (${AGENT_LABEL}) is not installed. Run scripts/mac-self-update/install.sh.`,
        );
      }
      const outcome = yield* poll(
        CHECK_POLLS,
        "1 second",
        readStatus.pipe(
          Effect.map((status) => {
            const result = localCheckOutcome(status, appVersion, requestedAt);
            return result.type === "pending" ? undefined : result;
          }),
        ),
      );
      if (outcome === undefined) {
        return yield* checkError(`The background updater did not answer. See ${paths.log}.`);
      }
      if (outcome.type === "failed") return yield* checkError(outcome.message);
      if (outcome.type === "none") events.emit("update-not-available");
      else events.emit("update-available", { version: outcome.version });
    }).pipe(Effect.withSpan("LocalSelfUpdater.checkForUpdates")),
    downloadUpdate: Effect.gen(function* () {
      const outcome = yield* poll(
        DOWNLOAD_POLLS,
        "2 seconds",
        readStatus.pipe(
          Effect.map((status) => {
            const result = localDownloadOutcome(status, appVersion);
            return result.type === "pending" ? undefined : result;
          }),
        ),
      );
      if (outcome === undefined || outcome.type === "failed") {
        const reason = outcome?.message ?? `The build is taking too long. See ${paths.log}.`;
        return yield* new ElectronUpdater.ElectronUpdaterDownloadUpdateError({
          channel: null,
          cause: reason,
          reason,
        });
      }
      events.emit("update-downloaded", { version: outcome.version });
    }).pipe(Effect.withSpan("LocalSelfUpdater.downloadUpdate")),
    quitAndInstall: Effect.fn("LocalSelfUpdater.quitAndInstall")(function* ({
      isSilent,
      isForceRunAfter,
    }) {
      // The agent waits for this app to quit, installs the build, and reopens it.
      if (!(yield* request("install"))) {
        return yield* new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
          channel: null,
          isSilent,
          isForceRunAfter,
          cause: "The background updater is not installed.",
        });
      }
      Electron.app.quit();
    }),
    on: Effect.fn("LocalSelfUpdater.on")(function (eventName, listener) {
      const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => {
          events.on(eventName, untypedListener);
        }),
        () =>
          Effect.sync(() => {
            events.removeListener(eventName, untypedListener);
          }),
      ).pipe(Effect.asVoid);
    }),
  });
};

/**
 * electron-updater, or this Mac's own updater for a build it made: packaged, on macOS, with no
 * release feed (app-update.yml), and with the updater installed.
 */
export const layer = Layer.effect(
  ElectronUpdater.ElectronUpdater,
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = Electron.app.getPath("home");
    const stateDir = path.join(home, "Library", "Application Support", "t3code-self-update");
    const exists = (file: string) =>
      fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));
    const local =
      platform === "darwin" &&
      Electron.app.isPackaged &&
      !(yield* exists(path.join(process.resourcesPath, "app-update.yml"))) &&
      (yield* exists(path.join(stateDir, "updater.sh")));
    if (!local) return ElectronUpdater.make;
    return makeLocal(fileSystem, path, {
      stateDir,
      agentPlist: path.join(home, "Library", "LaunchAgents", `${AGENT_LABEL}.plist`),
      log: path.join(home, "Library", "Logs", "t3code-self-update.log"),
    });
  }),
);
