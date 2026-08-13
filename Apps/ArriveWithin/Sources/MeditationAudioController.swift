import AVFAudio
import ArriveWithinMeditation
import CryptoKit
import Foundation

enum MeditationAudioControllerError: Error, Equatable {
  case missingAssetManifest
  case invalidAssetManifest
  case missingAsset(String)
  case assetHashMismatch(String)
  case narrationNotApproved(String, String)
  case invalidAudioFile(String)
}

@MainActor
protocol MeditationAudioControlling: AnyObject {
  var eventHandler: ((MeditationAudioSystemEvent) -> Void)? { get set }

  func validate(session: MeditationSession) throws
  func begin(session: MeditationSession) throws
  func pause()
  func resume(session: MeditationSession, elapsedMilliseconds: Int64) throws
  func setNarrationVolume(_ volume: Double)
  func setAmbienceVolume(_ volume: Double)
  func playIntervalBell()
  func finish(playClosingBell: Bool, targetReached: Bool)
  func stop()
  func rebuild()
}

@MainActor
final class NativeMeditationAudioController: NSObject, MeditationAudioControlling {
  var eventHandler: ((MeditationAudioSystemEvent) -> Void)?

  private let audioSession: AVAudioSession
  private let assets: BundledAudioAssetResolver
  private var engine = AVAudioEngine()
  private var bellPlayer = AVAudioPlayerNode()
  private var ambiencePlayer = AVAudioPlayerNode()
  private var narrationPlayer = AVAudioPlayerNode()
  private var currentSession: MeditationSession?
  private var openingBell: AVAudioPCMBuffer?
  private var closingBell: AVAudioPCMBuffer?
  private var ambience: AVAudioPCMBuffer?
  private var narrationFile: AVAudioFile?
  private var hasContinuousAudio = false
  private var graphIsReady = false
  private var audioSessionIsActive = false
  private var playbackGeneration = 0
  private var scheduledClosingBell = false
  private var narrationVolume = 1.0
  private var ambienceVolumeOverride: Double?
  private var narrationVolumeRamp: Task<Void, Never>?
  private var ambienceVolumeRamp: Task<Void, Never>?

