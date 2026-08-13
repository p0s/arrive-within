export const FROZEN_GARDEN_LAB_SOURCE_SHA256 = {
  "Renderer/src/scene.ts": "680a4584379cea744cb49252e6dc6690c604ac6420451d6fa4d75436a1ba7a32",
  "Renderer/src/visual-design.ts": "028926c3171d64f4a54da3a53798697d5d2b8ccac4e3a384de570f2081053104",
  "Renderer/src/visual-directions/verdant-atelier.ts": "77bfd7f71f19e6742d8e281b0cf895c174fd17018362e60630a17f636b3ee088",
  "Renderer/src/visual-directions/paper-sanctuary.ts": "6b732a1bc22e0f100a710c1bb0592ad497f9a513552cbcdcc5b3fdc598b4c271",
  "Renderer/src/visual-directions/twilight-refuge.ts": "8055683e5858fa85bf347bad9ef3114163645f042a21defe192a596b2595f39a",
  "Renderer/design-lab/index.html": "1686fac462ce25e1d51d85c45233f62c1122e39e211be7a14ec9ada36bb48743",
  "Renderer/design-lab/lab.css": "4e26c45c4bed70b41b41db91eb9345d9d68b9b90c491731f03e3acbf59f7fc9c",
  "Renderer/design-lab/lab.ts": "b45aa93dfee21cf27a5389bfe8285c2304eb7c1a94846a904cdefaab5afcd34a",
};

export const CURRENT_GARDEN_LAB_SOURCE_SHA256 = {
  "Renderer/src/scene.ts": "1522b787d236baae5cbf0411f9acd8fbc58b8d6eb0fc39f43edcdb14a3091bcc",
  "Renderer/src/visual-design.ts": "1aa490412c47eebfbaabfb1bf9fa104682de1d998ea773f54a33dba6ceb987e8",
  "Renderer/src/visual-directions/verdant-atelier.ts": "77bfd7f71f19e6742d8e281b0cf895c174fd17018362e60630a17f636b3ee088",
  "Renderer/src/visual-directions/paper-sanctuary.ts": "6b732a1bc22e0f100a710c1bb0592ad497f9a513552cbcdcc5b3fdc598b4c271",
  "Renderer/src/visual-directions/twilight-refuge.ts": "8055683e5858fa85bf347bad9ef3114163645f042a21defe192a596b2595f39a",
  "Renderer/design-lab/index.html": "1686fac462ce25e1d51d85c45233f62c1122e39e211be7a14ec9ada36bb48743",
  "Renderer/design-lab/lab.css": "4e26c45c4bed70b41b41db91eb9345d9d68b9b90c491731f03e3acbf59f7fc9c",
  "Renderer/design-lab/lab.ts": "98f59953c34ba2fee295809b71e503e9f8956c891bffca6ef2a88cecbb864943",
};

export const GARDEN_LAB_CHANGED_PATHS = [
  "Renderer/src/scene.ts",
  "Renderer/src/visual-design.ts",
  "Renderer/design-lab/lab.ts",
];

export function isExactPostPublicationGardenLabFreeze(manifest, currentSourceSha256) {
  const attestation = manifest.post_generation_change;
  const manifestSourceSha256 = Object.fromEntries(manifest.source.files.map((source) => [source.path, source.sha256]));
  const changedPaths = Object.keys(FROZEN_GARDEN_LAB_SOURCE_SHA256).filter(
    (path) => currentSourceSha256[path] !== FROZEN_GARDEN_LAB_SOURCE_SHA256[path],
  );
  return Boolean(
    JSON.stringify(manifestSourceSha256) === JSON.stringify(FROZEN_GARDEN_LAB_SOURCE_SHA256) &&
      JSON.stringify(currentSourceSha256) === JSON.stringify(CURRENT_GARDEN_LAB_SOURCE_SHA256) &&
      JSON.stringify(changedPaths) === JSON.stringify(GARDEN_LAB_CHANGED_PATHS) &&
      attestation?.classification === "selected-garden-design-lab-regeneration-deferred" &&
      JSON.stringify(attestation.changed_paths) === JSON.stringify(GARDEN_LAB_CHANGED_PATHS) &&
      attestation.selected_direction === "twilight-refuge" &&
      attestation.fresh_browser_matrix === "passed-60-render-phone-ipad-day-night-style-matrix" &&
      attestation.current_garden_proof === "separate-provenance-bound-rendered-artifacts-and-deterministic-orbit-diagnostics" &&
      attestation.valid_until === "next-successful-current-source-garden-lab-regeneration" &&
      attestation.rationale.includes("historical three-direction selection lab") &&
      attestation.rationale.includes("not current Garden proof") &&
      attestation.rationale.includes("fresh 60-render browser matrix passed") &&
      attestation.rationale.includes("next successful current-source Garden lab regeneration"),
  );
}
