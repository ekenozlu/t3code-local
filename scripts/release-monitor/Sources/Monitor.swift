import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class Monitor {
  let pipelines: [Pipeline] = [.desktop, .testflight]
  var snapshots: [String: PipelineSnapshot] = [:]
  var lastError: String?
  /// Branches on the repo's origin, newest fetch first; nil until the first fetch lands.
  var branches: [String]?
  var loadingBranches = false
  /// The checkout the app was built from, for installing agents and running git.
  let repoPath: String? = Bundle.main.object(forInfoDictionaryKey: "T3RepoPath") as? String

  private var timer: Timer?
  private var refreshing = false

  init() {
    refresh(checkAgents: true)
    // Small files only; a few reads every two seconds keep the window live without watchers.
    var ticks = 0
    timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        ticks += 1
        self?.refresh(checkAgents: ticks % 5 == 0)
      }
    }
  }

  func refresh(checkAgents: Bool) {
    guard !refreshing else { return }
    refreshing = true
    let pipelines = self.pipelines
    let previous = snapshots
    Task.detached(priority: .utility) {
      var next: [String: PipelineSnapshot] = [:]
      for pipeline in pipelines {
        var snapshot = PipelineSnapshot.read(pipeline)
        snapshot.agentLoaded =
          checkAgents
          ? Shell.agentLoaded(pipeline.label) : (previous[pipeline.id]?.agentLoaded ?? false)
        next[pipeline.id] = snapshot
      }
      await MainActor.run {
        if next != self.snapshots { self.snapshots = next }
        self.refreshing = false
      }
    }
  }

  func loadBranches() {
    guard let repoPath, !loadingBranches else { return }
    loadingBranches = true
    Task.detached(priority: .userInitiated) {
      let result = Shell.run("/usr/bin/git", ["-C", repoPath, "ls-remote", "--heads", "origin"])
      let names = result.output.split(separator: "\n").compactMap { line -> String? in
        guard let ref = line.split(separator: "\t").last, ref.hasPrefix("refs/heads/") else {
          return nil
        }
        return String(ref.dropFirst("refs/heads/".count))
      }
      await MainActor.run {
        self.loadingBranches = false
        if result.status == 0 {
          self.branches = names.sorted { left, right in
            // main first, then alphabetical.
            left == "main" ? right != "main" : (right != "main" && left < right)
          }
        } else {
          self.lastError = "Could not list branches: \(result.output)"
        }
      }
    }
  }

  func saveConfig(_ config: TestFlightConfig) {
    do {
      try config.write(to: Pipeline.testflight.configFile)
      lastError = nil
    } catch {
      lastError = "Could not save the config: \(error.localizedDescription)"
    }
    refresh(checkAgents: false)
  }

  func request(_ pipeline: Pipeline, _ value: String) {
    do {
      try FileManager.default.createDirectory(at: pipeline.stateDir, withIntermediateDirectories: true)
      try (value + "\n").write(to: pipeline.requestFile, atomically: true, encoding: .utf8)
      lastError = nil
    } catch {
      lastError = "Could not write the request: \(error.localizedDescription)"
    }
    refresh(checkAgents: false)
  }

  func installAgent(_ pipeline: Pipeline) {
    guard let repoPath else {
      lastError = "This build does not know its checkout. Rebuild it with build.sh."
      return
    }
    let script = (repoPath as NSString).appendingPathComponent(pipeline.installScript)
    Task.detached {
      let result = Shell.run("/bin/bash", [script])
      await MainActor.run {
        self.lastError = result.status == 0 ? nil : result.output
        self.refresh(checkAgents: true)
      }
    }
  }

  func open(_ url: URL) {
    if !FileManager.default.fileExists(atPath: url.path) {
      lastError = "\(url.lastPathComponent) does not exist yet."
      return
    }
    NSWorkspace.shared.open(url)
  }
}