  init(
    audioSession: AVAudioSession = .sharedInstance(),
    bundle: Bundle = .main
  ) throws {
    self.audioSession = audioSession
    self.assets = try BundledAudioAssetResolver(bundle: bundle)
    super.init()
    installNotifications()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  func validate(session: MeditationSession) throws {
    let audio = session.configuration.audio
    if audio.openingBellEnabled { _ = try assets.verifiedURL(id: "opening-bell-v1") }
    if audio.closingBellEnabled { _ = try assets.verifiedURL(id: "closing-bell-v1") }
    if let ambienceID = audio.ambienceID { _ = try assets.verifiedURL(id: ambienceID) }
    if session.mode == .guided {
      guard let contentID = session.guidedContentID,
        let language = audio.narrationLanguageCode,
        assets.approvedNarrationURL(contentID: contentID, languageCode: language) != nil
      else {
        throw MeditationAudioControllerError.narrationNotApproved(
          session.guidedContentID ?? "unknown",
          audio.narrationLanguageCode ?? "unknown"
        )
      }
    }
  }

  func begin(session: MeditationSession) throws {
    try validate(session: session)
    stop()
    narrationVolume = 1
    ambienceVolumeOverride = nil
    guard Self.rendersAudioOnCurrentTarget else {
      currentSession = session
      return
    }
    rebuildGraph()
    currentSession = session
    do {
      try configureAudioSession(for: session)
      try loadBuffers(for: session)
      guard connectGraphToLoadedMedia() else { return }
      try startGraph(for: session, resumedAtMilliseconds: nil)
    } catch {
      stop()
      throw error
    }
  }

  func pause() {
    guard graphIsReady else { return }
    narrationVolumeRamp?.cancel()
    ambienceVolumeRamp?.cancel()
    bellPlayer.pause()
    ambiencePlayer.pause()
    narrationPlayer.pause()
    engine.pause()
  }

  func resume(session: MeditationSession, elapsedMilliseconds: Int64) throws {
    currentSession = session
    guard Self.rendersAudioOnCurrentTarget else { return }
    let requiresContinuousAudio =
      session.mode == .guided || session.configuration.audio.ambienceID != nil
    guard requiresContinuousAudio else { return }
    if !graphIsReady {
      do {
        rebuildGraph()
        try configureAudioSession(for: session)
        try loadBuffers(for: session)
        guard connectGraphToLoadedMedia() else { return }
        try startGraph(for: session, resumedAtMilliseconds: elapsedMilliseconds)
      } catch {
        stop()
        throw error
      }
      return
    }

    do {
      try audioSession.setActive(true)
      audioSessionIsActive = true
      if !engine.isRunning { try engine.start() }
      if ambience != nil { ambiencePlayer.play() }
      if narrationFile != nil { narrationPlayer.play() }
      bellPlayer.play()
      if ambience != nil { rampAmbience(to: effectiveAmbienceVolume(for: session)) }
      if narrationFile != nil { rampNarration(to: narrationVolume) }
    } catch {
      stop()
      throw error
    }
  }

  func setNarrationVolume(_ volume: Double) {
    narrationVolume = min(1, max(0, volume))
    rampNarration(to: narrationVolume)
  }

  func setAmbienceVolume(_ volume: Double) {
    ambienceVolumeOverride = min(1, max(0, volume))
    if let currentSession {
      rampAmbience(to: effectiveAmbienceVolume(for: currentSession))
    }
  }

  func playIntervalBell() {
    guard Self.rendersAudioOnCurrentTarget,
      !hasContinuousAudio,
      graphIsReady,
      let closingBell
    else { return }
    do {
      try playOneShotBell(closingBell, stopControllerWhenFinished: false)
    } catch {
      stop()
    }
  }

  func finish(playClosingBell: Bool, targetReached: Bool) {
    guard Self.rendersAudioOnCurrentTarget else {
      stop()
      return
    }
    if graphIsReady {
      ambiencePlayer.stop()
      narrationPlayer.stop()
    }
    if playClosingBell, targetReached, scheduledClosingBell {
      return
    }
    playbackGeneration += 1
    guard playClosingBell else {
      stop()
      return
    }

    do {
      let buffer = try closingBell ?? loadBuffer(id: "closing-bell-v1")
      closingBell = buffer
      try playOneShotBell(buffer, stopControllerWhenFinished: true)
    } catch {
      stop()
    }
  }

  private func playOneShotBell(
    _ buffer: AVAudioPCMBuffer,
    stopControllerWhenFinished: Bool
  ) throws {
    if !graphIsReady {
      rebuildGraph()
      engine.connect(bellPlayer, to: engine.mainMixerNode, format: buffer.format)
      graphIsReady = true
    }
    let shouldStartEngine = !engine.isRunning
    if shouldStartEngine {
      try audioSession.setActive(true)
      audioSessionIsActive = true
    }
    bellPlayer.stop()
    let generation = playbackGeneration
    bellPlayer.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) {
      [weak self] _ in
      Task { @MainActor in
        guard let self, self.playbackGeneration == generation else { return }
        if stopControllerWhenFinished {
          self.stop()
        } else {
          self.engine.stop()
          if self.audioSessionIsActive {
            try? self.audioSession.setActive(false, options: .notifyOthersOnDeactivation)
            self.audioSessionIsActive = false
          }
        }
      }
    }

    if shouldStartEngine {
      engine.prepare()
      try engine.start()
    }
    bellPlayer.play()
  }

  func stop() {
    playbackGeneration += 1
    narrationVolumeRamp?.cancel()
    ambienceVolumeRamp?.cancel()
    narrationVolumeRamp = nil
    ambienceVolumeRamp = nil
    if graphIsReady {
      bellPlayer.stop()
      ambiencePlayer.stop()
      narrationPlayer.stop()
      engine.stop()
    }
    currentSession = nil
    openingBell = nil
    closingBell = nil
    ambience = nil
    narrationFile = nil
    hasContinuousAudio = false
    scheduledClosingBell = false
    if audioSessionIsActive {
      try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
      audioSessionIsActive = false
    }
  }

  func rebuild() {
    stop()
    graphIsReady = false
  }

