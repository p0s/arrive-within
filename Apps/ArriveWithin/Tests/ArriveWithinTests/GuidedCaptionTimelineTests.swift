import XCTest
@testable import ArriveWithin

final class GuidedCaptionTimelineTests: XCTestCase {
  func testParsesHoursMinutesAndCueIdentifiers() throws {
    let document = """
      WEBVTT

      opening
      00:00.000 --> 00:02.500
      Arrive here.

      00:00:03.000 --> 00:00:05.250 align:start
      Feel the ground
      beneath you.
      """

    let timeline = try XCTUnwrap(GuidedCaptionTimeline.parse(id: "G01-en", document: document))
    XCTAssertEqual(timeline.cues.count, 2)
    XCTAssertEqual(timeline.cues[0].startMilliseconds, 0)
    XCTAssertEqual(timeline.cues[0].endMilliseconds, 2_500)
    XCTAssertEqual(timeline.cues[1].startMilliseconds, 3_000)
    XCTAssertEqual(timeline.cues[1].endMilliseconds, 5_250)
    XCTAssertEqual(timeline.cues[1].text, "Feel the ground beneath you.")
  }

  func testFindsCurrentCueAtBoundaries() throws {
    let timeline = try XCTUnwrap(
      GuidedCaptionTimeline.parse(
        id: "G01-en",
        document: """
          WEBVTT

          00:00.000 --> 00:01.000
          First

          00:01.000 --> 00:02.000
          Second
          """
      )
    )

    XCTAssertEqual(timeline.cue(at: 0)?.text, "First")
    XCTAssertEqual(timeline.cue(at: 999)?.text, "First")
    XCTAssertEqual(timeline.cue(at: 1_000)?.text, "Second")
    XCTAssertNil(timeline.cue(at: 2_000))
  }

  func testRejectsOverlapMalformedTimingAndEmptyDocuments() {
    XCTAssertNil(
      GuidedCaptionTimeline.parse(
        id: "overlap",
        document: """
          WEBVTT

          00:00.000 --> 00:02.000
          First

          00:01.500 --> 00:03.000
          Second
          """
      )
    )
    XCTAssertNil(
      GuidedCaptionTimeline.parse(
        id: "malformed",
        document: "WEBVTT\n\nnot timing\nText"
      )
    )
  }
}
