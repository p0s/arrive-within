export interface DeterministicRandom {
  next(): number;
  range(minimum: number, maximum: number): number;
  signed(magnitude?: number): number;
}

// Mulberry32 algorithm by Tommy Ettinger, dedicated to the public domain under
// CC0 1.0: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
export function makeDeterministicRandom(seed: number, stream = "garden"): DeterministicRandom {
  let state = fnv1a(`${seed}:${stream}`);
  const next = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    range: (minimum, maximum) => minimum + (maximum - minimum) * next(),
    signed: (magnitude = 1) => (next() * 2 - 1) * magnitude,
  };
}

// FNV-1a follows the standard algorithm in RFC 9923, section 2.
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