  private func configureAudioSession(for session: MeditationSession) throws {
    let options: AVAudioSession.CategoryOptions =
      session.configuration.audio.otherAudioPolicy == .mixWithOthers
      ? [.mixWithOthers]
      : []
    try audioSession.setCategory(
      .playback,
      mode: session.mode == .guided ? .spokenAudio : .default,
      policy: .longFormAudio,
      options: options
    )
    try audioSession.setActive(true)
    audioSessionIsActive = true
  }

  private func loadBuffers(for session: MeditationSession) throws {
    let audio = session.configuration.audio
    openingBell = audio.openingBellEnabled ? try loadBuffer(id: "opening-bell-v1") : nil
    closingBell =
      audio.closingBellEnabled || audio.intervalBellMinutes != nil
      ? try loadBuffer(id: "closing-bell-v1")
      : nil
    ambience =
      if let ambienceID = audio.ambienceID {
        try loadBuffer(id: ambienceID)
      } else {
        nil
      }

    if session.mode == .guided {
      guard let contentID = session.guidedContentID,
        let language = audio.narrationLanguageCode
      else {
        throw MeditationAudioControllerError.narrationNotApproved("unknown", "unknown")
      }
      guard
        let narrationURL = assets.approvedNarrationURL(
          contentID: contentID,
          languageCode: language
        )
      else {
        throw MeditationAudioControllerError.narrationNotApproved(contentID, language)
      }
      narrationFile = try AVAudioFile(forReading: narrationURL)
    } else {
      narrationFile = nil
    }
    hasContinuousAudio = ambience != nil || narrationFile != nil
    scheduledClosingBell = false
  }

  private func startGraph(
    for session: MeditationSession,
    resumedAtMilliseconds: Int64?
  ) throws {
    let isResume = resumedAtMilliseconds != nil
    var bellHasScheduledContent = false
    if let ambience {
      ambiencePlayer.scheduleBuffer(ambience, at: nil, options: [.loops])
      ambiencePlayer.volume = 0
    }
    if let narrationFile {
      narrationPlayer.volume = 0
      let startFrame = min(
        narrationFile.length,
        AVAudioFramePosition(
          Double(resumedAtMilliseconds ?? 0)
            * narrationFile.processingFormat.sampleRate / 1_000
        )
      )
      let remaining = narrationFile.length - startFrame
      if remaining > 0, remaining <= AVAudioFramePosition(UInt32.max) {
        narrationPlayer.scheduleSegment(
          narrationFile,
          startingFrame: startFrame,
          frameCount: AVAudioFrameCount(remaining),
          at: nil
        )
      }
    }
    if let openingBell, !isResume {
      bellHasScheduledContent = true
      let generation = playbackGeneration
      bellPlayer.scheduleBuffer(openingBell, completionCallbackType: .dataPlayedBack) {
        [weak self] _ in
        Task { @MainActor in
          guard let self,
            self.playbackGeneration == generation,
            !self.hasContinuousAudio
          else { return }
          self.engine.stop()
          if self.audioSessionIsActive {
            try? self.audioSession.setActive(false, options: .notifyOthersOnDeactivation)
            self.audioSessionIsActive = false
          }
        }
      }
    }
    if hasContinuousAudio, !isResume, let closingBell {
      let sampleRate = closingBell.format.sampleRate
      if let intervalMinutes = session.configuration.audio.intervalBellMinutes,
        let target = session.targetDurationMilliseconds
      {
        let intervalMilliseconds = Int64(intervalMinutes) * 60_000
        var signalAt = intervalMilliseconds
        while signalAt < target {
          bellHasScheduledContent = true
          bellPlayer.scheduleBuffer(
            closingBell,
            at: AVAudioTime(
              sampleTime: AVAudioFramePosition(Double(signalAt) * sampleRate / 1_000),
              atRate: sampleRate
            ),
            options: []
          )
          signalAt += intervalMilliseconds
        }
      }
      if session.configuration.audio.closingBellEnabled,
        let target = session.targetDurationMilliseconds
      {
        bellHasScheduledContent = true
        scheduledClosingBell = true
        let generation = playbackGeneration
        bellPlayer.scheduleBuffer(
          closingBell,
          at: AVAudioTime(
            sampleTime: AVAudioFramePosition(Double(target) * sampleRate / 1_000),
            atRate: sampleRate
          ),
          options: [],
          completionCallbackType: .dataPlayedBack
        ) { [weak self] _ in
          Task { @MainActor in
            guard let self, self.playbackGeneration == generation else { return }
            self.stop()
          }
        }
      }
    }

    engine.prepare()
    try engine.start()
    if ambience != nil { ambiencePlayer.play() }
    if narrationFile != nil { narrationPlayer.play() }
    if bellHasScheduledContent { bellPlayer.play() }
    if ambience != nil { rampAmbience(to: effectiveAmbienceVolume(for: session)) }
    if narrationFile != nil { rampNarration(to: narrationVolume) }
  }

