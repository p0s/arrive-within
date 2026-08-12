import Foundation

enum AppLocalization {
  static func string(_ key: String, locale: Locale) -> String {
    let language = locale.language.languageCode?.identifier == "de" ? "de" : "en"
    guard
      let localizedPath = Bundle.main.path(forResource: language, ofType: "lproj"),
      let localizedBundle = Bundle(path: localizedPath)
    else {
      return NSLocalizedString(key, bundle: .main, value: key, comment: "")
    }
    return NSLocalizedString(key, bundle: localizedBundle, value: key, comment: "")
  }
}
