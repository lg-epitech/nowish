/**
 * Correlation-adjusted mass for sorted, finite timestamps with positive counts
 * and a positive span. A compressed group contributes its count divided by the
 * triangular density of nearby reports, including itself. Reports outside the
 * span contribute exactly zero, so a repeated burst cannot suppress distant
 * observations. The kernel and its resulting weights are continuous in time.
 *
 * Two sliding passes evaluate the density in O(n) time and O(n) space. Running
 * sums use distances within the window, avoiding weighted absolute timestamps.
 */
export function correlationWeights(
  reports: readonly { at: number; count: number }[],
  spanMs: number,
): Float64Array {
  const weights = new Float64Array(reports.length);

  for (const direction of [1, -1]) {
    const start = direction === 1 ? 0 : reports.length - 1;
    let oldest = start;
    let count = 0;
    let distances = 0;

    for (let index = start; index >= 0 && index < reports.length; index += direction) {
      const previous = index - direction;
      if (previous >= 0 && previous < reports.length) {
        const elapsed = direction * (reports[index].at - reports[previous].at);

        if (elapsed >= spanMs) {
          // Nothing in the previous window can reach this report. Reset before
          // multiplying by a potentially very large gap between tracking days.
          oldest = index;
          count = 0;
          distances = 0;
        } else {
          distances += count * elapsed;
          while (oldest !== index) {
            const distance = direction * (reports[index].at - reports[oldest].at);
            if (distance < spanMs) break;
            distances -= reports[oldest].count * distance;
            count -= reports[oldest].count;
            oldest += direction;
          }
          if (count === 0) distances = 0;
        }
      }

      count += reports[index].count;
      weights[index] += count - distances / spanMs;
    }
  }

  for (let index = 0; index < reports.length; index += 1) {
    const ownCount = reports[index].count;
    // Both passes include this group. Subtract it once; roundoff must never
    // make the density smaller than the group's own contribution.
    const density = Math.max(ownCount, weights[index] - ownCount);
    weights[index] = ownCount / density;
  }

  return weights;
}