  private func effectiveAmbienceVolume(for session: MeditationSession) -> Double {
    min(1, max(0, ambienceVolumeOverride ?? session.configuration.audio.ambienceVolume))
  }

  private func rampNarration(to target: Double) {
    narrationVolumeRamp?.cancel()
    narrationVolumeRamp = ramp(player: narrationPlayer, to: target)
  }

  private func rampAmbience(to target: Double) {
    ambienceVolumeRamp?.cancel()
    ambienceVolumeRamp = ramp(player: ambiencePlayer, to: target)
  }

  private func ramp(player: AVAudioPlayerNode, to target: Double) -> Task<Void, Never> {
    let start = Double(player.volume)
    let boundedTarget = min(1, max(0, target))
    return Task { @MainActor [weak player] in
      guard let player else { return }
      for step in 1...8 {
        guard !Task.isCancelled else { return }
        try? await Task.sleep(for: .milliseconds(24))
        guard !Task.isCancelled else { return }
        let progress = Double(step) / 8
        player.volume = Float(start + (boundedTarget - start) * progress)
      }
    }
  }

  private func loadBuffer(id: String) throws -> AVAudioPCMBuffer {
    try Self.readBuffer(from: assets.verifiedURL(id: id))
  }

  private static func readBuffer(from url: URL) throws -> AVAudioPCMBuffer {
    let file = try AVAudioFile(forReading: url)
    guard file.length > 0,
      file.length <= AVAudioFramePosition(UInt32.max),
      let buffer = AVAudioPCMBuffer(
        pcmFormat: file.processingFormat,
        frameCapacity: AVAudioFrameCount(file.length)
      )
    else {
      throw MeditationAudioControllerError.invalidAudioFile(url.lastPathComponent)
    }
    try file.read(into: buffer)
    guard buffer.frameLength > 0 else {
      throw MeditationAudioControllerError.invalidAudioFile(url.lastPathComponent)
    }
    return buffer
  }

  private func rebuildGraph() {
    guard Self.rendersAudioOnCurrentTarget else { return }
    engine = AVAudioEngine()
    bellPlayer = AVAudioPlayerNode()
    ambiencePlayer = AVAudioPlayerNode()
    narrationPlayer = AVAudioPlayerNode()
    engine.attach(bellPlayer)
    engine.attach(ambiencePlayer)
    engine.attach(narrationPlayer)
    graphIsReady = false
  }

  @discardableResult
  private func connectGraphToLoadedMedia() -> Bool {
    var connected = false
    if let bellFormat = (openingBell ?? closingBell)?.format {
      engine.connect(bellPlayer, to: engine.mainMixerNode, format: bellFormat)
      connected = true
    }
    if let ambience {
      engine.connect(ambiencePlayer, to: engine.mainMixerNode, format: ambience.format)
      connected = true
    }
    if let narrationFile {
      engine.connect(
        narrationPlayer,
        to: engine.mainMixerNode,
        format: narrationFile.processingFormat
      )
      connected = true
    }
    graphIsReady = connected
    return connected
  }

  private static var rendersAudioOnCurrentTarget: Bool {
    #if targetEnvironment(simulator)
      false
    #else
      true
    #endif
  }

