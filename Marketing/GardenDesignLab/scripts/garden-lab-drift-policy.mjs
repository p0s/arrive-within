export function isCurrentGardenDesignLab(manifest, currentSourceSha256) {
  const sources = manifest.source?.files;
  if (!Array.isArray(sources) || Object.keys(currentSourceSha256).length !== sources.length) return false;
  if (manifest.post_generation_change !== undefined && manifest.post_generation_change !== null) return false;
  return sources.every((source) => currentSourceSha256[source.path] === source.sha256);
}
