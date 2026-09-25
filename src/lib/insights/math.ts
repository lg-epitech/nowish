/** Abramowitz & Stegun 7.1.26; absolute error below 1.5e-7. */
export function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);

  return sign * y;
}

export function normalCdf(z: number) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function gaussian(distance: number, sigma: number) {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function sum(values: readonly number[]) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function mean(values: readonly number[]) {
  return values.length === 0 ? null : sum(values) / values.length;
}

/**
 * Weighted quantile using midpoint plotting positions: each observation sits
 * at the centre of its weight. With equal weights this is the Hazen quantile,
 * so the median of [1, 2, 3, 4] is 2.5 and the median of [1, 2, 3] is 2.
 */
export function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  q: number,
) {
  const pairs: [number, number][] = [];

  for (let index = 0; index < values.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (weight > 0 && Number.isFinite(values[index])) pairs.push([values[index], weight]);
  }

  if (pairs.length === 0) return null;
  if (pairs.length === 1) return pairs[0][0];

  pairs.sort((left, right) => left[0] - right[0]);

  const total = sum(pairs.map(([, weight]) => weight));
  const target = clamp(q, 0, 1);
  let cumulative = 0;
  let previousPosition = 0;
  let previousValue = pairs[0][0];

  for (let index = 0; index < pairs.length; index += 1) {
    const [value, weight] = pairs[index];
    const position = (cumulative + weight / 2) / total;
    cumulative += weight;

    if (target <= position) {
      if (index === 0) return value;
      const span = position - previousPosition;
      const ratio = span === 0 ? 0 : (target - previousPosition) / span;
      return previousValue + ratio * (value - previousValue);
    }

    previousPosition = position;
    previousValue = value;
  }

  return pairs[pairs.length - 1][0];
}

export function quantile(values: readonly number[], q: number) {
  return weightedQuantile(values, values.map(() => 1), q);
}

export function median(values: readonly number[]) {
  return quantile(values, 0.5);
}

/** Weight that halves every `halfLifeDays` of age. */
export function decayWeight(ageMs: number, halfLifeDays: number) {
  const ageDays = Math.max(0, ageMs) / 86_400_000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** A 1–2–5 style bin width that fits `span` into at most `maxBins` bins. */
export function niceBinWidth(span: number, maxBins: number) {
  const candidates = [1, 2, 5, 10, 15, 20, 30, 60, 120, 240];

  for (const width of candidates) {
    if (Math.ceil(span / width) <= maxBins) return width;
  }

  return candidates[candidates.length - 1];
}
