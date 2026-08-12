// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "ArriveWithinCore",
  platforms: [
    .iOS("18.0"),
    .macOS("15.0"),
  ],
  products: [
    .library(name: "ArriveWithinDomain", targets: ["ArriveWithinDomain"]),
    .library(name: "ArriveWithinFeedback", targets: ["ArriveWithinFeedback"]),
    .library(name: "ArriveWithinMeditation", targets: ["ArriveWithinMeditation"]),
    .library(name: "ArriveWithinPersistence", targets: ["ArriveWithinPersistence"]),
    .library(name: "ArriveWithinGardenBridge", targets: ["ArriveWithinGardenBridge"]),
    .library(name: "ArriveWithinContent", targets: ["ArriveWithinContent"]),
    .library(name: "ArriveWithinTestSupport", targets: ["ArriveWithinTestSupport"]),
  ],
  targets: [
    .target(name: "ArriveWithinDomain"),
    .target(name: "ArriveWithinFeedback"),
    .target(
      name: "ArriveWithinMeditation",
      dependencies: ["ArriveWithinDomain"]
    ),
    .target(
      name: "ArriveWithinPersistence",
      dependencies: ["ArriveWithinContent", "ArriveWithinDomain", "ArriveWithinMeditation"]
    ),
    .target(
      name: "ArriveWithinGardenBridge",
      dependencies: ["ArriveWithinDomain"]
    ),
    .target(name: "ArriveWithinContent"),
    .target(
      name: "ArriveWithinTestSupport",
      dependencies: [
        "ArriveWithinDomain",
        "ArriveWithinMeditation",
        "ArriveWithinPersistence",
      ]
    ),
    .testTarget(
      name: "ArriveWithinDomainTests",
      dependencies: ["ArriveWithinDomain", "ArriveWithinTestSupport"]
    ),
    .testTarget(
      name: "ArriveWithinMeditationTests",
      dependencies: [
        "ArriveWithinDomain",
        "ArriveWithinMeditation",
        "ArriveWithinPersistence",
        "ArriveWithinTestSupport",
      ]
    ),
    .testTarget(
      name: "ArriveWithinPersistenceTests",
      dependencies: [
        "ArriveWithinDomain",
        "ArriveWithinContent",
        "ArriveWithinPersistence",
        "ArriveWithinTestSupport",
      ],
      resources: [.copy("Fixtures")]
    ),
    .testTarget(
      name: "ArriveWithinGardenBridgeTests",
      dependencies: ["ArriveWithinDomain", "ArriveWithinGardenBridge", "ArriveWithinTestSupport"]
    ),
    .testTarget(
      name: "ArriveWithinContentTests",
      dependencies: ["ArriveWithinContent"]
    ),
    .testTarget(
      name: "ArriveWithinFeedbackTests",
      dependencies: ["ArriveWithinFeedback"]
    ),
  ]
)
