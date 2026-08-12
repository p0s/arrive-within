import CryptoKit
import Foundation
import Testing

@testable import ArriveWithin

@Suite("Renderer bundle resources")
struct RendererBundleResourceTests {
  @Test("Shipping app bundle resolves its validated renderer directory")
  func shippingBundleLoads() throws {
    let resources = try #require(RendererBundleResourceValidator.load(bundle: .main))

    #expect(resources.indexURL.lastPathComponent == "index.html")
    #expect(resources.indexSource.contains("id=\"garden-canvas\""))
    #expect(resources.scriptSource.contains("twilight-refuge"))
  }

  @Test("Exact local renderer bundle loads from its bounded manifest")
  func validBundleLoads() throws {
    let fixture = try RendererBundleFixture.make()
    defer { fixture.remove() }

    let resources = RendererBundleResourceValidator.load(indexURL: fixture.indexURL)

    #expect(resources?.indexURL == fixture.indexURL)
    #expect(resources?.indexSource == fixture.indexSource)
    #expect(resources?.scriptSource == fixture.scriptSource)
  }

  @Test("Missing or corrupt local renderer assets fail closed")
  func missingAndCorruptAssetsFailClosed() throws {
    let fixture = try RendererBundleFixture.make()
    defer { fixture.remove() }

    try Data("altered renderer".utf8).write(to: fixture.scriptURL, options: .atomic)
    #expect(RendererBundleResourceValidator.load(indexURL: fixture.indexURL) == nil)

    try FileManager.default.removeItem(at: fixture.manifestURL)
    #expect(RendererBundleResourceValidator.load(indexURL: fixture.indexURL) == nil)
  }
}

private struct RendererBundleFixture {
  let directory: URL
  let indexURL: URL
  let scriptURL: URL
  let manifestURL: URL
  let indexSource: String
  let scriptSource: String

  static func make() throws -> Self {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "arrive-within-renderer-fixture-\(UUID().uuidString)",
      directoryHint: .isDirectory
    )
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: false
    )
    let indexURL = directory.appending(path: "index.html")
    let scriptURL = directory.appending(path: "renderer.js")
    let manifestURL = directory.appending(path: "renderer-manifest.json")
    let indexSource = "<!doctype html><canvas id=\"garden-canvas\"></canvas>"
    let scriptSource = "window.arriveWithinGardenFixture = true;"
    let scriptData = Data(scriptSource.utf8)
    try Data(indexSource.utf8)
      .write(to: indexURL, options: .atomic)
    try scriptData.write(to: scriptURL, options: .atomic)
    let manifest: [String: Any] = [
      "schemaVersion": 1,
      "entry": "renderer.js",
      "byteCount": scriptData.count,
      "sha256": SHA256.hash(data: scriptData).map { String(format: "%02x", $0) }.joined(),
    ]
    try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
      .write(to: manifestURL, options: .atomic)
    return Self(
      directory: directory,
      indexURL: indexURL,
      scriptURL: scriptURL,
      manifestURL: manifestURL,
      indexSource: indexSource,
      scriptSource: scriptSource
    )
  }

  func remove() {
    try? FileManager.default.removeItem(at: directory)
  }
}
