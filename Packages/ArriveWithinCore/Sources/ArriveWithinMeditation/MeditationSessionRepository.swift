import Foundation

public protocol MeditationSessionRepository: Sendable {
  func activeSession(profileGenerationID: UUID) async throws -> MeditationSession?
  func save(_ session: MeditationSession) async throws
  func remove(sessionID: UUID, profileGenerationID: UUID) async throws
}
