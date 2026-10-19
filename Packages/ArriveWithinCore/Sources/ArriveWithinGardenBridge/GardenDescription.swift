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
        return "A young tree rests in a quiet \(englishPhase(state.localDayPhase)) clearing. Complete a three-minute practice to begin its growth."
      }
      return "Your \(englishPhase(state.localDayPhase)) garden reflects \(state.qualifyingSessionCount) qualifying practices and journey day \(state.journeyDay). \(englishMilestone(state.highestMilestone))"
    case .german:
      if state.journeyDay == 0 {
        return "Ein junger Baum ruht auf einer stillen Lichtung \(germanPhase(state.localDayPhase)). Mit einer dreiminütigen Meditation beginnt sein Wachstum."
      }
      return "Dein Garten \(germanPhase(state.localDayPhase)) zeigt \(state.qualifyingSessionCount) qualifizierende Meditationen und Tag \(state.journeyDay) deines Weges. \(germanMilestone(state.highestMilestone))"
    }
  }

  private static func englishMilestone(_ milestone: Int) -> String {
    guard milestone > 0 else { return "Its first permanent growth is visible." }
    if milestone >= 15 {
      return "Milestone 15 of 15 completes the open timber pavilion, birds, and quiet grass wildlife."
    }
    if milestone >= 11 {
      return "Milestone \(milestone) of 15 is present, and birds now inhabit the garden."
    }
    return "Milestone \(milestone) of 15 is present in the garden."
  }

  private static func germanMilestone(_ milestone: Int) -> String {
    guard milestone > 0 else { return "Sein erstes dauerhaftes Wachstum ist sichtbar." }
    if milestone >= 15 {
      return "Meilenstein 15 von 15 vollendet den offenen Holzpavillon, die Vögel und die stillen Tiere im Gras."
    }
    if milestone >= 11 {
      return "Meilenstein \(milestone) von 15 ist im Garten sichtbar, und Vögel leben nun dort."
    }
    return "Meilenstein \(milestone) von 15 ist im Garten sichtbar."
  }

  private static func englishPhase(_ phase: GardenDayPhase?) -> String {
    switch phase ?? .day {
    case .dawn: "dawn"
    case .day: "daytime"
    case .dusk: "dusk"
    case .night: "night"
    }
  }

  private static func germanPhase(_ phase: GardenDayPhase?) -> String {
    switch phase ?? .day {
    case .dawn: "im Morgengrauen"
    case .day: "am Tag"
    case .dusk: "in der Abenddämmerung"
    case .night: "bei Nacht"
    }
  }
}
