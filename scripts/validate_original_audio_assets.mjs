import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audioRoot = path.join(projectRoot, "Apps/ArriveWithin/Resources/Audio");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function analyzePCM16MonoWAV(bytes, id) {
  assert(bytes.toString("ascii", 0, 4) === "RIFF", `${id} is not RIFF`);
  assert(bytes.toString("ascii", 8, 12) === "WAVE", `${id} is not WAVE`);

  let format;
  let samples;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const chunkID = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    assert(payload + chunkSize <= bytes.length, `${id} has a truncated ${chunkID} chunk`);
    if (chunkID === "fmt ") {
      format = {
        encoding: bytes.readUInt16LE(payload),
        channels: bytes.readUInt16LE(payload + 2),
        sampleRate: bytes.readUInt32LE(payload + 4),
        bitsPerSample: bytes.readUInt16LE(payload + 14),
      };
    } else if (chunkID === "data") {
      samples = bytes.subarray(payload, payload + chunkSize);
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }

  assert(format, `${id} is missing its format chunk`);
  assert(samples, `${id} is missing its sample data`);
  assert(format.encoding === 1, `${id} must use integer PCM`);
  assert(format.channels === 1, `${id} must be mono`);
  assert(format.sampleRate === 48_000, `${id} must be 48 kHz`);
  assert(format.bitsPerSample === 16, `${id} must be 16-bit`);
  assert(samples.length > 0 && samples.length % 2 === 0, `${id} has invalid samples`);

  let peak = 0;
  let squareSum = 0;
  const sampleCount = samples.length / 2;
  for (let index = 0; index < samples.length; index += 2) {
    const amplitude = Math.abs(samples.readInt16LE(index)) / 32_768;
    peak = Math.max(peak, amplitude);
    squareSum += amplitude * amplitude;
  }
  const peakDBFS = 20 * Math.log10(peak);
  const rmsDBFS = 20 * Math.log10(Math.sqrt(squareSum / sampleCount));
  assert(
    peakDBFS >= -18 && peakDBFS <= -6,
    `${id} peak ${peakDBFS.toFixed(1)} dBFS is outside the audible, headroom-safe band`
  );
  assert(
    rmsDBFS >= -38 && rmsDBFS <= -22,
    `${id} RMS ${rmsDBFS.toFixed(1)} dBFS is outside the mastered cue band`
  );
  return { peakDBFS, rmsDBFS };
}

const manifest = JSON.parse(await readFile(path.join(audioRoot, "audio-assets.json"), "utf8"));
assert(manifest.schema_version === 1, "audio asset manifest schema must be 1");
assert(manifest.assets?.length === 3, "audio asset manifest must contain exactly three assets");

const measurements = [];
for (const asset of manifest.assets) {
  const bytes = await readFile(path.join(audioRoot, path.basename(asset.path)));
  assert(sha256(bytes) === asset.sha256, `${asset.id} hash does not match the manifest`);
  if (asset.role === "opening-bell" || asset.role === "closing-and-interval-bell") {
    measurements.push({ id: asset.id, ...analyzePCM16MonoWAV(bytes, asset.id) });
  }
}
assert(measurements.length === 2, "both mastered bell roles must be present");
console.log(
  measurements
    .map(({ id, peakDBFS, rmsDBFS }) => `${id} peak=${peakDBFS.toFixed(1)}dBFS rms=${rmsDBFS.toFixed(1)}dBFS`)
    .join("; ")
);
