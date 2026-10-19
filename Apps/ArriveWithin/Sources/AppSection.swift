import SwiftUI

enum AppSection: String, CaseIterable, Hashable, Identifiable {
  case garden
  case practice
  case journey
  case journal

  var id: Self { self }

  var title: LocalizedStringKey {
    switch self {
    case .garden: "navigation.garden"
    case .practice: "navigation.practice"
    case .journey: "navigation.journey"
    case .journal: "navigation.journal"
    }
  }

  var systemImage: String {
    switch self {
    case .garden: "tree"
    case .practice: "circle.hexagongrid"
    case .journey: "point.topleft.down.to.point.bottomright.curvepath"
    case .journal: "book.closed"
    }
  }
}
