import Foundation
import StoreKit

enum GardenRenderStyle: String, Codable, CaseIterable, Identifiable, Sendable {
  case twilight
  case handDrawn = "hand-drawn"
  case stopMotion = "stop-motion"
  case crochet
  case claymation

  var id: Self { self }
  var isPremium: Bool { self != .twilight }
}

enum PremiumGardenProduct {
  // This source identifier is intentionally unconfigured in App Store Connect.
  // Creating and pricing the product remains a separate release operation.
  static let id = "com.philipps.arrivewithin.garden.materialstyles"
  static let proposedUSDPrice = "$4.99"
}

struct PremiumGardenAccessSnapshot: Equatable, Sendable {
  let isOwned: Bool
  let productIsAvailable: Bool
  let displayPrice: String?

  static let unavailable = Self(
    isOwned: false,
    productIsAvailable: false,
    displayPrice: nil
  )
}

enum PremiumGardenPurchaseOutcome: Equatable, Sendable {
  case purchased(PremiumGardenAccessSnapshot)
  case pending
  case cancelled
}

enum PremiumGardenPurchaseError: Error, Equatable {
  case productUnavailable
  case failedVerification
  case wrongProduct
}

@MainActor
protocol PremiumGardenPurchaseClient: AnyObject {
  func refresh() async -> PremiumGardenAccessSnapshot
  func purchase() async throws -> PremiumGardenPurchaseOutcome
  func restore() async throws -> PremiumGardenAccessSnapshot
  func entitlementUpdates() -> AsyncStream<Void>
}

@MainActor
final class StoreKitPremiumGardenPurchaseClient: PremiumGardenPurchaseClient {
  private var product: Product?

  func refresh() async -> PremiumGardenAccessSnapshot {
    async let owned = ownsProduct()
    if product == nil {
      product = try? await Product.products(for: [PremiumGardenProduct.id]).first
    }
    return PremiumGardenAccessSnapshot(
      isOwned: await owned,
      productIsAvailable: product != nil,
      displayPrice: product?.displayPrice
    )
  }

  func purchase() async throws -> PremiumGardenPurchaseOutcome {
    if product == nil {
      product = try? await Product.products(for: [PremiumGardenProduct.id]).first
    }
    guard let product else { throw PremiumGardenPurchaseError.productUnavailable }
    switch try await product.purchase() {
    case .success(let verification):
      let transaction = try verified(verification)
      guard transaction.productID == PremiumGardenProduct.id else {
        throw PremiumGardenPurchaseError.wrongProduct
      }
      await transaction.finish()
      return .purchased(await refresh())
    case .pending:
      return .pending
    case .userCancelled:
      return .cancelled
    @unknown default:
      return .cancelled
    }
  }

  func restore() async throws -> PremiumGardenAccessSnapshot {
    try await AppStore.sync()
    return await refresh()
  }

  func entitlementUpdates() -> AsyncStream<Void> {
    AsyncStream { continuation in
      let task = Task {
        for await result in Transaction.updates {
          guard !Task.isCancelled,
            case .verified(let transaction) = result,
            transaction.productID == PremiumGardenProduct.id
          else { continue }
          await transaction.finish()
          continuation.yield(())
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  private func ownsProduct() async -> Bool {
    for await result in Transaction.currentEntitlements {
      guard case .verified(let transaction) = result,
        transaction.productID == PremiumGardenProduct.id,
        transaction.revocationDate == nil
      else { continue }
      return true
    }
    return false
  }

  private func verified(
    _ result: VerificationResult<Transaction>
  ) throws -> Transaction {
    switch result {
    case .verified(let transaction): transaction
    case .unverified: throw PremiumGardenPurchaseError.failedVerification
    }
  }
}

@MainActor
final class FixedPremiumGardenPurchaseClient: PremiumGardenPurchaseClient {
  private var snapshot: PremiumGardenAccessSnapshot
  private let purchaseSucceeds: Bool

  init(
    snapshot: PremiumGardenAccessSnapshot = .unavailable,
    purchaseSucceeds: Bool = false
  ) {
    self.snapshot = snapshot
    self.purchaseSucceeds = purchaseSucceeds
  }

  func refresh() async -> PremiumGardenAccessSnapshot { snapshot }

  func purchase() async throws -> PremiumGardenPurchaseOutcome {
    guard snapshot.productIsAvailable else {
      throw PremiumGardenPurchaseError.productUnavailable
    }
    if purchaseSucceeds {
      snapshot = PremiumGardenAccessSnapshot(
        isOwned: true,
        productIsAvailable: true,
        displayPrice: snapshot.displayPrice
      )
      return .purchased(snapshot)
    }
    return .cancelled
  }

  func restore() async -> PremiumGardenAccessSnapshot { snapshot }

  func entitlementUpdates() -> AsyncStream<Void> {
    AsyncStream { $0.finish() }
  }
}
