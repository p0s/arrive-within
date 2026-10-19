import ArriveWithinDomain
import ArriveWithinGardenBridge
import CryptoKit
import SwiftUI
import UIKit
import WebKit

struct GardenWebView: UIViewRepresentable {
  let state: GardenState
  let renderStyle: GardenRenderStyle
  let isActive: Bool
  let resetViewRequest: Int
  let onReady: () -> Void
  let onFailure: (String) -> Void
  let onObservation: (RendererObservation) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onReady: onReady, onFailure: onFailure, onObservation: onObservation)
  }

  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.preferences.isElementFullscreenEnabled = false

    let relaySource = """
      window.addEventListener('message', function(event) {
        const data = event.data;
        if (!data || data.channel !== 'arrive-within-renderer' || !data.event) return;
        window.webkit.messageHandlers.arriveWithinGarden.postMessage(data.event);
      });
      """
    let relay = WKUserScript(
      source: relaySource,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true,
      in: Coordinator.contentWorld
    )
    configuration.userContentController.addUserScript(relay)
    configuration.userContentController.addScriptMessageHandler(
      context.coordinator,
      contentWorld: Coordinator.contentWorld,
      name: Coordinator.handlerName
    )

    let rendererResources = RendererBundleResourceValidator.load(bundle: .main)
    if let rendererSource = rendererResources?.scriptSource {
      configuration.userContentController.addUserScript(
        WKUserScript(
          source: rendererSource,
          injectionTime: .atDocumentEnd,
          forMainFrameOnly: true,
          in: Coordinator.contentWorld
        )
      )
    }

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.isOpaque = true
    webView.scrollView.isScrollEnabled = false
    webView.scrollView.bounces = false
    webView.navigationDelegate = context.coordinator
    context.coordinator.webView = webView
    context.coordinator.pendingState = state
    context.coordinator.pendingRenderStyle = renderStyle
    context.coordinator.pendingActiveState = isActive

    guard let rendererResources else {
      onObservation(.error(.bundleValidationFailed))
      onFailure("The bundled renderer is missing.")
      return webView
    }
    let indexURL = rendererResources.indexURL
    let allowedDirectory = indexURL.deletingLastPathComponent().standardizedFileURL
    context.coordinator.allowedDirectory = allowedDirectory
    webView.loadHTMLString(rendererResources.indexSource, baseURL: allowedDirectory)
    return webView
  }

  func updateUIView(_ webView: WKWebView, context: Context) {
    context.coordinator.pendingState = state
    context.coordinator.pendingRenderStyle = renderStyle
    context.coordinator.pendingActiveState = isActive
    context.coordinator.sendPendingStateIfReady()
    context.coordinator.sendPendingRenderStyleIfReady()
    context.coordinator.sendPendingActiveStateIfReady()
    context.coordinator.requestViewReset(resetViewRequest)
  }

  static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.configuration.userContentController.removeScriptMessageHandler(
      forName: Coordinator.handlerName,
      contentWorld: Coordinator.contentWorld
    )
    coordinator.stop()
  }

  @MainActor
  final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    static let handlerName = "arriveWithinGarden"
    static let contentWorld = WKContentWorld.world(name: "ArriveWithinGardenBridge")
    weak var webView: WKWebView?
    var allowedDirectory: URL?
    var pendingState: GardenState?
    var pendingRenderStyle: GardenRenderStyle = .twilight
    var pendingActiveState = true
    var lastSentState: GardenState?
    private var lastSentRenderStyle: GardenRenderStyle?
    private var lastSentActiveState: Bool?
    private var rendererIsReady = false
    private var contextRecoveryTask: Task<Void, Never>?
    private var didInjectUITestContextCycle = false
    private var latestResetRequest = 0
    private var appliedResetRequest = 0
    private var memoryWarningObserver: NSObjectProtocol?
    private let onReady: () -> Void
    private let onFailure: (String) -> Void
    private let onObservation: (RendererObservation) -> Void

    init(
      onReady: @escaping () -> Void,
      onFailure: @escaping (String) -> Void,
      onObservation: @escaping (RendererObservation) -> Void
    ) {
      self.onReady = onReady
      self.onFailure = onFailure
      self.onObservation = onObservation
      super.init()
      memoryWarningObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didReceiveMemoryWarningNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          guard let self else { return }
          self.rendererIsReady = false
          self.onObservation(.error(.memoryPressureFallback))
          self.onFailure("The garden switched to its native view to free memory.")
        }
      }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
      rendererIsReady = false
      lastSentState = nil
      lastSentRenderStyle = nil
      lastSentActiveState = nil
    }

    func webView(
      _ webView: WKWebView,
      didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: any Error
    ) {
      onObservation(.error(.bundleValidationFailed))
      onFailure("The bundled renderer could not load.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      rendererIsReady = false
      contextRecoveryTask?.cancel()
      onObservation(.error(.webContentProcessTerminated))
      onFailure("The garden renderer process stopped.")
    }

    func webView(
      _ webView: WKWebView,
      decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
      guard navigationAction.targetFrame?.isMainFrame != false else { return .cancel }
      guard let url = navigationAction.request.url else { return .cancel }
      if url.scheme == "about" { return .allow }
      if url.isFileURL, let allowedDirectory {
        let rootPath = allowedDirectory.path
        let candidatePath = url.standardizedFileURL.path
        if candidatePath == rootPath || candidatePath.hasPrefix(rootPath + "/") {
          return .allow
        }
      }
      onObservation(.error(.navigationBlocked))
      onFailure("Renderer navigation was blocked.")
      return .cancel
    }

    func userContentController(
      _ userContentController: WKUserContentController,
      didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
      guard message.frameInfo.isMainFrame,
        let body = message.body as? [String: Any],
        let event = RendererEventValidator.decode(body)
      else {
        return (nil, "Rejected renderer event")
      }
      switch event {
      case .ready:
        rendererIsReady = true
        contextRecoveryTask?.cancel()
        onObservation(.diagnostic(.ready))
        onReady()
        sendPendingStateIfReady()
        sendPendingRenderStyleIfReady()
        sendPendingActiveStateIfReady()
        sendPendingViewResetIfReady()
        injectUITestContextCycleIfNeeded()
      case .interaction:
        break
      case .observation(.diagnostic(let code)):
        handleDiagnostic(code)
      case .observation(.error(let code)):
        rendererIsReady = false
        onObservation(.error(code))
        onFailure("The living garden reported a recoverable error.")
      case .observation(let observation):
        onObservation(observation)
      }
      return (["accepted": true], nil)
    }

    func sendPendingStateIfReady() {
      guard rendererIsReady, let webView, let state = pendingState, state != lastSentState else {
        return
      }
      do {
        let data = try GardenBridgeCodec.encodeSnapshot(state, requestID: UUID())
        guard let json = String(data: data, encoding: .utf8) else {
          onObservation(.error(.snapshotEncodingFailed))
          onFailure("The garden snapshot could not be encoded.")
          return
        }
        webView.callAsyncJavaScript(
          "window.arriveWithinGarden?.receiveSnapshot(snapshot); return true;",
          arguments: ["snapshot": json],
          in: nil,
          in: Coordinator.contentWorld
        ) { [weak self] result in
          guard let self else { return }
          switch result {
          case .success:
            self.lastSentState = state
          case .failure:
            self.onObservation(.error(.snapshotDisplayFailed))
            self.onFailure("The garden snapshot could not be displayed.")
          }
        }
      } catch {
        onObservation(.error(.snapshotEncodingFailed))
        onFailure("The garden snapshot exceeded its safe bridge contract.")
      }
    }

    func sendPendingRenderStyleIfReady() {
      guard rendererIsReady,
        let webView,
        pendingRenderStyle != lastSentRenderStyle
      else { return }
      let style = pendingRenderStyle
      webView.callAsyncJavaScript(
        "window.arriveWithinGarden?.setRenderStyle(style); return true;",
        arguments: ["style": style.rawValue],
        in: nil,
        in: Self.contentWorld
      ) { [weak self] result in
        guard let self else { return }
        if case .success(let value) = result, value as? Bool == true {
          self.lastSentRenderStyle = style
        } else {
          self.onObservation(.error(.snapshotDisplayFailed))
          self.onFailure("The garden style could not be applied.")
        }
      }
    }

    func sendPendingActiveStateIfReady() {
      guard rendererIsReady,
        let webView,
        pendingActiveState != lastSentActiveState
      else { return }
      let active = pendingActiveState
      webView.callAsyncJavaScript(
        "window.arriveWithinGarden?.setActive(active); return true;",
        arguments: ["active": active],
        in: nil,
        in: Self.contentWorld
      ) { [weak self] result in
        guard let self else { return }
        if case .success(let value) = result, value as? Bool == true {
          self.lastSentActiveState = active
        } else {
          self.onObservation(.error(.snapshotDisplayFailed))
          self.onFailure("The garden activity state could not be applied.")
        }
      }
    }

    func stop() {
      contextRecoveryTask?.cancel()
      if let memoryWarningObserver {
        NotificationCenter.default.removeObserver(memoryWarningObserver)
        self.memoryWarningObserver = nil
      }
      webView = nil
    }

    func requestViewReset(_ request: Int) {
      latestResetRequest = request
      sendPendingViewResetIfReady()
    }

    private func sendPendingViewResetIfReady() {
      guard rendererIsReady,
        let webView,
        latestResetRequest != appliedResetRequest
      else { return }
      let request = latestResetRequest
      webView.callAsyncJavaScript(
        "window.arriveWithinGarden?.resetView(); return true;",
        arguments: [:],
        in: nil,
        in: Self.contentWorld
      ) { [weak self] result in
        guard let self else { return }
        if case .success(let value) = result, value as? Bool == true {
          self.appliedResetRequest = request
        } else {
          self.onObservation(.error(.viewResetFailed))
        }
      }
    }

    private func handleDiagnostic(_ code: RendererDiagnosticCode) {
      onObservation(.diagnostic(code))
      switch code {
      case .contextLost:
        rendererIsReady = false
        contextRecoveryTask?.cancel()
        contextRecoveryTask = Task { @MainActor [weak self] in
          try? await Task.sleep(for: .seconds(4))
          guard !Task.isCancelled, let self, !self.rendererIsReady else { return }
          self.onObservation(.error(.contextRecoveryTimedOut))
          self.onFailure("The living garden could not recover in time.")
        }
      case .contextRestored:
        contextRecoveryTask?.cancel()
        rendererIsReady = true
        lastSentState = nil
        lastSentRenderStyle = nil
        onReady()
        sendPendingStateIfReady()
        sendPendingRenderStyleIfReady()
        sendPendingActiveStateIfReady()
        sendPendingViewResetIfReady()
      default:
        break
      }
    }

    private func injectUITestContextCycleIfNeeded() {
      #if DEBUG
        guard !didInjectUITestContextCycle,
          ProcessInfo.processInfo.arguments.contains("-ui-test-renderer-context-cycle"),
          let webView
        else { return }
        didInjectUITestContextCycle = true
        webView.callAsyncJavaScript(
          """
          const canvas = document.getElementById('garden-canvas');
          const context = canvas?.getContext('webgl2');
          const extension = context?.getExtension('WEBGL_lose_context');
          if (!extension) return false;
          setTimeout(() => {
            extension.loseContext();
            setTimeout(() => extension.restoreContext(), 600);
          }, 600);
          return true;
          """,
          arguments: [:],
          in: nil,
          in: Self.contentWorld
        ) { [weak self] result in
          guard let self else { return }
          if case .success(let value) = result, value as? Bool == true { return }
          self.onObservation(.error(.testContextInjectionUnavailable))
          self.onFailure("The renderer context test hook was unavailable.")
        }
      #endif
    }
  }
}

