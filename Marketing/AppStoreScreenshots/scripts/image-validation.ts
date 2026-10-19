import { readFile } from "node:fs/promises";

export type ImageValidation = {
  file: string;
  status: "pass" | "fail";
  width?: number;
  height?: number;
  format?: "png";
  colorType?: number;
  opaqueRgb?: boolean;
  errors: string[];
};

export async function validateOpaqueRgbPng(
  file: string,
  expectedWidth?: number,
  expectedHeight?: number,
): Promise<ImageValidation> {
  const errors: string[] = [];
  try {
    const data = await readFile(file);
    if (data.length < 33 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("not a readable PNG");
    }
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    const colorType = data.readUInt8(25);
    const hasTransparencyChunk = data.includes(Buffer.from("tRNS"));
    const opaqueRgb = colorType === 2 && !hasTransparencyChunk;
    if (expectedWidth !== undefined && width !== expectedWidth) errors.push(`width ${width}; expected ${expectedWidth}`);
    if (expectedHeight !== undefined && height !== expectedHeight) errors.push(`height ${height}; expected ${expectedHeight}`);
    if (!opaqueRgb) errors.push(`PNG must be opaque RGB color type 2; found color type ${colorType}${hasTransparencyChunk ? " with tRNS" : ""}`);
    return { file, status: errors.length ? "fail" : "pass", width, height, format: "png", colorType, opaqueRgb, errors };
  } catch (error) {
    return { file, status: "fail", errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function validationText(results: ImageValidation[]): string {
  return results
    .map((result) => {
      const size = result.width && result.height ? `${result.width}x${result.height}` : "unknown-size";
      const details = result.errors.length ? ` - ${result.errors.join("; ")}` : "";
      return `${result.status.toUpperCase()} ${size} ${result.opaqueRgb ? "opaque-rgb" : "invalid-color"} ${result.file}${details}`;
    })
    .join("\n");
}
