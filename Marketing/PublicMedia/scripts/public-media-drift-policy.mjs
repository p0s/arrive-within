export const CURRENT_RENDERER_SOURCE_SHA256 = "c3f8327851c077074f60c7899cdad57f299c52c58fb496870a522f139489d8f4";
export const CURRENT_GARDEN_SCHEMA_SHA256 = "a73eb83fd1326b3c113663db54005a93024862fa630d8f92a4f3cf1fecc08fee";

export function isExactCurrentRendererArtifact({
  manifest,
  currentRendererSourceSha256,
  currentGardenSchemaSha256,
}) {
  return Boolean(
    currentRendererSourceSha256 === CURRENT_RENDERER_SOURCE_SHA256 &&
      currentGardenSchemaSha256 === CURRENT_GARDEN_SCHEMA_SHA256 &&
      manifest.source.renderer_source_sha256 === CURRENT_RENDERER_SOURCE_SHA256 &&
      manifest.source.garden_state_schema_sha256 === CURRENT_GARDEN_SCHEMA_SHA256 &&
      (manifest.post_generation_change === undefined || manifest.post_generation_change === null),
  );
}