struct RendererBundleResources {
  let indexURL: URL
  let indexSource: String
  let scriptSource: String
}

enum RendererBundleResourceValidator {
  static func load(bundle: Bundle) -> RendererBundleResources? {
    for subdirectory in ["GardenRenderer", "dist"] {
      let indexURL = bundle.bundleURL
        .appending(path: subdirectory, directoryHint: .isDirectory)
        .appending(path: "index.html", directoryHint: .notDirectory)
      if let resources = load(indexURL: indexURL) {
        return resources
      }
    }
    return nil
  }

  static func load(indexURL: URL) -> RendererBundleResources? {
    let directory = indexURL.deletingLastPathComponent()
    let scriptURL = directory.appendingPathComponent("renderer.js", isDirectory: false)
    let manifestURL = directory.appendingPathComponent(
      "renderer-manifest.json",
      isDirectory: false
    )
    guard let indexData = try? Data(contentsOf: indexURL, options: [.mappedIfSafe]),
      let scriptData = try? Data(contentsOf: scriptURL, options: [.mappedIfSafe]),
      let manifestData = try? Data(contentsOf: manifestURL),
      let manifest = try? JSONDecoder().decode(RendererManifest.self, from: manifestData),
      manifest.schemaVersion == 1,
      manifest.entry == "renderer.js",
      manifest.byteCount == scriptData.count,
      manifest.sha256 == SHA256.hash(data: scriptData).hexadecimalString,
      let indexSource = String(data: indexData, encoding: .utf8),
      let scriptSource = String(data: scriptData, encoding: .utf8)
    else {
      return nil
    }
    return RendererBundleResources(
      indexURL: indexURL,
      indexSource: indexSource,
      scriptSource: scriptSource
    )
  }

  private struct RendererManifest: Decodable {
    let schemaVersion: Int
    let entry: String
    let byteCount: Int
    let sha256: String
  }
}

extension SHA256.Digest {
  fileprivate var hexadecimalString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
