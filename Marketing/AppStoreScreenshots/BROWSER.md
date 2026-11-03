# Screenshot browser

Screenshot exports, website browser checks, and renderer/media tools share one connector and attach to a maintained local Chrome instance after a trusted local verifier confirms its runtime and isolation settings. They do not launch or download Playwright's bundled browser.

Configure `SCREENSHOT_BROWSER_GUARD` with the absolute path to that verifier in your local environment. The verifier takes no arguments and returns JSON with `endpoint`, `version`, and `guarded: true` only after its checks pass. The connector accepts only a credential-free local WebSocket endpoint and requires the connected version to match the verified version and meet its minimum version. Missing or invalid verification stops the export.

Keep machine-specific verifier implementations, configuration, paths, profiles, and operational instructions outside the repository.

Exports use temporary browser contexts and preserve existing tabs. Existing provenance, image validation, and reproducibility checks still apply; revalidate outputs after changing the browser.
