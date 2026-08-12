import Foundation

public enum GardenElement: String, Codable, CaseIterable, Sendable {
  case earth
  case water
  case fire
  case air
  case space
}

public struct GardenVariantDefinition: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let englishTitle: String
  public let germanTitle: String

  public init(id: String, englishTitle: String, germanTitle: String) {
    self.id = id
    self.englishTitle = englishTitle
    self.germanTitle = germanTitle
  }
}

public struct GardenMilestoneDefinition: Codable, Equatable, Identifiable, Sendable {
  public let id: Int
  public let practiceDay: Int
  public let element: GardenElement
  public let tier: Int
  public let englishTitle: String
  public let germanTitle: String
  public let englishWorldChange: String
  public let germanWorldChange: String
  public let variants: [GardenVariantDefinition]

  public init(
    id: Int,
    practiceDay: Int,
    element: GardenElement,
    tier: Int,
    englishTitle: String,
    germanTitle: String,
    englishWorldChange: String,
    germanWorldChange: String,
    variants: [GardenVariantDefinition]
  ) {
    self.id = id
    self.practiceDay = practiceDay
    self.element = element
    self.tier = tier
    self.englishTitle = englishTitle
    self.germanTitle = germanTitle
    self.englishWorldChange = englishWorldChange
    self.germanWorldChange = germanWorldChange
    self.variants = variants
  }
}

public enum GardenMilestones {
  public static let all: [GardenMilestoneDefinition] = [
    milestone(1, .earth, 1, "Earth I", "Erde I", "Roots and living soil", "Wurzeln und lebendiger Boden", "Root weave", "Wurzelgeflecht", "Root fan", "Wurzelfächer"),
    milestone(2, .earth, 2, "Earth II", "Erde II", "Stones and a restrained path", "Steine und ein ruhiger Pfad", "River stones", "Flusssteine", "Slate path", "Schieferpfad"),
    milestone(3, .earth, 3, "Earth III", "Erde III", "Ferns, moss, mushrooms, and undergrowth", "Farne, Moos, Pilze und Unterholz", "Fern grove", "Farnhain", "Moss grove", "Mooshain"),
    milestone(4, .water, 1, "Water I", "Wasser I", "Dew and a narrow stream", "Tau und ein schmaler Bach", "Silver dew", "Silbertau", "Warm dew", "Warmer Tau"),
    milestone(5, .water, 2, "Water II", "Wasser II", "A pond and water plants", "Ein Teich und Wasserpflanzen", "Lily pond", "Seerosenteich", "Reed pond", "Schilfteich"),
    milestone(6, .water, 3, "Water III", "Wasser III", "Flow, ripples, and water life", "Strömung, Wellen und Wasserleben", "Clear ripple", "Klare Wellen", "Shaded ripple", "Schattige Wellen"),
    milestone(7, .fire, 1, "Fire I", "Feuer I", "Warm light and sunlit vitality", "Warmes Licht und sonnige Lebendigkeit", "Morning gold", "Morgengold", "Amber canopy", "Bernsteinkrone"),
    milestone(8, .fire, 2, "Fire II", "Feuer II", "Lantern warmth and fireflies", "Laternenwärme und Glühwürmchen", "Low lanterns", "Tiefe Laternen", "High fireflies", "Hohe Glühwürmchen"),
    milestone(9, .fire, 3, "Fire III", "Feuer III", "Golden-hour color and warm blossoms", "Goldene Stunde und warme Blüten", "Apricot bloom", "Aprikosenblüte", "Golden bloom", "Goldblüte"),
    milestone(10, .air, 1, "Air I", "Luft I", "A visible field of wind", "Ein sichtbares Windfeld", "Meadow breeze", "Wiesenbrise", "Canopy breeze", "Kronenbrise"),
    milestone(11, .air, 2, "Air II", "Luft II", "Drifting leaves and birds", "Treibende Blätter und Vögel", "Swift pair", "Mauerseglerpaar", "Drifting leaves", "Treibende Blätter"),
    milestone(12, .air, 3, "Air III", "Luft III", "Clouds, light shafts, and wider atmosphere", "Wolken, Lichtstrahlen und weitere Atmosphäre", "Open sky", "Offener Himmel", "Cloud veil", "Wolkenschleier"),
    milestone(13, .space, 1, "Space I", "Raum I", "Twilight and first stars", "Dämmerung und erste Sterne", "Blue twilight", "Blaue Dämmerung", "Violet twilight", "Violette Dämmerung"),
    milestone(14, .space, 2, "Space II", "Raum II", "Moonlight and deeper celestial atmosphere", "Mondlicht und tieferer Sternenhimmel", "Pearl moon", "Perlmond", "Crescent moon", "Sichelmond"),
    milestone(15, .space, 3, "Space III", "Raum III", "The mature sanctuary and complete living world", "Das reife Refugium und die vollständige lebendige Welt", "Sanctuary bloom", "Blühendes Refugium", "Sanctuary fruit", "Fruchtendes Refugium"),
  ]

  public static func unlocked(through journeyDay: Int) -> [GardenMilestoneDefinition] {
    all.filter { $0.practiceDay <= journeyDay }
  }

  public static func definition(id: Int) -> GardenMilestoneDefinition? {
    all.first { $0.id == id }
  }

  public static func variantIDs(through milestone: Int) -> [String] {
    all.prefix(max(0, min(all.count, milestone))).flatMap { $0.variants.map(\.id) }
  }

  private static func milestone(
    _ id: Int,
    _ element: GardenElement,
    _ tier: Int,
    _ englishTitle: String,
    _ germanTitle: String,
    _ englishWorldChange: String,
    _ germanWorldChange: String,
    _ variantAEnglish: String,
    _ variantAGerman: String,
    _ variantBEnglish: String,
    _ variantBGerman: String
  ) -> GardenMilestoneDefinition {
    let prefix = String(format: "m%02d", id)
    return GardenMilestoneDefinition(
      id: id,
      practiceDay: id * 2,
      element: element,
      tier: tier,
      englishTitle: englishTitle,
      germanTitle: germanTitle,
      englishWorldChange: englishWorldChange,
      germanWorldChange: germanWorldChange,
      variants: [
        GardenVariantDefinition(id: "\(prefix)-a", englishTitle: variantAEnglish, germanTitle: variantAGerman),
        GardenVariantDefinition(id: "\(prefix)-b", englishTitle: variantBEnglish, germanTitle: variantBGerman),
      ]
    )
  }
}
