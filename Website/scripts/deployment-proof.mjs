export function parseWranglerDeployEvents(text) {
  const records = text.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error("Wrangler output file contains invalid JSON");
    }
  });
  const deployments = records.filter((record) => record.type === "deploy");
  if (deployments.length !== 1) throw new Error("Wrangler did not report exactly one deployed Worker version");
  const deployment = deployments[0];
  if (deployment.version !== 1 || deployment.worker_name !== "arrivewithin-web"
    || typeof deployment.version_id !== "string" || !/^[a-f\d-]{16,64}$/i.test(deployment.version_id)) {
    throw new Error("Wrangler deployment record does not identify the expected Worker version");
  }
  return deployment;
}

export function assertDeploymentReadback(deployment, readbackText) {
  let readback;
  try {
    readback = JSON.parse(readbackText);
  } catch {
    throw new Error("Wrangler deployment status readback was not valid JSON");
  }
  const versions = readback?.versions;
  if (!Array.isArray(versions)) throw new Error("Wrangler deployment status readback did not include traffic versions");
  const exact = versions.find((version) => version.version_id === deployment.version_id);
  if (!exact || exact.percentage !== 100) {
    throw new Error("Wrangler readback does not show the exact candidate Worker version serving 100% of traffic");
  }
  return { workerName: deployment.worker_name, versionId: deployment.version_id, percentage: exact.percentage };
}
