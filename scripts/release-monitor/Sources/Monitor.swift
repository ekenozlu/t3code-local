import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class Monitor {
  let pipelines: [Pipeline] = [.desktop, .testflight]
  var snapshots: [String: PipelineSnapshot] = [:]
  var lastError: String?
  /// Branches and tags on the repo's origin; nil until the first listing lands.
  var branches: [String]?
  var tags: [String]?
  var loadingRefs = false
  var creatingTag = false
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

  func loadRefs() {
    guard let repoPath, !loadingRefs else { return }
    loadingRefs = true
    Task.detached(priority: .userInitiated) {
      let result = Shell.run(
        "/usr/bin/git", ["-C", repoPath, "ls-remote", "--heads", "--tags", "origin"])
      var branches: [String] = []
      var tags: [String] = []
      for line in result.output.split(separator: "\n") {
        guard let ref = line.split(separator: "\t").last.map(String.init) else { continue }
        if ref.hasPrefix("refs/heads/") {
          branches.append(String(ref.dropFirst("refs/heads/".count)))
        } else if ref.hasPrefix("refs/tags/"), !ref.hasSuffix("^{}") {
          tags.append(String(ref.dropFirst("refs/tags/".count)))
        }
      }
      await MainActor.run {
        self.loadingRefs = false
        guard result.status == 0 else {
          self.lastError = "Could not list branches and tags: \(result.output)"
          return
        }
        self.branches = branches.sorted { left, right in
          left == "main" ? right != "main" : (right != "main" && left < right)
        }
        self.tags = tags
      }
    }
  }

  /// Tags the tip of `branch` on origin as mobile-v`version` and pushes only that tag.
  func createMobileTag(branch: String, version: String, onDone: @escaping @MainActor (String?) -> Void) {
    guard let repoPath, !creatingTag else { return }
    creatingTag = true
    let tag = MobileVersion.tagPrefix + version
    Task.detached(priority: .userInitiated) {
      let git = { (arguments: [String]) in Shell.run("/usr/bin/git", ["-C", repoPath] + arguments) }
      var failure: String?
      let fetch = git(["fetch", "--quiet", "origin", "refs/heads/\(branch):refs/remotes/origin/\(branch)"])
      if fetch.status != 0 { failure = fetch.output }
      if failure == nil {
        let created = git(["tag", "-a", tag, "-m", "Mobile \(version) from \(branch)", "origin/\(branch)"])
        if created.status != 0 { failure = created.output }
      }
      if failure == nil {
        let pushed = git(["push", "--quiet", "origin", "refs/tags/\(tag)"])
        if pushed.status != 0 {
          // Keep local and remote tags in step when the push fails.
          _ = git(["tag", "-d", tag])
          failure = pushed.output
        }
      }
      await MainActor.run {
        self.creatingTag = false
        if failure == nil { self.tags = (self.tags ?? []) + [tag] }
        onDone(failure.map { "Could not create \(tag): \($0)" })
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
