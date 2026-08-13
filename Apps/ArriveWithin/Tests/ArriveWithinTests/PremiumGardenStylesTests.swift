import Testing

@testable import ArriveWithin

@MainActor
@Suite("Premium Garden styles")
struct PremiumGardenStylesTests {
  @Test("Twilight is the only free style")
  func freeStyleBoundary() {
    #expect(GardenRenderStyle.allCases.filter { !$0.isPremium } == [.twilight])
    #expect(GardenRenderStyle.allCases.filter(\.isPremium).count == 4)
  }

  @Test("Native selector previews use the fixed renderer crop names")
  func previewResourceNames() {
    #expect(GardenRenderStyle.allCases.map { "garden-preview-\($0.rawValue)" } == [
      "garden-preview-twilight",
      "garden-preview-hand-drawn",
      "garden-preview-stop-motion",
      "garden-preview-crochet",
      "garden-preview-claymation",
    ])
  }

  @Test("Local purchase client grants the whole non-consumable style set once")
  func localPurchase() async throws {
    let client = FixedPremiumGardenPurchaseClient(
      snapshot: PremiumGardenAccessSnapshot(
        isOwned: false,
        productIsAvailable: true,
        displayPrice: "$4.99"
      ),
      purchaseSucceeds: true
    )
    let outcome = try await client.purchase()
    #expect(
      outcome
        == .purchased(
          PremiumGardenAccessSnapshot(
            isOwned: true,
            productIsAvailable: true,
            displayPrice: "$4.99"
          )))
    #expect(await client.refresh().isOwned)
    #expect(PremiumGardenProduct.id == "com.philipps.arrivewithin.garden.materialstyles")
  }

  @Test("Unavailable StoreKit never grants premium access")
  func unavailableDoesNotGrantAccess() async {
    let client = FixedPremiumGardenPurchaseClient()
    #expect(await client.refresh() == .unavailable)
    await #expect(throws: PremiumGardenPurchaseError.productUnavailable) {
      _ = try await client.purchase()
    }
  }
}
