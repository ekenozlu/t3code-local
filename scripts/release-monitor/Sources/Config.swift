import Foundation

/// The TestFlight pipeline's config.env, which release.sh sources.
struct TestFlightConfig: Equatable, Sendable {
  var teamId = ""
  var bundleId = ""
  var keyId = ""
  var issuerId = ""
  /// Empty uses the version in app.config.ts.
  var version = ""
  var developerDir = ""

  static let keyDirectory = FileManager.default.homeDirectoryForCurrentUser
    .appending(path: ".appstoreconnect/private_keys")

  static func load(from url: URL) -> TestFlightConfig {
    var config = TestFlightConfig()
    guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return config }
    for line in contents.split(separator: "\n") where !line.hasPrefix("#") {
      let parts = line.split(separator: "=", maxSplits: 1).map {
        $0.trimmingCharacters(in: .whitespaces)
      }
      guard parts.count == 2 else { continue }
      let value = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
      switch parts[0] {
      case "T3CODE_IOS_TEAM_ID": config.teamId = value
      case "T3CODE_IOS_BUNDLE_ID": config.bundleId = value
      case "ASC_KEY_ID": config.keyId = value
      case "ASC_ISSUER_ID": config.issuerId = value
      case "T3CODE_MOBILE_VERSION": config.version = value
      case "DEVELOPER_DIR": config.developerDir = value
      default: break
      }
    }
    return config
  }

  func write(to url: URL) throws {
    var lines = [
      "# Written by T3 Release Monitor. The key file is found in ~/.appstoreconnect/private_keys by its ID.",
      "T3CODE_IOS_TEAM_ID=\(teamId)",
      "T3CODE_IOS_BUNDLE_ID=\(bundleId)",
      "ASC_KEY_ID=\(keyId)",
      "ASC_ISSUER_ID=\(issuerId)",
    ]
    if !version.isEmpty { lines.append("T3CODE_MOBILE_VERSION=\(version)") }
    if !developerDir.isEmpty { lines.append("DEVELOPER_DIR=\(developerDir)") }
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }

  /// The .p8 files in the key folder; Apple names them AuthKey_<key id>.p8.
  static func keyFiles() -> [URL] {
    let files =
      (try? FileManager.default.contentsOfDirectory(
        at: keyDirectory, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "p8" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
  }

  static func keyId(of file: URL) -> String {
    let name = file.deletingPathExtension().lastPathComponent
    return name.hasPrefix("AuthKey_") ? String(name.dropFirst("AuthKey_".count)) : name
  }

  func keyFile(in files: [URL]) -> URL? {
    keyId.isEmpty ? nil : files.first { $0.lastPathComponent.contains(keyId) }
  }

  /// What still blocks a release, in words for the UI.
  func missing(keyFiles: [URL]) -> [String] {
    var missing: [String] = []
    if teamId.isEmpty { missing.append("Team ID") }
    if bundleId.isEmpty { missing.append("Bundle ID") }
    if keyId.isEmpty { missing.append("Key ID") }
    if issuerId.isEmpty { missing.append("Issuer ID") }
    if !keyId.isEmpty, keyFile(in: keyFiles) == nil { missing.append("a .p8 key file for \(keyId)") }
    return missing
  }

  static func xcodes() -> [String] {
    let apps = (try? FileManager.default.contentsOfDirectory(atPath: "/Applications")) ?? []
    return apps.filter { $0.hasPrefix("Xcode") && $0.hasSuffix(".app") }.sorted()
      .map { "/Applications/\($0)/Contents/Developer" }
  }
}

/// Mobile releases are tagged mobile-vX.Y.Z; the tag sets the version TestFlight shows.
enum MobileVersion {
  static let tagPrefix = "mobile-v"

  static func parse(_ value: String) -> [Int]? {
    let parts = value.split(separator: ".").map { Int($0) }
    guard parts.count == 3, parts.allSatisfy({ $0 != nil }) else { return nil }
    return parts.compactMap { $0 }
  }

  /// Mobile tags, newest version first.
  static func mobileTags(_ tags: [String]) -> [String] {
    tags.filter { $0.hasPrefix(tagPrefix) && parse(String($0.dropFirst(tagPrefix.count))) != nil }
      .sorted {
        parse(String($1.dropFirst(tagPrefix.count)))!
          .lexicographicallyPrecedes(parse(String($0.dropFirst(tagPrefix.count)))!)
      }
  }

  /// The next patch after the newest mobile tag; the newest desktop vX.Y.Z when there is none.
  static func next(tags: [String]) -> String {
    if let latest = mobileTags(tags).first, let parts = parse(String(latest.dropFirst(tagPrefix.count))) {
      return "\(parts[0]).\(parts[1]).\(parts[2] + 1)"
    }
    let desktop = tags.filter { $0.hasPrefix("v") }.compactMap { parse(String($0.dropFirst())) }
    guard let newest = desktop.max(by: { $0.lexicographicallyPrecedes($1) }) else { return "0.1.0" }
    return newest.map(String.init).joined(separator: ".")
  }
}
