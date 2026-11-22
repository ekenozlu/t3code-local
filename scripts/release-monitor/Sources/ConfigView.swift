import AppKit
import SwiftUI

/// Edits the TestFlight pipeline's config.env as a form. The key file itself is never picked:
/// release.sh finds the .p8 in ~/.appstoreconnect/private_keys whose name holds the key ID.
struct ConfigView: View {
  static let id = "settings"

  let monitor: Monitor
  @State private var draft: TestFlightConfig?

  private var snapshot: PipelineSnapshot {
    monitor.snapshots[Pipeline.testflight.id] ?? PipelineSnapshot()
  }
  private var saved: TestFlightConfig { snapshot.config }

  var body: some View {
    let config = draft ?? saved
    Form {
      Section {
        TextField("Team ID", text: field(\.teamId), prompt: Text("ABCDE12345"))
        TextField("Bundle ID", text: field(\.bundleId), prompt: Text("com.example.t3code"))
      } header: {
        Text("Apple Developer")
      } footer: {
        Text("Your paid team, and the bundle ID of the app in App Store Connect.")
      }

      Section {
        TextField("Key ID", text: field(\.keyId), prompt: Text("From the key's file name"))
        TextField("Issuer ID", text: field(\.issuerId), prompt: Text("Shown above the keys list"))
        keyStatus(config)
      } header: {
        Text("App Store Connect API key")
      } footer: {
        Text("Users and Access → Integrations → App Store Connect API, with the App Manager role.")
      }

      Section("Build") {
        Picker("Xcode", selection: field(\.developerDir)) {
          Text("xcode-select default").tag("")
          ForEach(xcodeOptions(config), id: \.self) { path in
            Text(xcodeName(path)).tag(path)
          }
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle("TestFlight settings")
    .toolbar {
      ToolbarItemGroup {
        Button("Revert") { draft = nil }
          .disabled(draft == nil || draft == saved)
        Button("Save") {
          monitor.saveConfig(trimmed(config))
          draft = nil
        }
        .keyboardShortcut("s")
        .disabled(draft == nil || draft == saved)
      }
    }
  }

  @ViewBuilder private func keyStatus(_ config: TestFlightConfig) -> some View {
    let files = snapshot.keyFiles
    LabeledContent("Key file") {
      if let file = config.keyFile(in: files) {
        Label(file.lastPathComponent, systemImage: "checkmark.seal.fill")
          .foregroundStyle(.green)
      } else if config.keyId.isEmpty {
        Text("Enter the key ID").foregroundStyle(.secondary)
      } else {
        Label("No .p8 with \(config.keyId) in its name", systemImage: "xmark.octagon.fill")
          .foregroundStyle(.red)
      }
    }
    let unused = files.filter { config.keyFile(in: [$0]) == nil }
    if !unused.isEmpty {
      LabeledContent("In the folder") {
        HStack {
          ForEach(unused, id: \.self) { file in
            Button("Use \(TestFlightConfig.keyId(of: file))") {
              update { $0.keyId = TestFlightConfig.keyId(of: file) }
            }
          }
        }
      }
    }
    LabeledContent("Folder") {
      Button("Show in Finder") {
        try? FileManager.default.createDirectory(
          at: TestFlightConfig.keyDirectory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(TestFlightConfig.keyDirectory)
      }
    }
  }

  private func field(_ path: WritableKeyPath<TestFlightConfig, String>) -> Binding<String> {
    Binding(
      get: { (draft ?? saved)[keyPath: path] },
      set: { value in update { $0[keyPath: path] = value } }
    )
  }

  private func update(_ change: (inout TestFlightConfig) -> Void) {
    var next = draft ?? saved
    change(&next)
    draft = next
  }

  private func trimmed(_ config: TestFlightConfig) -> TestFlightConfig {
    var copy = config
    for path: WritableKeyPath<TestFlightConfig, String> in [
      \.teamId, \.bundleId, \.keyId, \.issuerId, \.version, \.developerDir,
    ] {
      copy[keyPath: path] = copy[keyPath: path].trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return copy
  }

  private func xcodeOptions(_ config: TestFlightConfig) -> [String] {
    let found = TestFlightConfig.xcodes()
    return config.developerDir.isEmpty || found.contains(config.developerDir)
      ? found : found + [config.developerDir]
  }

  private func xcodeName(_ path: String) -> String {
    path.split(separator: "/").first { $0.hasSuffix(".app") }.map(String.init) ?? path
  }
}
