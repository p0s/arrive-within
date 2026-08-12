import ArriveWithinDomain
import Foundation

public enum GardenDescriptionLanguage: String, Codable, Sendable {
  case english = "en"
  case german = "de"
}

public enum GardenDescription {
  public static func text(
    for state: GardenState,
    language: GardenDescriptionLanguage
  ) -> String {
    switch language {
    case .english:
      if state.journeyDay == 0 {
        return "A young tree rests in a quiet clearing. Complete a three-minute practice to begin its growth."
      }
      return "Your tree reflects \(state.qualifyingSessionCount) qualifying practices and journey day \(state.journeyDay). \(englishMilestone(state.highestMilestone))"
    case .german:
      if state.journeyDay == 0 {
        return "Ein junger Baum ruht auf einer stillen Lichtung. Mit einer dreiminütigen Meditation beginnt sein Wachstum."
      }
      return "Dein Baum zeigt \(state.qualifyingSessionCount) qualifizierende Meditationen und Tag \(state.journeyDay) deines Weges. \(germanMilestone(state.highestMilestone))"
    }
  }

  private static func englishMilestone(_ milestone: Int) -> String {
    guard milestone > 0 else { return "Its first permanent growth is visible." }
    return "Milestone \(milestone) of 15 is present in the garden."
  }

  private static func germanMilestone(_ milestone: Int) -> String {
    guard milestone > 0 else { return "Sein erstes dauerhaftes Wachstum ist sichtbar." }
    return "Meilenstein \(milestone) von 15 ist im Garten sichtbar."
  }
}
