import Foundation

/// One local release pipeline: a launchd agent that reads requests from a file and reports
/// progress in status.json and a log. The monitor only reads those files and writes requests.
struct Pipeline: Sendable {
  let id: String
  let title: String
  let label: String
  let stateDir: URL
  let logFile: URL
  /// Script in the repo that installs the agent.
  let installScript: String
  /// States that mean a run is in progress.
  let busyStates: Set<String>

  var statusFile: URL { stateDir.appending(path: "status.json") }
  var requestFile: URL { stateDir.appending(path: "request") }
  var configFile: URL { stateDir.appending(path: "config.env") }
  var lockDir: URL { stateDir.appending(path: "lock") }

  static let desktop = Pipeline(
    id: "desktop",
    title: "Mac app",
    label: "local.t3code.self-update",
    stateDir: home("Library/Application Support/t3code-self-update"),
    logFile: home("Library/Logs/t3code-self-update.log"),
    installScript: "scripts/mac-self-update/install.sh",
    busyStates: ["building"]
  )

  static let testflight = Pipeline(
    id: "testflight",
    title: "iOS TestFlight",
    label: "local.t3code.testflight",
    stateDir: home("Library/Application Support/t3code-testflight"),
    logFile: home("Library/Logs/t3code-testflight.log"),
    installScript: "scripts/ios-testflight/install.sh",
    busyStates: ["preparing", "installing", "prebuilding", "archiving", "uploading"]
  )
}

private func home(_ path: String) -> URL {
  FileManager.default.homeDirectoryForCurrentUser.appending(path: path)
}

/// What status.json holds; each pipeline fills the fields it has.
struct PipelineStatus: Decodable, Equatable, Sendable {
  var state: String
  var tag: String?
  var ref: String?
  var commit: String?
  var version: String?
  var build: String?
  var at: Double
  var message: String?

  var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

struct PipelineSnapshot: Equatable, Sendable {
  var status: PipelineStatus?
  var agentLoaded = false
  var locked = false
  var logTail = ""
  var installedTag: String?
  var builtTag: String?
  var uploadedBuild: String?
  /// config.env keys that are still empty.
  var missingConfig: [String] = []

  static func read(_ pipeline: Pipeline) -> PipelineSnapshot {
    let fm = FileManager.default
    var snapshot = PipelineSnapshot()
    if let data = try? Data(contentsOf: pipeline.statusFile) {
      snapshot.status = try? JSONDecoder().decode(PipelineStatus.self, from: data)
    }
    snapshot.locked = fm.fileExists(atPath: pipeline.lockDir.path)
    snapshot.logTail = tail(of: pipeline.logFile, bytes: 48_000)
    snapshot.installedTag = text(pipeline.stateDir.appending(path: "installed-tag"))
    snapshot.builtTag = text(pipeline.stateDir.appending(path: "built-tag"))
    snapshot.uploadedBuild = text(pipeline.stateDir.appending(path: "uploaded-build"))
    if pipeline.id == "testflight" {
      snapshot.missingConfig = missingKeys(in: pipeline.configFile)
    }
    return snapshot
  }
}

private func text(_ url: URL) -> String? {
  guard let value = try? String(contentsOf: url, encoding: .utf8) else { return nil }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? nil : trimmed
}

private func tail(of url: URL, bytes: Int) -> String {
  guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
  defer { try? handle.close() }
  let size = (try? handle.seekToEnd()) ?? 0
  try? handle.seek(toOffset: size > UInt64(bytes) ? size - UInt64(bytes) : 0)
  let data = (try? handle.readToEnd()) ?? Data()
  var lines = String(decoding: data, as: UTF8.self).split(separator: "\n", omittingEmptySubsequences: false)
  if size > UInt64(bytes), !lines.isEmpty { lines.removeFirst() }
  return lines.suffix(400).joined(separator: "\n")
}

private let requiredConfig = [
  "T3CODE_IOS_TEAM_ID", "T3CODE_IOS_BUNDLE_ID", "ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH",
]

private func missingKeys(in url: URL) -> [String] {
  guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return requiredConfig }
  var values: [String: String] = [:]
  for line in contents.split(separator: "\n") where !line.hasPrefix("#") {
    let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
    if parts.count == 2 { values[parts[0].trimmingCharacters(in: .whitespaces)] = parts[1] }
  }
  return requiredConfig.filter {
    let value = values[$0]?.trimmingCharacters(in: .whitespaces) ?? ""
    return value.isEmpty || value.contains("XXXXXXXXXX")
  }
}

enum Shell {
  @discardableResult
  static func run(_ launchPath: String, _ arguments: [String]) -> (status: Int32, output: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: launchPath)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    do { try process.run() } catch { return (-1, error.localizedDescription) }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, String(decoding: data, as: UTF8.self))
  }

  static func agentLoaded(_ label: String) -> Bool {
    run("/bin/launchctl", ["print", "gui/\(getuid())/\(label)"]).status == 0
  }
}
