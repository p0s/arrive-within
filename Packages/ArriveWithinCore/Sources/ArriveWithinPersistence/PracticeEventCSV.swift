import ArriveWithinDomain
import Foundation

enum PracticeEventCSV {
  static func encode(_ events: [PracticeEvent]) -> String {
    let header = [
      "event_id", "session_id", "profile_generation_id", "mode", "guided_content_id",
      "guided_content_version", "started_at_utc", "ended_at_utc", "active_milliseconds",
      "qualifies_for_growth", "practice_local_date", "calendar_id", "time_zone_id",
      "source_installation_id", "created_at_utc",
    ]
    let rows = events.map { event in
      [
        event.id.uuidString,
        event.sessionID.uuidString,
        event.profileGenerationID.uuidString,
        event.mode.rawValue,
        event.guidedContentID ?? "",
        event.guidedContentVersion.map(String.init) ?? "",
        event.startedAt.ISO8601Format(),
        event.endedAt.ISO8601Format(),
        String(event.activeMilliseconds),
        event.qualifiesForGrowth ? "true" : "false",
        event.practiceDay.localDate,
        event.practiceDay.calendarIdentifier,
        event.practiceDay.timeZoneIdentifier,
        event.sourceInstallationID.uuidString,
        event.createdAt.ISO8601Format(),
      ].map(csvField).joined(separator: ",")
    }
    return ([header.map(csvField).joined(separator: ",")] + rows).joined(separator: "\n") + "\n"
  }

  private static func csvField(_ value: String) -> String {
    "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
  }
}
