import Testing

@testable import ArriveWithin

@Suite("Semantic design and motion")
struct SemanticDesignMotionTests {
  @Test("Motion rhythms remain calm, ordered, and bounded")
  func motionRhythms() {
    #expect(AppMotion.Rhythm.instant == 0)
    #expect(AppMotion.Rhythm.quick > AppMotion.Rhythm.instant)
    #expect(AppMotion.Rhythm.gentle > AppMotion.Rhythm.quick)
    #expect(AppMotion.Rhythm.reveal > AppMotion.Rhythm.gentle)
    #expect(AppMotion.Rhythm.reveal < 1)
  }

  @Test("Reduced Motion removes nonessential quick and gentle animation")
  func reducedMotion() {
    #expect(AppMotion.quick(reduceMotion: true) == nil)
    #expect(AppMotion.gentle(reduceMotion: true) == nil)
    #expect(AppMotion.quick(reduceMotion: false) != nil)
    #expect(AppMotion.gentle(reduceMotion: false) != nil)
  }

  @Test("Semantic sizing preserves readable content and touch targets")
  func semanticSizing() {
    #expect(AppTheme.maximumReadableWidth == 680)
    #expect(AppTheme.Size.minimumTouchTarget >= 44)
    #expect(AppTheme.Spacing.compact < AppTheme.Spacing.standard)
    #expect(AppTheme.Spacing.standard < AppTheme.Spacing.generous)
    #expect(AppTheme.Spacing.generous < AppTheme.Spacing.spacious)
  }
}
