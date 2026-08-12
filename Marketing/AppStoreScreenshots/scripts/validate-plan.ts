import {
  assertPlan,
  isAllowedCaptureRequest,
  loadPlan,
  resolveBoundedChildPath,
} from "./contracts";

async function main() {
  const plan = await loadPlan();
  assertPlan(plan);
  const origin = "http://127.0.0.1:3000";
  const credentialSeparator = String.fromCharCode(64);
  if (
    !isAllowedCaptureRequest(`${origin}/runtime-ui/example.png`, origin)
    || !isAllowedCaptureRequest("data:image/png;base64,AA==", origin)
    || !isAllowedCaptureRequest("blob:http://127.0.0.1:3000/example", origin)
    || isAllowedCaptureRequest(`http://127.0.0.1:3000${credentialSeparator}external.invalid/example.png`, origin)
    || isAllowedCaptureRequest("https://127.0.0.1:3000/example.png", origin)
    || isAllowedCaptureRequest("not a URL", origin)
  ) {
    throw new Error("screenshot exporter request-origin boundary is not fail-closed");
  }
  for (const unsafe of ["../outside.png", "/absolute/outside.png"]) {
    try {
      resolveBoundedChildPath("/safe/export", unsafe);
      throw new Error("screenshot attachment path boundary accepted an escape");
    } catch (error) {
      if (error instanceof Error && error.message === "screenshot attachment path boundary accepted an escape") {
        throw error;
      }
    }
  }
  process.stdout.write(
    `Screenshot plan passed: ${plan.slides.length} slides × ${plan.locales.length} locales × ${plan.devices.length} devices = ${plan.expected_final_images} final images.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
