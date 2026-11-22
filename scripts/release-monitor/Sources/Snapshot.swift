import AppKit
import SwiftUI

/// T3_MONITOR_SNAPSHOT=<dir> renders each page to a PNG and exits, so layout can be checked
/// without screen-recording permission.
enum Snapshot {
  @MainActor
  static func renderIfRequested() {
    guard let dir = ProcessInfo.processInfo.environment["T3_MONITOR_SNAPSHOT"] else { return }
    _ = NSApplication.shared
    let monitor = Monitor()
    for pipeline in monitor.pipelines {
      var snapshot = PipelineSnapshot.read(pipeline)
      snapshot.agentLoaded = Shell.agentLoaded(pipeline.label)
      monitor.snapshots[pipeline.id] = snapshot
    }
    if let repo = monitor.repoPath {
      let output = Shell.run("/usr/bin/git", ["-C", repo, "tag", "-l"]).output
      monitor.tags = output.split(separator: "\n").map(String.init)
      monitor.branches = ["main", "feat/command-center"]
    }
    let width = Double(ProcessInfo.processInfo.environment["T3_MONITOR_WIDTH"] ?? "") ?? 820
    let pages: [(String, AnyView)] = [
      ("desktop", AnyView(PipelineView(monitor: monitor, pipeline: .desktop) {})),
      ("testflight", AnyView(PipelineView(monitor: monitor, pipeline: .testflight) {})),
      ("settings", AnyView(ConfigView(monitor: monitor))),
      ("newtag", AnyView(NewTagSheet(monitor: monitor) { _ in })),
    ]
    for (name, page) in pages {
      let size = NSSize(width: name == "newtag" ? 420 : width, height: name == "newtag" ? 300 : 700)
      let host = NSHostingView(
        rootView: page.frame(width: size.width, height: size.height)
          .background(Color(nsColor: .windowBackgroundColor)))
      let window = NSWindow(
        contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless],
        backing: .buffered, defer: false)
      window.contentView = host
      host.layoutSubtreeIfNeeded()
      RunLoop.main.run(until: Date().addingTimeInterval(0.3))
      host.layoutSubtreeIfNeeded()
      guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { continue }
      host.cacheDisplay(in: host.bounds, to: rep)
      let url = URL(fileURLWithPath: dir).appending(path: "\(name).png")
      try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }
    exit(0)
  }
}
