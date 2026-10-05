// Trend statistics. Every trend number on screen is produced by a function in this file.

const finite = (v) => v !== null && v !== undefined && Number.isFinite(v);

export function median(values) {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Linear-interpolated quantile (type 7, as R/NumPy default). */
export function quantile(values, p) {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = (v.length - 1) * p;
  const lo = Math.floor(h);
  return v[lo] + (h - lo) * ((v[Math.min(lo + 1, v.length - 1)]) - v[lo]);
}

/** Complementary error function, Chebyshev fit (Numerical Recipes `erfcc`, rel. err < 1.2e-7). */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
export function normCdf(z) {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Inverse standard normal CDF (Acklam's algorithm, rel. err < 1.2e-9). */
export function normInv(p) {
  if (p <= 0 || p >= 1) throw new RangeError("normInv: p must be in (0,1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Mann-Kendall trend test (two-sided), with tie correction in Var(S).
 * `y` must be in time order; nulls are dropped.
 * Returns { n, S, varS, Z, p, tau, ties } — ties lists the size of each tied group.
 */
export function mannKendall(y) {
  const v = y.filter(finite);
  const n = v.length;
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) S += Math.sign(v[j] - v[i]);
  }
  const counts = new Map();
  for (const x of v) counts.set(x, (counts.get(x) || 0) + 1);
  const ties = [...counts.values()].filter((t) => t > 1);
  const tieTerm = ties.reduce((acc, t) => acc + t * (t - 1) * (2 * t + 5), 0);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  let Z = 0;
  if (varS > 0) {
    if (S > 0) Z = (S - 1) / Math.sqrt(varS);
    else if (S < 0) Z = (S + 1) / Math.sqrt(varS);
  }
  const p = varS > 0 ? 2 * (1 - normCdf(Math.abs(Z))) : 1;
  const pairs = (n * (n - 1)) / 2;
  return { n, S, varS, Z, p: Math.min(1, p), tau: pairs ? S / pairs : 0, ties };
}

/**
 * Sen's slope with a (1 - alpha) confidence interval from the Mann-Kendall
 * variance (Gilbert 1987, §16.5). x = time (e.g. year), y = value.
 * Returns { slope, lo, hi, intercept, interceptLo, interceptHi, nSlopes }.
 * Intercepts follow Conover: median(y − b·x) for b = slope, lo, hi (used to draw the CI band).
 */
export function senSlope(x, y, alpha = 0.05) {
  const pts = x.map((xi, i) => [xi, y[i]]).filter(([a, b]) => finite(a) && finite(b)).sort((a, b) => a[0] - b[0]);
  const slopes = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j][0] !== pts[i][0]) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    }
  }
  slopes.sort((a, b) => a - b);
  const N = slopes.length;
  if (!N) return { slope: null, lo: null, hi: null, intercept: null, nSlopes: 0 };
  const slope = median(slopes);
  const { varS } = mannKendall(pts.map((p) => p[1]));
  const C = normInv(1 - alpha / 2) * Math.sqrt(varS);
  const M1 = (N - C) / 2; // lower limit is the M1-th largest (1-based) slope
  const M2 = (N + C) / 2; // upper limit is the (M2+1)-th largest (1-based) slope
  const clamp = (k) => Math.max(0, Math.min(N - 1, k));
  const lo = slopes[clamp(Math.round(M1) - 1)];
  const hi = slopes[clamp(Math.round(M2))];
  const icpt = (b) => median(pts.map(([xi, yi]) => yi - b * xi));
  return { slope, lo, hi, intercept: icpt(slope), interceptLo: icpt(lo), interceptHi: icpt(hi), nSlopes: N };
}

/**
 * Benjamini-Hochberg false-discovery-rate control.
 * Returns { adjusted, significant } aligned with the input order.
 */
export function benjaminiHochberg(pvalues, q = 0.1) {
  const m = pvalues.length;
  const order = pvalues.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  let kMax = 0;
  order.forEach(([p], r) => {
    if (p <= ((r + 1) / m) * q) kMax = r + 1;
  });
  const adjusted = new Array(m);
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    const [p, i] = order[r];
    running = Math.min(running, (p * m) / (r + 1));
    adjusted[i] = running;
  }
  const significant = new Array(m).fill(false);
  order.forEach(([, i], r) => {
    if (r < kMax) significant[i] = true;
  });
  return { adjusted, significant, q };
}
