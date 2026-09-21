/** Small deterministic PRNG used by every simulation run.
 *
 * The state is kept as an unsigned 32-bit integer, which makes a WorldState
 * reproducible after JSON serialisation. It is intentionally not cryptographic.
 */
export class SeededRandom {
  private state: number;

  constructor(seed = 42) {
    const normalised = Number.isFinite(seed) ? Math.trunc(seed) : 42;
    this.state = (normalised >>> 0) || 0x6d2b79f5;
  }

  getState(): number {
    return this.state >>> 0;
  }

  setState(state: number): void {
    this.state = (Math.trunc(state) >>> 0) || 0x6d2b79f5;
  }

  /** Uniform value in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in the inclusive range [min, max]. */
  int(min: number, max: number): number {
    const lower = Math.ceil(Math.min(min, max));
    const upper = Math.floor(Math.max(min, max));
    return lower + Math.floor(this.next() * (upper - lower + 1));
  }

  float(min: number, max: number): number {
    return Math.min(min, max) + this.next() * Math.abs(max - min);
  }

  chance(probability: number): boolean {
    return this.next() < Math.max(0, Math.min(1, probability));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("SeededRandom.pick requires at least one item");
    }
    return items[this.int(0, items.length - 1)];
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new Error("SeededRandom.weighted requires matching non-empty arrays");
    }
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    if (total <= 0) return this.pick(items);
    let cursor = this.next() * total;
    for (let index = 0; index < items.length; index += 1) {
      cursor -= Math.max(0, weights[index]);
      if (cursor <= 0) return items[index];
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

