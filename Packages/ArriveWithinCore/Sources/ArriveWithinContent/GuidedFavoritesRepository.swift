import Foundation

public protocol GuidedFavoritesRepository: Sendable {
  func loadFavoritePracticeIDs() async throws -> Set<String>
  func saveFavoritePracticeIDs(_ identifiers: Set<String>) async throws
}

public actor EphemeralGuidedFavoritesRepository: GuidedFavoritesRepository {
  private var identifiers: Set<String>

  public init(identifiers: Set<String> = []) {
    self.identifiers = identifiers
  }

  public func loadFavoritePracticeIDs() -> Set<String> { identifiers }

  public func saveFavoritePracticeIDs(_ identifiers: Set<String>) {
    self.identifiers = identifiers
  }
}
