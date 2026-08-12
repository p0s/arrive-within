import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const BYTES_PER_PIXEL = 3;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function decodeRgb(data: Buffer): { height: number; pixels: Buffer; width: number } {
  if (!data.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  let offset = PNG_SIGNATURE.byteLength;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  const compressed: Buffer[] = [];

  while (offset + 12 <= data.byteLength) {
    const length = data.readUInt32BE(offset);
    const name = data.subarray(offset + 4, offset + 8).toString("ascii");
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + length;
    const checksumEnd = bodyEnd + 4;
    if (checksumEnd > data.byteLength) throw new Error(`truncated PNG chunk ${name}`);
    const body = data.subarray(bodyStart, bodyEnd);
    const expectedCrc = data.readUInt32BE(bodyEnd);
    if (crc32(Buffer.concat([Buffer.from(name, "ascii"), body])) !== expectedCrc) {
      throw new Error(`invalid PNG CRC for ${name}`);
    }
    if (name === "IHDR") {
      if (body.byteLength !== 13 || width !== 0 || height !== 0) throw new Error("invalid or duplicate IHDR");
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (
        body.readUInt8(8) !== 8 ||
        body.readUInt8(9) !== 2 ||
        body.readUInt8(10) !== 0 ||
        body.readUInt8(11) !== 0 ||
        body.readUInt8(12) !== 0
      ) {
        throw new Error("deterministic normalization requires non-interlaced 8-bit opaque RGB PNG input");
      }
    } else if (name === "IDAT") {
      compressed.push(body);
    } else if (name === "IEND") {
      sawEnd = true;
      break;
    } else if (name === "acTL" || name === "fcTL" || name === "fdAT") {
      throw new Error("animated PNG input is not supported");
    }
    offset = checksumEnd;
  }
  if (!width || !height || compressed.length === 0 || !sawEnd) throw new Error("incomplete PNG");

  const stride = width * BYTES_PER_PIXEL;
  const filtered = inflateSync(Buffer.concat(compressed));
  if (filtered.byteLength !== height * (stride + 1)) throw new Error("unexpected PNG scanline length");
  const pixels = Buffer.alloc(height * stride);
  const emptyRow = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const inputStart = row * (stride + 1);
    const filter = filtered[inputStart];
    if (filter > 4) throw new Error(`unsupported PNG filter ${filter}`);
    const outputStart = row * stride;
    const current = pixels.subarray(outputStart, outputStart + stride);
    const previous = row === 0 ? emptyRow : pixels.subarray(outputStart - stride, outputStart);
    for (let index = 0; index < stride; index += 1) {
      const encoded = filtered[inputStart + 1 + index];
      const left = index >= BYTES_PER_PIXEL ? current[index - BYTES_PER_PIXEL] : 0;
      const above = previous[index];
      const upperLeft = index >= BYTES_PER_PIXEL ? previous[index - BYTES_PER_PIXEL] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      current[index] = (encoded + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function encodeRgb(width: number, height: number, pixels: Buffer): Buffer {
  const stride = width * BYTES_PER_PIXEL;
  const filtered = Buffer.alloc(height * (stride + 1));
  const emptyRow = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const inputStart = row * stride;
    const current = pixels.subarray(inputStart, inputStart + stride);
    const previous = row === 0 ? emptyRow : pixels.subarray(inputStart - stride, inputStart);
    const outputStart = row * (stride + 1);
    filtered[outputStart] = 4;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= BYTES_PER_PIXEL ? current[index - BYTES_PER_PIXEL] : 0;
      const above = previous[index];
      const upperLeft = index >= BYTES_PER_PIXEL ? previous[index - BYTES_PER_PIXEL] : 0;
      filtered[outputStart + 1 + index] = (current[index] - paeth(left, above, upperLeft) + 256) & 0xff;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  header.writeUInt8(0, 10);
  header.writeUInt8(0, 11);
  header.writeUInt8(0, 12);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function normalizeOpaqueRgbPng(data: Buffer): Buffer {
  const decoded = decodeRgb(data);
  for (let index = 0; index < decoded.pixels.byteLength; index += 1) {
    decoded.pixels[index] &= 0xfe;
  }
  return encodeRgb(decoded.width, decoded.height, decoded.pixels);
}
