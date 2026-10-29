/**
 * Small seeded PRNG (mulberry32). The generator state lives inside the game state
 * (`rng`), so the engine stays a pure function and every game can be replayed.
 *
 * This is not cryptographically secure. The server must seed each game from a
 * secure source (see docs/RULES.md, "Randomness").
 */
export interface RngBox {
  rng: number;
}

/** Returns a float in [0, 1) and advances the generator state. */
export function nextRandom(box: RngBox): number {
  box.rng = (box.rng + 0x6d2b79f5) >>> 0;
  let t = box.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Returns an integer in [0, maxExclusive). */
export function randomInt(box: RngBox, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`randomInt needs a positive integer, got ${maxExclusive}`);
  }
  return Math.floor(nextRandom(box) * maxExclusive);
}

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(box: RngBox, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(box, i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
}