  private func installNotifications() {
    let center = NotificationCenter.default
    center.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: audioSession
    )
    center.addObserver(
      self,
      selector: #selector(handleRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: audioSession
    )
    center.addObserver(
      self,
      selector: #selector(handleMediaServicesReset(_:)),
      name: AVAudioSession.mediaServicesWereResetNotification,
      object: audioSession
    )
    center.addObserver(
      self,
      selector: #selector(handleEngineConfigurationChange(_:)),
      name: .AVAudioEngineConfigurationChange,
      object: nil
    )
  }

  @objc private func handleInterruption(_ notification: Notification) {
    guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    switch type {
    case .began:
      pause()
      eventHandler?(.interruptionBegan)
    case .ended:
      eventHandler?(.interruptionEnded)
    @unknown default:
      pause()
      eventHandler?(.interruptionBegan)
    }
  }

  @objc private func handleRouteChange(_ notification: Notification) {
    guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
    else { return }
    switch reason {
    case .oldDeviceUnavailable, .noSuitableRouteForCategory:
      pause()
      eventHandler?(.outputRouteLost)
    case .newDeviceAvailable, .routeConfigurationChange:
      eventHandler?(.outputRouteAvailable)
    default:
      break
    }
  }

  @objc private func handleMediaServicesReset(_ notification: Notification) {
    _ = notification
    eventHandler?(.mediaServicesReset)
  }

  @objc private func handleEngineConfigurationChange(_ notification: Notification) {
    guard let changedEngine = notification.object as? AVAudioEngine,
      changedEngine === engine
    else { return }
    eventHandler?(.engineConfigurationChanged)
  }
}

@MainActor
final class NoOpMeditationAudioController: MeditationAudioControlling {
  var eventHandler: ((MeditationAudioSystemEvent) -> Void)?

  func validate(session: MeditationSession) throws { _ = session }
  func begin(session: MeditationSession) throws { _ = session }
  func pause() {}
  func resume(session: MeditationSession, elapsedMilliseconds: Int64) throws {
    _ = session
    _ = elapsedMilliseconds
  }
  func setNarrationVolume(_ volume: Double) { _ = volume }
  func setAmbienceVolume(_ volume: Double) { _ = volume }
  func playIntervalBell() {}
  func finish(playClosingBell: Bool, targetReached: Bool) {
    _ = playClosingBell
    _ = targetReached
  }
  func stop() {}
  func rebuild() {}
}

@MainActor
final class UnavailableMeditationAudioController: MeditationAudioControlling {
  var eventHandler: ((MeditationAudioSystemEvent) -> Void)?

  func validate(session: MeditationSession) throws {
    _ = session
    throw MeditationAudioControllerError.missingAssetManifest
  }

  func begin(session: MeditationSession) throws { try validate(session: session) }
  func pause() {}
  func resume(session: MeditationSession, elapsedMilliseconds: Int64) throws {
    _ = elapsedMilliseconds
    try validate(session: session)
  }
  func setNarrationVolume(_ volume: Double) { _ = volume }
  func setAmbienceVolume(_ volume: Double) { _ = volume }
  func playIntervalBell() {}
  func finish(playClosingBell: Bool, targetReached: Bool) {
    _ = playClosingBell
    _ = targetReached
  }
  func stop() {}
  func rebuild() {}
}

struct BundledAudioAssetResolver {
  private struct Manifest: Decodable {
    let schemaVersion: Int
    let assets: [Entry]

    enum CodingKeys: String, CodingKey {
      case schemaVersion = "schema_version"
      case assets
    }
  }

  private struct Entry: Decodable {
    let id: String
    let path: String
    let sha256: String
  }

  private let bundle: Bundle
  private let entries: [String: Entry]

  init(bundle: Bundle) throws {
    self.bundle = bundle
    guard
      let manifestURL = Self.resourceURL(
        bundle: bundle,
        name: "audio-assets",
        extension: "json"
      )
    else {
      throw MeditationAudioControllerError.missingAssetManifest
    }
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
    guard manifest.schemaVersion == 1,
      manifest.assets.count == 3,
      Set(manifest.assets.map(\.id)).count == manifest.assets.count
    else {
      throw MeditationAudioControllerError.invalidAssetManifest
    }
    self.entries = Dictionary(uniqueKeysWithValues: manifest.assets.map { ($0.id, $0) })
  }

