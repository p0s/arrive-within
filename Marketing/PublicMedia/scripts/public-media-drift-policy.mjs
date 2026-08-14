export const FROZEN_RENDERER_SOURCE_SHA256 = "ceb4332aecd2c734563b94486e8a877ee10fd5cdb22692bc93c21345b3f8ef27";
export const CURRENT_RENDERER_SOURCE_SHA256 = "d6b5378ad941495d902439e374ba1404f628b3598f5194e2090666fe5e4bc1df";
export const FROZEN_GARDEN_SCHEMA_SHA256 = "a73eb83fd1326b3c113663db54005a93024862fa630d8f92a4f3cf1fecc08fee";
export const CURRENT_GARDEN_SCHEMA_SHA256 = "a73eb83fd1326b3c113663db54005a93024862fa630d8f92a4f3cf1fecc08fee";

export const FROZEN_SOURCE_FILE_SHA256 = {
  "Renderer/index.html": "730e1be1c66d736d9e49dee90fc39c75c7a2f98fd9de9c0532aee9884ba05118",
  "Renderer/public/garden.css": "c0fac88584c03d2be9b92c8a9dd5877a07b94f49b4feeabd1eb482d51040d4f0",
  "Renderer/src/bridge.ts": "27547cf584ee23a3ded0a897c731857e132dd79c2463fdf319306ddee80c53f5",
  "Renderer/src/main.ts": "9028ffe6d105c497959fb251144b48f9c21a908391b88559db3a2132206f86a0",
  "Renderer/src/render-style.ts": "9f0793393319914ebd65009dfdc886b73fd13198bef70c4e642c43706b65fc0e",
  "Renderer/src/resilience.ts": "6fde9e8ad5b8864186c5d74d8d9514f820f2d5ea5629efcb4ea0478e3fb19ea1",
  "Renderer/src/scene.ts": "1522b787d236baae5cbf0411f9acd8fbc58b8d6eb0fc39f43edcdb14a3091bcc",
  "Renderer/src/seeded.ts": "286c1fb1157f61351c0b3a2c6514e0b11a5c551b0bd6a771e7400f3a52b77e6d",
  "Renderer/src/shipping-html.ts": "bc6234475299a3c37e444ef3e62e1acc8b01b1ce0e3a98b6a171faa37cbdedf9",
  "Renderer/src/shipping-visual.ts": "10327553b242b2619a7805978e80206553ce008da0cee42129e68f02ecad3414",
  "Renderer/src/types.ts": "e1a2231b5728caae1b5fe3f61774a07f253742806208b187284f8214055e58d9",
  "Renderer/src/validation.ts": "a9257693a61c008f87c1aba18e24bdbb99f4ac704d9e16c67530c4ecd5e79c36",
  "Renderer/src/visual-design.ts": "1aa490412c47eebfbaabfb1bf9fa104682de1d998ea773f54a33dba6ceb987e8",
  "Renderer/src/world-model.ts": "7e5ca758a2bab10fd291943caa5eb2da9a354c9481453610eb73aad704c455b3",
  "Shared/GardenState.schema.json": "a73eb83fd1326b3c113663db54005a93024862fa630d8f92a4f3cf1fecc08fee",
};

export const POST_PUBLICATION_CHANGED_PATHS = [
  "Renderer/src/scene.ts",
  "Renderer/src/visual-design.ts",
];

const REQUIRED_RATIONALE = [
  "pre-enhancement renderer media",
  "not current Garden proof",
  "fresh browser matrix was skipped after host denial",
  "next successful current-source public-media regeneration",
];

export function changedSourcePaths(currentFileSha256) {
  const baselinePaths = Object.keys(FROZEN_SOURCE_FILE_SHA256);
  const currentPaths = baselinePaths;
  if (JSON.stringify(Object.keys(currentFileSha256)) !== JSON.stringify(currentPaths)) return ["<source-file-set-drift>"];
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
