import SwiftUI

@main
@MainActor
struct ArriveWithinApp: App {
  @State private var model = AppModel(dependencies: .live())
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      AppRootView(model: model)
        .task { await model.start() }
        .onChange(of: scenePhase) { _, newPhase in
          guard newPhase == .active else { return }
          Task { await model.updateForForeground() }
        }
    }
    .commands {
      CommandMenu("commands.navigation") {
        Button("navigation.garden") { model.selectedSection = .garden }
          .keyboardShortcut("1", modifiers: .command)
        Button("navigation.practice") { model.selectedSection = .practice }
          .keyboardShortcut("2", modifiers: .command)
        Button("navigation.journey") { model.selectedSection = .journey }
          .keyboardShortcut("3", modifiers: .command)
        Button("navigation.journal") { model.selectedSection = .journal }
          .keyboardShortcut("4", modifiers: .command)
      }
    }
  }
}
