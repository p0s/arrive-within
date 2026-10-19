import Foundation

struct GuidedCaptionCue: Equatable, Hashable, Identifiable, Sendable {
  let startMilliseconds: Int64
  let endMilliseconds: Int64
  let text: String

  var id: String { "\(startMilliseconds)-\(endMilliseconds)-\(text)" }
}

struct GuidedCaptionTimeline: Equatable, Identifiable, Sendable {
  let id: String
  let cues: [GuidedCaptionCue]

  func cue(at elapsedMilliseconds: Int64) -> GuidedCaptionCue? {
    var lowerBound = 0
    var upperBound = cues.count

    while lowerBound < upperBound {
      let index = (lowerBound + upperBound) / 2
      if cues[index].startMilliseconds <= elapsedMilliseconds {
        lowerBound = index + 1
      } else {
        upperBound = index
      }
    }

    guard lowerBound > 0 else { return nil }
    let candidate = cues[lowerBound - 1]
    return elapsedMilliseconds < candidate.endMilliseconds ? candidate : nil
  }

  static func parse(id: String, document: String) -> GuidedCaptionTimeline? {
    let blocks = document
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .components(separatedBy: "\n\n")

    var parsed: [GuidedCaptionCue] = []
    for block in blocks {
      let lines = block.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
      guard let timingIndex = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
      let timingParts = lines[timingIndex].components(separatedBy: "-->")
      guard timingParts.count == 2,
        let start = timestampMilliseconds(timingParts[0]),
        let endToken = timingParts[1].split(whereSeparator: { $0.isWhitespace }).first,
        let end = timestampMilliseconds(String(endToken)),
        start >= 0,
        end > start
      else { return nil }

      let text = lines.dropFirst(timingIndex + 1)
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { return nil }
      parsed.append(
        GuidedCaptionCue(
          startMilliseconds: start,
          endMilliseconds: end,
          text: text
        )
      )
    }

    guard !parsed.isEmpty else { return nil }
    let ordered = parsed.sorted {
      if $0.startMilliseconds == $1.startMilliseconds {
        return $0.endMilliseconds < $1.endMilliseconds
      }
      return $0.startMilliseconds < $1.startMilliseconds
    }
    guard zip(ordered, ordered.dropFirst()).allSatisfy({ pair in
      pair.0.endMilliseconds <= pair.1.startMilliseconds
    })
    else { return nil }
    return GuidedCaptionTimeline(id: id, cues: ordered)
  }

  private static func timestampMilliseconds(_ raw: String) -> Int64? {
    let timestamp = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let components = timestamp.split(separator: ":", omittingEmptySubsequences: false)
    guard components.count == 2 || components.count == 3 else { return nil }

    let hours: Int64
    let minutes: Int64
    let secondsToken: Substring
    if components.count == 3 {
      guard let parsedHours = Int64(components[0]), let parsedMinutes = Int64(components[1]) else {
        return nil
      }
      hours = parsedHours
      minutes = parsedMinutes
      secondsToken = components[2]
    } else {
      guard let parsedMinutes = Int64(components[0]) else { return nil }
      hours = 0
      minutes = parsedMinutes
      secondsToken = components[1]
    }

    let secondsParts = secondsToken
      .replacingOccurrences(of: ",", with: ".")
      .split(separator: ".", omittingEmptySubsequences: false)
    guard secondsParts.count == 2,
      let seconds = Int64(secondsParts[0]),
      let milliseconds = Int64(secondsParts[1]),
      minutes >= 0,
      minutes < 60,
      seconds >= 0,
      seconds < 60,
      secondsParts[1].count == 3,
      milliseconds >= 0,
      milliseconds < 1_000
    else { return nil }

    return (((hours * 60) + minutes) * 60 + seconds) * 1_000 + milliseconds
  }
}

enum GuidedCaptionLoader {
  static func load(
    practiceID: String,
    languageCode: String,
    bundle: Bundle = .main
  ) -> GuidedCaptionTimeline? {
    guard practiceID.count <= 16,
      practiceID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }),
      languageCode == "en" || languageCode == "de",
      let url = bundle.url(
        forResource: "transcript.\(languageCode)",
        withExtension: "vtt",
        subdirectory: "guided/\(practiceID)"
      ),
      let document = try? String(contentsOf: url, encoding: .utf8)
    else { return nil }

    return GuidedCaptionTimeline.parse(
      id: "\(practiceID)-\(languageCode)",
      document: document
    )
  }
}
