// Synthetic-but-plausible data for Ropon Radar, generated at load from seed 42.
// Nothing here is a result: these are generator inputs. Results come from
// stats.js / detect.js, called at the bottom of generate().
import { createRng, SEED } from "./prng.js";
import { mannKendall, senSlope, benjaminiHochberg, median, quantile } from "./stats.js";
import { detectOnset, detectTransplant, doyOf } from "./detect.js";

export const MODE = "synthetic demo";
export const RAIN_YEARS = range(2001, 2025);
export const VH_YEARS = range(2017, 2025);
export const NISAR_YEAR = 2026;
export const PIXELS = 36; // pixels sampled per upazila per season (notional rice mask)
export const GAP_BAND = [15, 30]; // "on track": transplant 15–30 d after onset (assumed seedbed age)
export const NISAR_GAP = [[7, 27], [8, 10]]; // no NISAR acquisitions 27 Jul – 10 Aug 2026
const RAIN_DAYS = 122; // 1 Jun – 30 Sep
const VH_SPAN = [100, 330]; // acquisitions kept per season (DOY)

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export async function loadGeo(root = ".") {
  const [upz, dist] = await Promise.all([
    fetch(`${root}/data/rangpur_upazilas.geojson`, { cache: "no-cache" }).then((r) => r.json()),
    fetch(`${root}/data/rangpur_district.geojson`, { cache: "no-cache" }).then((r) => r.json()),
  ]);
  return { upazilas: upz, district: dist };
}

/** Sentinel-1 revisit: 12 days while only S1A flew (2022–2024), 6 days otherwise. */
export function revisitDays(year) {
  return year >= 2022 && year <= 2024 ? 12 : 6;
}

function acquisitions(year, revisit, rng) {
  const phase = rng.int(0, revisit - 1);
  const out = [];
  for (let d = VH_SPAN[0] + phase; d <= VH_SPAN[1]; d += revisit) out.push(d);
  return out;
}

/** Generator inputs for one upazila (drawn once, never displayed as results). */
function upazilaParams(rng) {
  return {
    trend: rng.uniform(-1, 6), // days per decade later onset
    baseOnset: 168 + rng.normal(0, 3), // DOY of latent onset in 2001
    gapMean: rng.uniform(4, 60), // typical days from onset to transplanting
  };
}

/** Daily rain (mm) 1 Jun – 30 Sep with a latent onset, false starts and monsoon breaks. */
function simulateRain(year, latentIdx, rng) {
  const rain = new Float64Array(RAIN_DAYS);
  const forcedDry = new Uint8Array(RAIN_DAYS);
  const on = Math.max(0, Math.min(RAIN_DAYS - 40, Math.round(latentIdx)));
  for (let i = 0; i < RAIN_DAYS; i++) {
    if (i < on) rain[i] = rng.chance(0.22) ? rng.exp(4) : 0;
    else {
      const pWet = i > 100 ? 0.58 : 0.72;
      rain[i] = rng.chance(pWet) ? rng.exp(17) : rng.uniform(0, 0.8);
    }
  }
  // onset burst
  for (let k = 0; k < 3; k++) rain[on + k] = 8 + rng.exp(14);
  // false start: a burst that fails because a long dry spell follows
  if (rng.chance(0.4)) {
    const fs = on - rng.int(12, 22);
    const len = rng.int(2, 3);
    const dry = Math.min(rng.int(9, 12), on - fs - len - 1);
    if (fs >= 0 && dry >= 8) {
      for (let k = 0; k < len; k++) rain[fs + k] = 9 + rng.exp(8);
      for (let k = 0; k < dry; k++) forcedDry[fs + len + k] = 1;
    }
  }
  // monsoon break, well after onset
  if (rng.chance(0.35)) {
    const b = on + rng.int(35, 60);
    const len = rng.int(8, 12);
    for (let k = 0; k < len && b + k < RAIN_DAYS; k++) forcedDry[b + k] = 1;
  }
  for (let i = 0; i < RAIN_DAYS; i++) if (forcedDry[i]) rain[i] = 0;
  return Array.from(rain, (v) => Math.round(v * 10) / 10);
}

/** C-band VH backscatter model for one paddy pixel, in dB. */
function vhModel(t, p) {
  if (!p.rice) return p.base;
  let v;
  if (t < p.T - 6) v = p.base;
  else if (t <= p.T) v = p.base + ((p.dip - p.base) * (t - (p.T - 6))) / 6;
  else {
    const g = 1 - Math.exp(-(t - p.T) / 22); // canopy growth: fast early rise, saturating
    v = p.dip + (p.peak - p.dip) * g;
  }
  if (t > p.H) v += (p.post - v) * Math.min(1, (t - p.H) / 12);
  return v;
}

function sampleSeries(days, p, rng, { sigma = 1.5, missing = 0.08 } = {}) {
  return days.map((doy) => ({
    doy,
    vh: rng.chance(missing) ? null : Math.round((vhModel(doy, p) + rng.normal(0, sigma)) * 100) / 100,
  }));
}

function ricePixel(T, rng) {
  return {
    rice: true,
    T,
    base: rng.uniform(-17.8, -16.2),
    dip: rng.uniform(-25, -23),
    peak: rng.uniform(-15.8, -14.4),
    post: -18.5,
    H: T + rng.uniform(105, 120),
  };
}

