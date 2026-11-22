import SwiftUI

@main
struct ReleaseMonitorApp: App {
  @State private var monitor: Monitor

  init() {
    Snapshot.renderIfRequested()
    _monitor = State(initialValue: Monitor())
  }

  var body: some Scene {
    Window("T3 Release Monitor", id: "main") {
      ContentView(monitor: monitor)
        .frame(minWidth: 860, minHeight: 600)
    }
    .defaultSize(width: 1040, height: 760)
  }
}

struct ContentView: View {
  let monitor: Monitor
  @State private var selection = Pipeline.desktop.id

  var body: some View {
    HStack(spacing: 0) {
      List(selection: $selection) {
        Section("Pipelines") {
          ForEach(monitor.pipelines, id: \.id) { pipeline in
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
            .tag(pipeline.id)
          }
        }
        Section("Settings") {
          Label("TestFlight", systemImage: "gearshape").tag(ConfigView.id)
        }
      }
      .listStyle(.sidebar)
      .frame(width: 220)
      Divider()
      Group {
        if selection == ConfigView.id {
          ConfigView(monitor: monitor)
        } else if let pipeline = monitor.pipelines.first(where: { $0.id == selection }) {
          PipelineView(monitor: monitor, pipeline: pipeline) { selection = ConfigView.id }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
  let openSettings: () -> Void
  @State private var tag: String?
  @State private var showingNewTag = false

  private var snapshot: PipelineSnapshot { monitor.snapshots[pipeline.id] ?? PipelineSnapshot() }
  private var busy: Bool {
    snapshot.locked || pipeline.busyStates.contains(snapshot.status?.state ?? "")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      header
      if let error = monitor.lastError {
        Label(error, systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.red)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
      if !snapshot.agentLoaded {
        GroupBox {
          HStack {
            Text("The launchd agent for this pipeline is not running on this Mac.")
            Spacer()
            Button("Install agent") { monitor.installAgent(pipeline) }
          }
          .padding(6)
        }
      } else {
        GroupBox("Status") { details.padding(6) }
        GroupBox(pipeline.id == "desktop" ? "Update" : "Release") { actions.padding(6) }
      }
      GroupBox("Log") {
        LogView(text: snapshot.logTail).padding(2)
      }
      .frame(maxHeight: .infinity)
    }
    .padding(20)
    .navigationTitle(pipeline.title)
    .toolbar {
      ToolbarItemGroup {
        if pipeline.id == "testflight" {
          Button {
            NSWorkspace.shared.open(URL(string: "https://appstoreconnect.apple.com/apps")!)
          } label: {
            Label("App Store Connect", systemImage: "safari")
          }
          .help("Open App Store Connect")
        }
        Button {
          monitor.open(pipeline.logFile)
        } label: {
          Label("Open log", systemImage: "doc.text")
        }
        .help("Open the full log in Console")
        Button {
          monitor.installAgent(pipeline)
        } label: {
          Label("Reinstall agent", systemImage: "arrow.triangle.2.circlepath")
        }
        .help("Reinstall the launchd agent from this checkout")
      }
    }
    .task(id: pipeline.id) {
      if pipeline.id == "testflight", monitor.tags == nil { monitor.loadRefs() }
    }
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 10) {
      StateDot(state: displayState(pipeline, snapshot))
      Text(stateLabel(displayState(pipeline, snapshot))).font(.title2.weight(.semibold))
      if busy { ProgressView().controlSize(.small) }
      Spacer(minLength: 12)
      if let status = snapshot.status {
        Text(status.date, format: .relative(presentation: .named))
          .foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private var details: some View {
    VStack(alignment: .leading, spacing: 10) {
      Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 6) {
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
        HStack(alignment: .firstTextBaseline) {
          Label(
            "Missing \(snapshot.missingConfig.joined(separator: ", ")).",
            systemImage: "key.fill"
          )
          .foregroundStyle(.orange)
          .fixedSize(horizontal: false, vertical: true)
          Spacer()
          Button("Open settings", action: openSettings)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var mobileTags: [String] { MobileVersion.mobileTags(monitor.tags ?? []) }
  /// The picked tag, else the newest.
  private var selectedTag: String? {
    tag.flatMap { mobileTags.contains($0) ? $0 : nil } ?? mobileTags.first
  }

  private func row(_ label: String, _ value: String?) -> some View {
    GridRow {
      Text(label).foregroundStyle(.secondary)
      Text(value ?? "—")
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  @ViewBuilder private var actions: some View {
    if pipeline.id == "desktop" {
      HStack(spacing: 8) {
        Text("Checks GitHub for a newer tag every 15 minutes; installs when T3 Code is closed.")
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 12)
        Button("Check now") { monitor.request(pipeline, "check") }
          .disabled(busy)
        Button("Install") { monitor.request(pipeline, "install") }
          .buttonStyle(.borderedProminent)
          .disabled(busy || snapshot.builtTag == nil || snapshot.builtTag == snapshot.installedTag)
      }
    } else {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Text("Tag").foregroundStyle(.secondary)
          Picker("Tag", selection: Binding(get: { selectedTag }, set: { tag = $0 })) {
            if mobileTags.isEmpty { Text("No mobile tags yet").tag(String?.none) }
            ForEach(mobileTags, id: \.self) { Text($0).tag(Optional($0)) }
          }
          .labelsHidden()
          .frame(minWidth: 160, maxWidth: 240)
          Button {
            monitor.loadRefs()
          } label: {
            Image(systemName: "arrow.clockwise")
          }
          .help("Reload tags and branches from GitHub")
          .disabled(monitor.loadingRefs)
          Button("New tag…") { showingNewTag = true }
            .disabled(monitor.tags == nil)
          Spacer(minLength: 12)
          Button("Release to TestFlight") {
            if let selected = selectedTag { monitor.request(pipeline, selected) }
          }
          .buttonStyle(.borderedProminent)
          .disabled(busy || !snapshot.missingConfig.isEmpty || selectedTag == nil)
        }
        Text("The tag sets the version; the build number is the time of the run.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .sheet(isPresented: $showingNewTag) {
        NewTagSheet(monitor: monitor) { created in tag = created }
      }
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
      // A scroll view's ideal size is its content's; without this cap a long log asks the window
      // to grow past the screen and pushes the rest of the page out of view.
      .frame(minWidth: 0, idealWidth: 400, maxWidth: .infinity)
      .frame(minHeight: 140, idealHeight: 260, maxHeight: .infinity)
      .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))
      .onChange(of: text, initial: true) { proxy.scrollTo("end", anchor: .bottom) }
    }
  }
}

/// Tags a branch's tip on origin as the next mobile version, so a release can pick it.
struct NewTagSheet: View {
  let monitor: Monitor
  let onCreated: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var branch = "main"
  @State private var version = ""
  @State private var error: String?

  private var trimmed: String { version.trimmingCharacters(in: .whitespaces) }
  private var exists: Bool { (monitor.tags ?? []).contains(MobileVersion.tagPrefix + trimmed) }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("New mobile tag").font(.title2.weight(.semibold))
      Form {
        Picker("Branch", selection: $branch) {
          ForEach(monitor.branches ?? ["main"], id: \.self) { Text($0).tag($0) }
        }
        TextField("Version", text: $version)
        LabeledContent("Tag", value: MobileVersion.tagPrefix + trimmed)
      }
      if exists {
        Label("That tag already exists.", systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.orange)
      }
      if let error {
        Text(error).foregroundStyle(.red).textSelection(.enabled)
      }
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }
        Button("Create and push") {
          monitor.createMobileTag(branch: branch, version: trimmed) { failure in
            if let failure {
              error = failure
            } else {
              onCreated(MobileVersion.tagPrefix + trimmed)
              dismiss()
            }
          }
        }
        .buttonStyle(.borderedProminent)
        .disabled(MobileVersion.parse(trimmed) == nil || exists || monitor.creatingTag)
      }
    }
    .padding(20)
    .frame(width: 420)
    .onAppear {
      version = MobileVersion.next(tags: monitor.tags ?? [])
    }
  }
}
