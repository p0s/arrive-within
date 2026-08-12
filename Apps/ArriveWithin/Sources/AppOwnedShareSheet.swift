import SwiftUI
import UIKit

struct AppOwnedShareItem: Identifiable {
  let url: URL
  var id: URL { url }
}

struct AppOwnedShareSheet: UIViewControllerRepresentable {
  let url: URL
  let completion: () -> Void

  init(url: URL, completion: @escaping () -> Void = {}) {
    self.url = url
    self.completion = completion
  }

  func makeUIViewController(context: Context) -> UIActivityViewController {
    let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    controller.completionWithItemsHandler = { _, _, _, _ in
      DispatchQueue.main.async { completion() }
    }
    return controller
  }

  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