/** Three hand-built test pixels that stress the detector. */
function messyPixels(rng) {
  const year = 2020;
  const days = acquisitions(year, 6, rng);
  const flood = sampleSeries(days, { rice: false, base: -17 }, rng, { missing: 0.05 }).map((o, k) => {
    const t = days[k];
    let v = -17;
    if (t >= 194 && t <= 200) v = -17 - (7 * (t - 194)) / 6;
    else if (t > 200) v = -24 + 0.01 * (t - 200); // standing water; the crop never establishes
    return o.vh === null ? o : { doy: t, vh: Math.round((v + rng.normal(0, 1.5)) * 100) / 100 };
  });
  const rice2 = ricePixel(212, rng);
  const double = sampleSeries(days, rice2, rng, { missing: 0.04 }).map((o) => {
    if (o.vh === null) return o;
    const t = o.doy;
    const early = t >= 170 && t <= 196 ? -8 * Math.exp(-(((t - 179) / 5) ** 2)) : 0; // brief June flood that drains
    return { doy: t, vh: Math.round((o.vh + early) * 100) / 100 };
  });
  const rice3 = ricePixel(205, rng);
  const sparse = sampleSeries(days, rice3, rng, { missing: 0.5 }).map((o) =>
    o.doy >= 196 && o.doy <= 214 ? { doy: o.doy, vh: null } : o,
  );
  return [
    { key: "flood", year, series: flood },
    { key: "double", year, series: double },
    { key: "sparse", year, series: sparse },
  ].map((m) => ({ ...m, det: detectTransplant(m.series, m.year) }));
}

/** NISAR L-band HV, 2026 season to date, with an acquisition gap. */
function nisarSeries(T, rng) {
  const year = NISAR_YEAR;
  const g0 = doyOf(year, ...NISAR_GAP[0]);
  const g1 = doyOf(year, ...NISAR_GAP[1]);
  const today = doyOf(2026, 9, 30);
  const p = { rice: true, T, base: -21, dip: -27, peak: -17.5, post: -19, H: T + 115 };
  const days = acquisitions(year, 12, rng).filter((d) => d <= today);
  const series = sampleSeries(days, p, rng, { sigma: 1.1, missing: 0.03 }).map((o) =>
    o.doy >= g0 && o.doy <= g1 ? { doy: o.doy, vh: null } : o,
  );
  return { year, series, gap: [g0, g1], today, det: detectTransplant(series, year) };
}

/**
 * Build the whole synthetic world and run every analysis on it.
 * `geo` from loadGeo(); `bn` optional Bangla name lookup.
 */
export function generate(geo, seed = SEED) {
  const root = createRng(seed);
  const regional = new Map(RAIN_YEARS.map((y) => [y, root.sub("regional", y).normal(0, 5)]));

  const upazilas = geo.upazilas.features.map((f) => {
    const name = f.properties.name;
    const params = upazilaParams(root.sub("params", name));

    const onset = RAIN_YEARS.map((year) => {
      const r = root.sub("rain", name, year);
      const latentDoy = params.baseOnset + (params.trend * (year - 2001)) / 10 + regional.get(year) + r.normal(0, 3);
      const rain = simulateRain(year, latentDoy - doyOf(year, 6, 1), r);
      return { year, rain, latentDoy, ...detectOnset(rain, year) };
    });

    const xs = onset.filter((o) => o.doy !== null).map((o) => o.year);
    const ys = onset.filter((o) => o.doy !== null).map((o) => o.doy);
    const mk = mannKendall(ys);
    const sen = senSlope(xs, ys);

    const seasons = VH_YEARS.map((year) => {
      const r = root.sub("vh", name, year);
      const on = onset.find((o) => o.year === year);
      const anchor = on.doy ?? on.latentDoy;
      const Tseason = anchor + params.gapMean + r.normal(0, 4);
      const days = acquisitions(year, revisitDays(year), r);
      const pixels = Array.from({ length: PIXELS }, () => {
        const T = Math.round(Tseason + r.normal(0, 6));
        const series = sampleSeries(days, ricePixel(T, r), r);
        return { truthDoy: T, series, det: detectTransplant(series, year) };
      });
      const detected = pixels.filter((p) => p.det.status === "detected").map((p) => p.det.doy);
      const med = median(detected);
      return {
        year,
        revisit: revisitDays(year),
        pixels,
        nDetected: detected.length,
        transplantDoy: med,
        iqr: detected.length ? [quantile(detected, 0.25), quantile(detected, 0.75)] : null,
        onsetDoy: on.doy,
        gap: med !== null && on.doy !== null ? med - on.doy : null,
      };
    });
    const gapMedian = median(seasons.map((s) => s.gap));
    const category = gapMedian === null ? "none" : gapMedian < GAP_BAND[0] ? "early" : gapMedian > GAP_BAND[1] ? "late" : "on track";

    return { name, id: f.properties.id, feature: f, params, onset, mk, sen, seasons, gapMedian, category };
  });

  const bh = benjaminiHochberg(upazilas.map((u) => u.mk.p), 0.1);
  upazilas.forEach((u, i) => {
    u.bh = { adjusted: bh.adjusted[i], significant: bh.significant[i], q: bh.q };
  });

  // Featured upazila = strongest evidence of a shifting onset (smallest MK p).
  const featured = upazilas.reduce((a, b) => (b.mk.p < a.mk.p ? b : a));
  // Featured pixel = latest 6-day season, clean detection closest to that season's median.
  const season = [...featured.seasons].reverse().find((s) => s.revisit === 6);
  const pixel = season.pixels
    .filter((p) => p.det.status === "detected" && !p.det.ambiguous)
    .reduce((a, b) => (Math.abs(b.det.doy - season.transplantDoy) < Math.abs(a.det.doy - season.transplantDoy) ? b : a));

  const nisar = nisarSeries(Math.round(featured.seasons.at(-1).transplantDoy - 8), root.sub("nisar"));
  const messy = messyPixels(root.sub("messy"));

  return { seed, mode: MODE, district: geo.upazilas.district, geo, upazilas, featured, featuredPixel: { year: season.year, ...pixel }, nisar, messy };
}
