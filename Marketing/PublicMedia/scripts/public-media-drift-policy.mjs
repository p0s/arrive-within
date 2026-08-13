export const FROZEN_RENDERER_SOURCE_SHA256 = "9867787a40ba0220f23f90270b996bc60d62dd3ea2d791c6c58ed96b4c8b9f31";
export const CURRENT_RENDERER_SOURCE_SHA256 = "98ff40b9a974b92f8528128c738bfb95fbf374264f0ec691df1647d88fe38427";
export const FROZEN_GARDEN_SCHEMA_SHA256 = "2194a09d0511522423eafe62724e1d96a450f3847e49cb872b1e3383944331a3";
export const CURRENT_GARDEN_SCHEMA_SHA256 = "a73eb83fd1326b3c113663db54005a93024862fa630d8f92a4f3cf1fecc08fee";

export const FROZEN_SOURCE_FILE_SHA256 = {
  "Renderer/index.html": "730e1be1c66d736d9e49dee90fc39c75c7a2f98fd9de9c0532aee9884ba05118",
  "Renderer/public/garden.css": "c0fac88584c03d2be9b92c8a9dd5877a07b94f49b4feeabd1eb482d51040d4f0",
  "Renderer/src/bridge.ts": "986af6f88d6367f75894f6c72d392a54a53f7495828a729b483154796af4bf0a",
  "Renderer/src/main.ts": "d1afaeed894c7e3b75e6b7e26269d61c768d03f97f01dd7b2fad63c1eb5f7c9f",
  "Renderer/src/resilience.ts": "6fde9e8ad5b8864186c5d74d8d9514f820f2d5ea5629efcb4ea0478e3fb19ea1",
  "Renderer/src/scene.ts": "680a4584379cea744cb49252e6dc6690c604ac6420451d6fa4d75436a1ba7a32",
  "Renderer/src/seeded.ts": "286c1fb1157f61351c0b3a2c6514e0b11a5c551b0bd6a771e7400f3a52b77e6d",
  "Renderer/src/shipping-html.ts": "bc6234475299a3c37e444ef3e62e1acc8b01b1ce0e3a98b6a171faa37cbdedf9",
  "Renderer/src/shipping-visual.ts": "7a86c7b97d23e98afd1b3ccdc8b3029b6880f588a2c4d032078fb66830301adf",
  "Renderer/src/types.ts": "30c251ad171d73f6e3b5d311e17113c47ec00469b7f0191eaf44b98e81cc123b",
  "Renderer/src/validation.ts": "a9257693a61c008f87c1aba18e24bdbb99f4ac704d9e16c67530c4ecd5e79c36",
  "Renderer/src/visual-design.ts": "028926c3171d64f4a54da3a53798697d5d2b8ccac4e3a384de570f2081053104",
  "Renderer/src/world-model.ts": "6cc94981bd57fb2ba484477112799812681eb1ff98b9c74cb191512b9810fcd1",
  "Shared/GardenState.schema.json": "2194a09d0511522423eafe62724e1d96a450f3847e49cb872b1e3383944331a3",
};

export const POST_PUBLICATION_CHANGED_PATHS = [
  "Renderer/src/main.ts",
  "Renderer/src/scene.ts",
  "Renderer/src/types.ts",
  "Renderer/src/visual-design.ts",
  "Renderer/src/world-model.ts",
  "Shared/GardenState.schema.json",
];

const REQUIRED_RATIONALE = [
  "pre-enhancement renderer media",
  "not current Garden proof",
  "fresh browser matrix was skipped after host denial",
  "next successful current-source public-media regeneration",
];

export function changedSourcePaths(currentFileSha256) {
  const baselinePaths = Object.keys(FROZEN_SOURCE_FILE_SHA256);
  if (JSON.stringify(Object.keys(currentFileSha256)) !== JSON.stringify(baselinePaths)) return ["<source-file-set-drift>"];
  return baselinePaths.filter((path) => currentFileSha256[path] !== FROZEN_SOURCE_FILE_SHA256[path]);
}

export function isExactPostPublicationMediaFreeze({
  manifest,
  currentRendererSourceSha256,
  currentGardenSchemaSha256,
  currentFileSha256,
}) {
  const attestation = manifest.post_generation_change;
  return Boolean(
    hasExactCommonSourceBoundary({ manifest, currentRendererSourceSha256, currentGardenSchemaSha256, currentFileSha256 }) &&
      attestation?.classification === "post-publication-garden-media-regeneration-deferred" &&
      attestation.current_renderer_source_sha256 === CURRENT_RENDERER_SOURCE_SHA256 &&
      attestation.current_garden_state_schema_sha256 === CURRENT_GARDEN_SCHEMA_SHA256 &&
      JSON.stringify(attestation.changed_paths) === JSON.stringify(POST_PUBLICATION_CHANGED_PATHS) &&
      attestation.fresh_browser_matrix === "skipped-host-denial-not-passed" &&
      attestation.current_garden_proof === "separate-provenance-bound-rendered-artifacts-and-deterministic-orbit-diagnostics" &&
      attestation.valid_until === "next-successful-current-source-public-media-regeneration" &&
      REQUIRED_RATIONALE.every((fragment) => attestation.rationale.includes(fragment)),
  );
}

export function isExactPostPublicationVisualMatrixFreeze({
  manifest,
  currentRendererSourceSha256,
  currentGardenSchemaSha256,
  currentFileSha256,
}) {
  const attestation = manifest.post_generation_change;
  return Boolean(
    hasExactCommonSourceBoundary({ manifest, currentRendererSourceSha256, currentGardenSchemaSha256, currentFileSha256 }) &&
      attestation?.classification === "post-publication-garden-visual-matrix-regeneration-deferred" &&
      attestation.current_renderer_source_sha256 === CURRENT_RENDERER_SOURCE_SHA256 &&
      attestation.current_garden_state_schema_sha256 === CURRENT_GARDEN_SCHEMA_SHA256 &&
      JSON.stringify(attestation.changed_paths) === JSON.stringify(POST_PUBLICATION_CHANGED_PATHS) &&
      attestation.fresh_browser_matrix === "skipped-host-denial-not-passed" &&
      attestation.current_garden_proof === "separate-provenance-bound-rendered-artifacts-and-deterministic-orbit-diagnostics" &&
      attestation.valid_until === "next-successful-current-source-renderer-matrix-regeneration" &&
      attestation.rationale.includes("historical milestone-variant matrix") &&
      attestation.rationale.includes("not current Garden proof") &&
      attestation.rationale.includes("fresh browser matrix was skipped after host denial") &&
      attestation.rationale.includes("next successful current-source renderer-matrix regeneration"),
  );
}

function hasExactCommonSourceBoundary({ manifest, currentRendererSourceSha256, currentGardenSchemaSha256, currentFileSha256 }) {
  return (
    manifest.source.renderer_source_sha256 === FROZEN_RENDERER_SOURCE_SHA256 &&
    manifest.source.garden_state_schema_sha256 === FROZEN_GARDEN_SCHEMA_SHA256 &&
    currentRendererSourceSha256 === CURRENT_RENDERER_SOURCE_SHA256 &&
    currentGardenSchemaSha256 === CURRENT_GARDEN_SCHEMA_SHA256 &&
    JSON.stringify(manifest.source.renderer_source_files) === JSON.stringify(Object.keys(FROZEN_SOURCE_FILE_SHA256)) &&
    JSON.stringify(changedSourcePaths(currentFileSha256)) === JSON.stringify(POST_PUBLICATION_CHANGED_PATHS)
  );
}
