import SwiftUI

@main
struct ReleaseMonitorApp: App {
  @State private var monitor = Monitor()

  var body: some Scene {
    Window("T3 Release Monitor", id: "main") {
      ContentView(monitor: monitor)
        .frame(minWidth: 760, minHeight: 560)
    }
    .defaultSize(width: 960, height: 720)
  }
}

struct ContentView: View {
  let monitor: Monitor
  @State private var selection = Pipeline.desktop.id

  var body: some View {
    NavigationSplitView {
      List(monitor.pipelines, id: \.id, selection: $selection) { pipeline in
        let snapshot = monitor.snapshots[pipeline.id] ?? PipelineSnapshot()
        HStack(spacing: 10) {
          StateDot(state: displayState(pipeline, snapshot))
          VStack(alignment: .leading, spacing: 2) {
            Text(pipeline.title).font(.headline)
            Text(stateLabel(displayState(pipeline, snapshot)))
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 4)
      }
      .navigationSplitViewColumnWidth(min: 200, ideal: 220)
    } detail: {
      if let pipeline = monitor.pipelines.first(where: { $0.id == selection }) {
        PipelineView(monitor: monitor, pipeline: pipeline)
      }
    }
  }
}

func displayState(_ pipeline: Pipeline, _ snapshot: PipelineSnapshot) -> String {
  if !snapshot.agentLoaded { return "not-installed" }
  return snapshot.status?.state ?? "idle"
}

func stateLabel(_ state: String) -> String {
  switch state {
  case "not-installed": "Agent not installed"
  case "current": "Up to date"
  case "building": "Building"
  case "ready": "Ready to install"
  case "installed": "Installed"
  case "preparing": "Fetching source"
  case "installing": "Installing dependencies"
  case "prebuilding": "Generating iOS project"
  case "archiving": "Archiving"
  case "uploading": "Uploading to App Store Connect"
  case "uploaded": "Uploaded"
  case "failed": "Failed"
  default: "Idle"
  }
}

struct StateDot: View {
  let state: String
  var body: some View {
    Circle()
      .fill(color)
      .frame(width: 10, height: 10)
  }
  private var color: Color {
    switch state {
    case "failed": .red
    case "not-installed": .gray
    case "current", "installed", "uploaded": .green
    case "ready": .blue
    case "idle": .secondary
    default: .orange
    }
  }
}

struct PipelineView: View {
  let monitor: Monitor
  let pipeline: Pipeline
  @State private var ref = "main"

  private var snapshot: PipelineSnapshot { monitor.snapshots[pipeline.id] ?? PipelineSnapshot() }
  private var busy: Bool {
    snapshot.locked || pipeline.busyStates.contains(snapshot.status?.state ?? "")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      header
      if let error = monitor.lastError {
        Label(error, systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.red)
          .textSelection(.enabled)
      }
      if !snapshot.agentLoaded {
        notInstalled
      } else {
        details
        actions
      }
      LogView(text: snapshot.logTail)
    }
    .padding(20)
    .navigationTitle(pipeline.title)
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      StateDot(state: displayState(pipeline, snapshot))
      Text(stateLabel(displayState(pipeline, snapshot))).font(.title2.weight(.semibold))
      if busy { ProgressView().controlSize(.small) }
      Spacer()
      if let status = snapshot.status {
        Text(status.date, format: .relative(presentation: .named))
          .foregroundStyle(.secondary)
      }
    }
  }

  private var notInstalled: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("The launchd agent for this pipeline is not running on this Mac.")
      Button("Install agent") { monitor.installAgent(pipeline) }
    }
  }

  @ViewBuilder private var details: some View {
    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
      if pipeline.id == "desktop" {
        row("Installed", snapshot.installedTag)
        row("Built", snapshot.builtTag)
        row("Latest tag", snapshot.status?.tag)
      } else {
        row("Last upload", snapshot.uploadedBuild)
        row("Current run", snapshot.status.map { status in
          [status.ref, status.commit, status.version.map { v in "\(v) (\(status.build ?? ""))" }]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        })
      }
      if let message = snapshot.status?.message, !message.isEmpty {
        row("Message", message)
      }
    }
    if pipeline.id == "testflight", !snapshot.missingConfig.isEmpty {
      Label(
        "Fill in \(snapshot.missingConfig.joined(separator: ", ")) in config.env before releasing.",
        systemImage: "key.fill"
      )
      .foregroundStyle(.orange)
    }
  }

  private func row(_ label: String, _ value: String?) -> some View {
    GridRow {
      Text(label).foregroundStyle(.secondary)
      Text(value ?? "—").textSelection(.enabled)
    }
  }

  @ViewBuilder private var actions: some View {
    HStack(spacing: 8) {
      if pipeline.id == "desktop" {
        Button("Check now") { monitor.request(pipeline, "check") }
          .disabled(busy)
        Button("Install") { monitor.request(pipeline, "install") }
          .disabled(busy || snapshot.builtTag == nil || snapshot.builtTag == snapshot.installedTag)
      } else {
        TextField("Branch, tag or commit", text: $ref)
          .textFieldStyle(.roundedBorder)
          .frame(width: 220)
        Button("Release to TestFlight") {
          monitor.request(pipeline, ref.trimmingCharacters(in: .whitespaces))
        }
        .buttonStyle(.borderedProminent)
        .disabled(busy || !snapshot.missingConfig.isEmpty || ref.trimmingCharacters(in: .whitespaces).isEmpty)
        Button("Edit config") { monitor.openConfig(pipeline) }
        Button("App Store Connect") {
          NSWorkspace.shared.open(URL(string: "https://appstoreconnect.apple.com/apps")!)
        }
      }
      Spacer()
      Button("Open log") { monitor.open(pipeline.logFile) }
      Button("Reinstall agent") { monitor.installAgent(pipeline) }
    }
  }
}

struct LogView: View {
  let text: String
  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        Text(text.isEmpty ? "No log yet." : text)
          .font(.system(.caption, design: .monospaced))
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
          .padding(10)
        Color.clear.frame(height: 1).id("end")
      }
      .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))
      .onChange(of: text, initial: true) { proxy.scrollTo("end", anchor: .bottom) }
    }
  }
}
