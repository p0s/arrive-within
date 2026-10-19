import Foundation

public enum JournalSearch {
  public static func filter(
    _ entries: [JournalEntry],
    query: String,
    locale: Locale,
    timeZone: TimeZone
  ) -> [JournalEntry] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return entries }
    let shortDate = dateFormatter(style: .short, locale: locale, timeZone: timeZone)
    let mediumDate = dateFormatter(style: .medium, locale: locale, timeZone: timeZone)
    return entries.filter { entry in
      entry.text.localizedCaseInsensitiveContains(query)
        || entry.transcript?.text.localizedCaseInsensitiveContains(query) == true
        || shortDate.string(from: entry.createdAt).localizedCaseInsensitiveContains(query)
        || mediumDate.string(from: entry.createdAt).localizedCaseInsensitiveContains(query)
    }
  }

  private static func dateFormatter(
    style: DateFormatter.Style,
    locale: Locale,
    timeZone: TimeZone
  ) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = timeZone
    formatter.dateStyle = style
    formatter.timeStyle = .none
    return formatter
  }
}
