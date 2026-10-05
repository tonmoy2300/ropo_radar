// Event detection: usable-rain onset from daily rain, transplant date from a VH series.
import { median } from "./stats.js";

/** Day of year (1-based) for a calendar date; month is 1-12. */
export function doyOf(year, month, day) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 864e5) + 1;
}

/** Calendar date for a day of year → { month (1-12), day }. */
export function dateOf(year, doy) {
  const d = new Date(Date.UTC(year, 0, doy));
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export const ONSET_RULE = {
  startMonth: 6, startDay: 1, // search from 1 June
  wetMm: 20, wetDays: 3,      // ≥ 20 mm accumulated over 3 days
  dryDayMm: 1,                // a "dry day" has < 1 mm
  maxDrySpell: 7,             // no dry spell longer than 7 days …
  lookahead: 30,              // … in the following 30 days
};

/**
 * Usable-rain onset. `rain[i]` is mm on day i counted from 1 June of `year`.
 * Returns { doy, index, sum3, longestDry, rejected: [{ doy, longestDry }] } or
 * { doy: null, … } if no day satisfies the rule.
 * A candidate whose 3-day total passes but is followed by a long dry spell is a
 * "false start" and is listed in `rejected`.
 */
export function detectOnset(rain, year, rule = ONSET_RULE) {
  const d0 = doyOf(year, rule.startMonth, rule.startDay);
  const rejected = [];
  for (let i = 0; i + rule.lookahead < rain.length; i++) {
    let sum = 0;
    for (let k = 0; k < rule.wetDays; k++) sum += rain[i + k];
    if (sum < rule.wetMm) continue;
    let run = 0;
    let longest = 0;
    for (let k = i + 1; k <= i + rule.lookahead; k++) {
      run = rain[k] < rule.dryDayMm ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest <= rule.maxDrySpell) {
      return { doy: d0 + i, index: i, sum3: sum, longestDry: longest, rejected };
    }
    if (!rejected.length || d0 + i - rejected[rejected.length - 1].doy > rule.wetDays) {
      rejected.push({ doy: d0 + i, longestDry: longest });
    }
  }
  return { doy: null, index: null, sum3: null, longestDry: null, rejected };
}

export const TRANSPLANT_RULE = {
  window: [[6, 15], [9, 15]], // search the VH minimum between 15 Jun and 15 Sep
  preFrom: 60, preTo: 12,     // pre-dip median: observations 60 → 12 days before the minimum
  minDrop: 3,                 // minimum must be ≥ 3 dB below the pre-dip median
  riseWithin: 45, minRise: 4, // followed by ≥ 4 dB rise within 45 days
  tail: 3, minPost: 2,        // rise = median of the last 3 observations in those 45 days − dip
  minPre: 3,                  // need ≥ 3 pre-dip observations
  separate: 18,               // other valid dips > 18 days away are reported as alternates
};

/**
 * Transplant date from a backscatter series.
 * `obs` = [{ doy, vh }] (vh null = missing acquisition), `year` for the window.
 * Candidates inside the window are tried from deepest to shallowest; the first one
 * passing both tests is the transplant date. Returns
 * Rise = median of the last three observations within 45 d, minus the dip: a sustained
 * rise (growing canopy), so one speckle outlier cannot fake it.
 *   { status: "detected", doy, vh, preMedian, drop, rise, riseDoy, gapBefore, gapAfter,
 *     uncertainty, alternates, tested, nValid, nObs }
 * or { status: "not detected", reason, … diagnostics of the deepest candidate }.
 */
export function detectTransplant(obs, year, rule = TRANSPLANT_RULE) {
  const valid = obs.filter((o) => o.vh !== null && Number.isFinite(o.vh));
  const w0 = doyOf(year, ...rule.window[0]);
  const w1 = doyOf(year, ...rule.window[1]);
  const idx = valid.map((o, i) => i).filter((i) => valid[i].doy >= w0 && valid[i].doy <= w1);
  idx.sort((a, b) => valid[a].vh - valid[b].vh);

  const base = { nValid: valid.length, nObs: obs.length, window: [w0, w1] };
  if (!idx.length) return { ...base, status: "not detected", reason: "no observations in window", doy: null, tested: 0 };

  const evaluate = (i) => {
    const c = valid[i];
    const pre = valid.filter((o) => o.doy >= c.doy - rule.preFrom && o.doy <= c.doy - rule.preTo).map((o) => o.vh);
    const out = { i, doy: c.doy, vh: c.vh, preMedian: null, drop: null, rise: null, riseDoy: null, nPre: pre.length };
    if (pre.length < rule.minPre) return { ...out, pass: false, reason: `${pre.length} of ${rule.minPre} needed observations before dip` };
    out.preMedian = median(pre);
    out.drop = out.preMedian - c.vh;
    const post = valid.filter((o) => o.doy > c.doy && o.doy <= c.doy + rule.riseWithin);
    if (post.length >= rule.minPost) {
      const tail = post.slice(-rule.tail);
      out.rise = median(tail.map((o) => o.vh)) - c.vh;
      out.riseDoy = tail[tail.length - 1].doy;
    }
    if (out.drop < rule.minDrop) return { ...out, pass: false, reason: `drop ${out.drop.toFixed(1)} dB < ${rule.minDrop} dB` };
    if (out.rise === null) return { ...out, pass: false, reason: `${post.length} observations in ${rule.riseWithin} d after dip` };
    if (out.rise < rule.minRise) return { ...out, pass: false, reason: `rise ${out.rise.toFixed(1)} dB < ${rule.minRise} dB in ${rule.riseWithin} d` };
    return { ...out, pass: true };
  };

  const results = idx.map(evaluate);
  const passing = results.filter((r) => r.pass);
  if (!passing.length) {
    const r = results[0];
    return { ...base, ...r, status: "not detected", doy: null, candidateDoy: r.doy, tested: results.length };
  }
  const chosen = passing[0];
  const alternates = [];
  for (const r of passing.slice(1)) {
    const far = [chosen, ...alternates].every((a) => Math.abs(a.doy - r.doy) > rule.separate);
    if (far) alternates.push({ doy: r.doy, vh: r.vh, drop: r.drop, rise: r.rise });
  }
  const gapBefore = chosen.i > 0 ? chosen.doy - valid[chosen.i - 1].doy : null;
  const gapAfter = chosen.i < valid.length - 1 ? valid[chosen.i + 1].doy - chosen.doy : null;
  return {
    ...base,
    ...chosen,
    status: "detected",
    gapBefore,
    gapAfter,
    uncertainty: Math.max(gapBefore ?? 0, gapAfter ?? 0),
    alternates,
    ambiguous: alternates.length > 0,
    tested: results.length,
  };
}