  func verifiedURL(id: String) throws -> URL {
    guard let entry = entries[id],
      !entry.path.contains(".."),
      let url = Self.resourceURL(
        bundle: bundle,
        name: URL(fileURLWithPath: entry.path).deletingPathExtension().lastPathComponent,
        extension: URL(fileURLWithPath: entry.path).pathExtension
      )
    else {
      throw MeditationAudioControllerError.missingAsset(id)
    }
    let actual = SHA256.hash(data: try Data(contentsOf: url))
      .map { String(format: "%02x", $0) }
      .joined()
    guard actual == entry.sha256 else {
      throw MeditationAudioControllerError.assetHashMismatch(id)
    }
    return url
  }

  func approvedNarrationURL(contentID: String, languageCode: String) -> URL? {
    Self.approvedNarrationURL(
      bundle: bundle, contentID: contentID, languageCode: languageCode)
  }

  static func packagedNarrationURL(
    bundle: Bundle,
    contentID: String,
    languageCode: String
  ) -> URL? {
    approvedNarrationAsset(
      bundle: bundle,
      contentID: contentID,
      languageCode: languageCode
    )?.audioURL
  }

  static func approvedNarrationURL(
    bundle: Bundle,
    contentID: String,
    languageCode: String
  ) -> URL? {
    guard let asset = approvedNarrationAsset(
      bundle: bundle,
      contentID: contentID,
      languageCode: languageCode
    ), asset.provenance.audioSHA256 == Self.sha256(asset.audioURL),
      asset.provenance.transcriptSHA256 == Self.sha256(asset.transcriptURL)
    else { return nil }
    return asset.audioURL
  }

  private static func approvedNarrationAsset(
    bundle: Bundle,
    contentID: String,
    languageCode: String
  ) -> (audioURL: URL, transcriptURL: URL, provenance: NarrationProvenance)? {
    guard ["en", "de"].contains(languageCode),
      contentID.range(of: #"^G(0[1-9]|[1-3][0-9]|4[0-2])$"#, options: .regularExpression) != nil,
      let audioURL = exactGuidedURL(
        bundle: bundle, contentID: contentID, name: "audio.\(languageCode).m4a"),
      let transcriptURL = exactGuidedURL(
        bundle: bundle, contentID: contentID, name: "transcript.\(languageCode).vtt"),
      let provenanceURL = exactGuidedURL(
        bundle: bundle,
        contentID: contentID,
        name: "provenance.\(languageCode).json"),
      let provenance = try? JSONDecoder().decode(
        NarrationProvenance.self,
        from: Data(contentsOf: provenanceURL)
      ),
      provenance.contentID == contentID,
      provenance.language == languageCode,
      provenance.rightsState == "approved",
      provenance.humanListeningState == "approved",
      provenance.scriptSafetyState == "approved",
      provenance.transcriptAlignmentState == "approved",
      provenance.productionMasterApproval,
      provenance.finishedTrackApproval
    else { return nil }
    return (audioURL, transcriptURL, provenance)
  }

  private static func exactGuidedURL(
    bundle: Bundle,
    contentID: String,
    name: String
  ) -> URL? {
    guard let resourceURL = bundle.resourceURL else { return nil }
    let url = resourceURL.appendingPathComponent("guided/\(contentID)/\(name)")
    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
      !isDirectory.boolValue
    else { return nil }
    return url
  }

  private struct NarrationProvenance: Decodable {
    let contentID: String
    let language: String
    let audioSHA256: String
    let transcriptSHA256: String
    let rightsState: String
    let humanListeningState: String
    let scriptSafetyState: String
    let transcriptAlignmentState: String
    let productionMasterApproval: Bool
    let finishedTrackApproval: Bool
  }

  private static func sha256(_ url: URL) -> String? {
    guard let stream = InputStream(url: url) else { return nil }
    stream.open()
    defer { stream.close() }
    var digest = SHA256()
    let capacity = 64 * 1024
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
    defer { buffer.deallocate() }
    while true {
      let count = stream.read(buffer, maxLength: capacity)
      if count < 0 { return nil }
      if count == 0 { break }
      digest.update(bufferPointer: UnsafeRawBufferPointer(start: buffer, count: count))
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private static func resourceURL(
    bundle: Bundle,
    name: String,
    extension fileExtension: String,
    subdirectory: String = "Audio"
  ) -> URL? {
    bundle.url(forResource: name, withExtension: fileExtension, subdirectory: subdirectory)
      ?? bundle.url(forResource: name, withExtension: fileExtension)
  }
}
