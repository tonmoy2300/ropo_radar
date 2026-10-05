// Hand-styled D3 charts and textures. Global `d3` comes from /vendor/d3.v7.min.js.
/* global d3 */
import { doyOf } from "./detect.js";
import { createRng } from "./prng.js";
import { fmtDate, fmtNum, t } from "./i18n.js";

/** Palette as literal colours (for D3 interpolation); mirrors css/tokens.css. */
export const C = {
  paper: "#F4F1EA", paperDeep: "#EAE5D9", ink: "#1B1B1B", muted: "#5F5F58",
  water: "#1F5E6E", paddy: "#5B7F2B", silt: "#B8893A", siltInk: "#85601F", brick: "#A4432F",
  radarBg: "#0E1A1F", radarFg: "#D8E3E0", radarMuted: "#8FA5A6", radarLine: "#9CD0C9",
};

const MONTH_TICKS = (year) => [5, 6, 7, 8, 9, 10, 11].map((m) => doyOf(year, m, 1));
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("still");

function drawOn(path, duration, delay = 0) {
  const len = path.node().getTotalLength();
  path.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
    .transition().delay(delay).duration(duration).ease(d3.easeCubicInOut)
    .attr("stroke-dashoffset", 0)
    .on("end", () => path.attr("stroke-dasharray", null));
}

function fadeIn(sel, delay, duration = 500) {
  sel.attr("opacity", 0).transition().delay(delay).duration(duration).ease(d3.easeCubicInOut).attr("opacity", 1);
}

/** Leader-lined annotation: from point (x0,y0) to label anchor (x1,y1). */
function annotate(g, { x0, y0, x1, y1, lines, anchor = "start", cls = ["anno-strong", "anno-mono"] }) {
  const a = g.append("g").attr("class", "annotation");
  a.append("path").attr("class", "leader").attr("d", `M${x0},${y0} L${x1},${y1 + (y1 > y0 ? -18 : 6)}`);
  a.append("circle").attr("cx", x0).attr("cy", y0).attr("r", 2.5).attr("class", "leader-dot").style("fill", "currentColor");
  lines.forEach((s, i) => {
    a.append("text").attr("class", cls[i] || "anno").attr("x", x1).attr("y", y1 + i * 24).attr("text-anchor", anchor).text(s);
  });
  return a;
}

/**
 * Backscatter time series.
 * opts: { series, year, det, width, height, mode: "story" | "diagnostic" | "mini",
 *         dark, animate, noData: [doy0, doy1] | null, today, yDomain, unit, delay }
 */
export function vhChart(container, opts) {
  const { series, year, det, width, height, mode = "diagnostic", dark = false } = opts;
  const animate = opts.animate && !reduced();
  const mini = mode === "mini";
  const m = mini ? { t: 16, r: 14, b: 30, l: 44 } : { t: 56, r: 36, b: 48, l: 72 };
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const ink = dark ? C.radarFg : C.ink;
  const muted = dark ? C.radarMuted : C.muted;
  const line = dark ? C.radarLine : C.ink;
  const x = d3.scaleLinear().domain(opts.xDomain || [doyOf(year, 5, 1), doyOf(year, 11, 10)]).range([0, W]);
  const y = d3.scaleLinear().domain(opts.yDomain || [-28, -12]).range([H, 0]);

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height)
    .attr("class", dark ? "radar" : "").style("color", ink);
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);

  // search window (diagnostic views)
  if (mode !== "story" && det && det.window) {
    const [w0, w1] = det.window;
    g.append("rect").attr("x", x(w0)).attr("width", x(w1) - x(w0)).attr("y", 0).attr("height", H)
      .style("fill", dark ? "rgba(216,227,224,.05)" : "rgba(27,27,27,.035)");
    if (!mini) g.append("text").attr("class", "anno anno-muted").attr("x", x(w0) + 8).attr("y", H - 34).style("font-size", "14px").text(t("s2.window"));
  }
  // no-data band (NISAR gap)
  if (opts.noData) {
    const [a, b] = opts.noData;
    const nd = g.append("g");
    nd.append("rect").attr("x", x(a)).attr("width", x(b) - x(a)).attr("y", 0).attr("height", H).style("fill", "rgba(107,107,99,.18)");
    nd.append("text").attr("class", "anno-mono").attr("x", (x(a) + x(b)) / 2).attr("y", 64).attr("text-anchor", "middle").style("font-size", "14px")
      .text(opts.noDataLabel);
  }
  // axes
  const xa = g.append("g").attr("class", "axis").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(x).tickValues(MONTH_TICKS(year).filter((d) => d >= x.domain()[0] && d <= x.domain()[1]))
      .tickFormat((d) => fmtDate(year, d).split(" ")[1]).tickSize(mini ? 4 : 6).tickPadding(8));
  xa.select(".domain").remove();
  g.append("line").attr("x1", 0).attr("x2", W).attr("y1", H).attr("y2", H).attr("class", "axis-base")
    .style("stroke", dark ? "rgba(216,227,224,.35)" : "rgba(27,27,27,.35)");
  const ya = g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(mini ? 3 : 5).tickFormat((d) => fmtNum(d, 0)).tickSize(mini ? 4 : 6).tickPadding(8));
  ya.select(".domain").remove();
  if (!mini) g.append("text").attr("class", "anno-mono anno-muted").attr("x", -m.l + 4).attr("y", -24).style("font-size", "14px").text(opts.unit || "VH, dB");

  // missing acquisitions as ticks on the baseline
  const missing = series.filter((o) => o.vh === null && o.doy >= x.domain()[0] && o.doy <= x.domain()[1]);
  const mt = g.append("g");
  mt.selectAll("line").data(missing).join("line")
    .attr("x1", (o) => x(o.doy)).attr("x2", (o) => x(o.doy)).attr("y1", H - (mini ? 6 : 10)).attr("y2", H)
    .style("stroke", dark ? C.radarMuted : C.brick).style("stroke-width", 1.5);
  if (missing.length && mode === "diagnostic") {
    const o = missing[missing.length - 1];
    g.append("text").attr("class", "anno anno-muted").attr("x", x(o.doy) + 6).attr("y", H - 14).style("font-size", "13px").text(t("s2.missing"));
  }

  // series
  const inDomain = series.filter((o) => o.doy >= x.domain()[0] && o.doy <= x.domain()[1]);
  const valid = inDomain.filter((o) => o.vh !== null);
  const lineGen = d3.line().defined((o) => o.vh !== null).x((o) => x(o.doy)).y((o) => y(o.vh)).curve(d3.curveMonotoneX);
  // faint dashed bridge across missing acquisitions; solid line only where consecutive data exist
  const bridge = g.append("path").datum(valid).attr("d", lineGen)
    .style("fill", "none").style("stroke", line).style("stroke-opacity", 0.45).style("stroke-width", 1).style("stroke-dasharray", "2 4");
  const path = g.append("path").datum(inDomain).attr("d", lineGen)
    .style("fill", "none").style("stroke", line).style("stroke-width", mode === "story" ? 2.25 : mini ? 1.2 : 1.5)
    .style("stroke-linejoin", "round");
  const dots = g.append("g").selectAll("circle").data(valid).join("circle")
    .attr("cx", (o) => x(o.doy)).attr("cy", (o) => y(o.vh)).attr("r", mini ? 2.2 : mode === "story" ? 3.6 : 3)
    .style("fill", dark ? C.radarFg : C.ink);

  const dur = mode === "story" ? 3400 : mini ? 900 : 1500;
  const delay = opts.delay || 0;
  if (animate) {
    drawOn(path, dur, delay);
    fadeIn(bridge, delay + dur, 400);
    dots.attr("opacity", 0).transition().delay((o) => delay + (x(o.doy) / W) * dur).duration(200).attr("opacity", 1);
  }
  const after = animate ? delay + dur + 150 : 0;
  const ann = g.append("g").attr("class", "annotations");

  if (det && det.status === "detected") {
    const px = x(det.doy);
    const py = y(det.vh);
    if (mode === "story") {
      const a1 = annotate(ann, { x0: px, y0: py + 6, x1: px + 34, y1: py + 64,
        lines: [t("s2.flooded"), fmtDate(year, det.doy)] });
      const growDoy = det.doy + 26;
      const gp = valid.reduce((a, b) => (Math.abs(b.doy - growDoy) < Math.abs(a.doy - growDoy) ? b : a));
      const a2 = annotate(ann, { x0: x(gp.doy) + 4, y0: y(gp.vh) + 4, x1: x(gp.doy) + 60, y1: y(gp.vh) + 70, lines: [t("s2.grows"), ""] });
      if (animate) {
        fadeIn(a1, after, 700);
        fadeIn(a2, after + 900, 700);
      }
    } else if (!mini) {
      const pre = [det.doy - 60, det.doy - 12];
      const d1 = ann.append("g");
      d1.append("line").attr("x1", x(Math.max(pre[0], x.domain()[0]))).attr("x2", x(pre[1])).attr("y1", y(det.preMedian)).attr("y2", y(det.preMedian))
        .style("stroke", C.water).style("stroke-width", 2).style("stroke-dasharray", "6 4");
      d1.append("text").attr("class", "anno-mono").attr("x", x(Math.max(pre[0], x.domain()[0]))).attr("y", y(det.preMedian) - 12)
        .style("fill", C.water).text(`${t("s2.pre")} ${fmtNum(det.preMedian, 1)} dB`);
      // drop bracket
      d1.append("line").attr("x1", px - 14).attr("x2", px - 14).attr("y1", y(det.preMedian)).attr("y2", py).style("stroke", C.ink);
      d1.append("line").attr("x1", px - 18).attr("x2", px - 10).attr("y1", y(det.preMedian)).attr("y2", y(det.preMedian)).style("stroke", C.ink);
      d1.append("text").attr("class", "anno-mono").attr("x", px - 24).attr("y", (y(det.preMedian) + py) / 2 + 5).attr("text-anchor", "end")
        .text(`${t("s2.drop")} ${fmtNum(det.drop, 1)} dB ≥ 3`);
      // rise bracket at the tail
      const rx = x(det.riseDoy) + 14;
      const tailV = det.vh + det.rise;
      d1.append("line").attr("x1", px).attr("x2", rx).attr("y1", py).attr("y2", py).style("stroke", C.ink).style("stroke-dasharray", "2 3");
      d1.append("line").attr("x1", rx).attr("x2", rx).attr("y1", py).attr("y2", y(tailV)).style("stroke", C.paddy).style("stroke-width", 2);
      d1.append("line").attr("x1", rx - 4).attr("x2", rx + 4).attr("y1", y(tailV)).attr("y2", y(tailV)).style("stroke", C.paddy).style("stroke-width", 2);
      d1.append("text").attr("class", "anno-mono").attr("x", rx + 10).attr("y", (py + y(tailV)) / 2 + 5).style("fill", "#4A6A21")
        .text(`${t("s2.rise")} +${fmtNum(det.rise, 1)} dB ≥ 4`);
      // detection line + label
      d1.append("line").attr("x1", px).attr("x2", px).attr("y1", -6).attr("y2", H).style("stroke", C.brick).style("stroke-width", 1.25);
      d1.append("circle").attr("cx", px).attr("cy", py).attr("r", 8).style("fill", "none").style("stroke", C.brick).style("stroke-width", 2);
      const unc = det.uncertainty ? `  ± ${det.uncertainty} d` : "";
      d1.append("text").attr("class", "anno-strong").attr("x", px + 10).attr("y", -12).style("fill", C.brick)
        .text(`${t("s2.detected")} ${fmtDate(year, det.doy)}${unc}`);
      if (animate) fadeIn(d1, after, 600);
    } else {
      ann.append("line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", H).style("stroke", C.brick).style("stroke-width", 1.25);
      ann.append("circle").attr("cx", px).attr("cy", py).attr("r", 6).style("fill", "none").style("stroke", C.brick).style("stroke-width", 1.75);
      if (animate) fadeIn(ann, after, 400);
    }
    (det.alternates || []).forEach((alt) => {
      const a = ann.append("g");
      a.append("circle").attr("cx", x(alt.doy)).attr("cy", y(alt.vh)).attr("r", mini ? 6 : 8).style("fill", "none")
        .style("stroke", C.brick).style("stroke-width", 1.5).style("stroke-dasharray", "3 2");
      if (animate) fadeIn(a, after + 200, 400);
    });
  } else if (det && det.candidateDoy) {
    const cand = series.find((o) => o.doy === det.candidateDoy);
    const a = ann.append("g");
    a.append("circle").attr("cx", x(cand.doy)).attr("cy", y(cand.vh)).attr("r", mini ? 6 : 8).style("fill", "none")
      .style("stroke", muted).style("stroke-width", 1.5).style("stroke-dasharray", "3 2");
    if (!mini) a.append("text").attr("class", "anno-strong").attr("x", x(cand.doy) + 10).attr("y", -12).style("fill", C.brick)
      .text(`${t("s6.notDetected")} — ${det.reason}`);
    if (animate) fadeIn(a, after, 400);
  }
  if (opts.today) {
    const a = ann.append("g");
    a.append("line").attr("x1", x(opts.today)).attr("x2", x(opts.today)).attr("y1", 0).attr("y2", H).style("stroke", muted).style("stroke-dasharray", "2 4");
    a.append("text").attr("class", "anno-mono anno-muted").attr("x", x(opts.today) - 6).attr("y", H - 16).attr("text-anchor", "end").text(t("s6.today"));
  }
  return { svg, x, y, m };
}

/**
 * 25-year onset chart: yearly points, Sen line, CI band, false starts.
 * Returns { update(u, animate) }.
 */
export function onsetChart(container, { model, u, width, height, animate }) {
  const m = { t: 30, r: 150, b: 48, l: 84 };
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const all = model.upazilas.flatMap((v) => v.onset.map((o) => o.doy)).filter((d) => d !== null);
  const x = d3.scaleLinear().domain([2000.5, 2025.5]).range([0, W]);
  const y = d3.scaleLinear().domain([d3.min(all) - 4, d3.max(all) + 4]).range([H, 0]).nice();
  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);

  const xa = g.append("g").attr("class", "axis").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(x).tickValues([2001, 2005, 2010, 2015, 2020, 2025]).tickFormat(d3.format("d")).tickSize(6).tickPadding(8));
  xa.select(".domain").remove();
  g.append("line").attr("x1", 0).attr("x2", W).attr("y1", H).attr("y2", H).style("stroke", "rgba(27,27,27,.35)");
  const yTicks = [];
  for (let mo = 5; mo <= 8; mo++) for (const d of [1, 11, 21]) {
    const v = doyOf(2001, mo, d);
    if (v >= y.domain()[0] && v <= y.domain()[1]) yTicks.push(v);
  }
  const ya = g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickValues(yTicks).tickFormat((d) => fmtDate(2001, d)).tickSize(-W).tickPadding(10));
  ya.select(".domain").remove();
  ya.selectAll(".tick line").style("stroke", "rgba(27,27,27,.07)");
  g.append("text").attr("class", "anno-mono anno-muted").attr("x", -m.l + 4).attr("y", -12).style("font-size", "14px").text(t("s4.onset"));

  const band = g.append("path").style("fill", C.water).style("fill-opacity", 0.13);
  const bandLbl = g.append("text").attr("class", "anno-mono").style("fill", C.water);
  const falseG = g.append("g");
  const senLine = g.append("line").style("stroke", C.ink).style("stroke-width", 2.25);
  const senLbl = g.append("text").attr("class", "anno-mono");
  const pts = g.append("g");
  const fsLbl = g.append("g");

  function update(uu, anim) {
    const a = anim && !reduced();
    const obs = uu.onset.filter((o) => o.doy !== null);
    const s = uu.sen;
    const line = (b, i) => [[2001, i + b * 2001], [2025, i + b * 2025]];
    const lo = line(s.lo, s.interceptLo);
    const hi = line(s.hi, s.interceptHi);
    const bandD = `M${x(lo[0][0])},${y(lo[0][1])} L${x(lo[1][0])},${y(lo[1][1])} L${x(hi[1][0])},${y(hi[1][1])} L${x(hi[0][0])},${y(hi[0][1])} Z`;
    const sl = line(s.slope, s.intercept);
    const T = a ? 700 : 0;
    const pointsDur = a ? 1600 : 0;

    const circles = pts.selectAll("circle").data(obs, (o) => o.year).join(
      (enter) => enter.append("circle").attr("r", 6).style("fill", C.water).style("stroke", C.paper).style("stroke-width", 1.5)
        .attr("cx", (o) => x(o.year)).attr("cy", (o) => y(o.doy)),
    );
    if (a && !update.done) {
      circles.attr("opacity", 0).transition().delay((o) => ((o.year - 2001) / 24) * pointsDur).duration(300).attr("opacity", 1);
    } else {
      circles.transition().duration(T).ease(d3.easeCubicInOut).attr("cy", (o) => y(o.doy));
    }

    // false starts: first rejected burst per year
    const fs = uu.onset.filter((o) => o.rejected.length).map((o) => ({ year: o.year, doy: o.rejected[0].doy }));
    falseG.selectAll("path").data(fs, (d) => d.year).join("path")
      .attr("d", (d) => `M${x(d.year) - 4},${y(d.doy) - 4} L${x(d.year) + 4},${y(d.doy) + 4} M${x(d.year) - 4},${y(d.doy) + 4} L${x(d.year) + 4},${y(d.doy) - 4}`)
      .style("stroke", C.muted).style("stroke-width", 1.3);
    fsLbl.selectAll("*").remove();
    if (fs.length) {
      const f = fs[fs.length - 1]; // latest false start, labelled to its left
      fsLbl.append("text").attr("class", "anno anno-muted").attr("x", x(f.year) - 12).attr("y", y(f.doy) + 5)
        .attr("text-anchor", "end").style("font-size", "15px").text(t("s4.falseStart"));
    }

    const first = !update.done;
    const tr = (sel) => (first ? sel : sel.transition().duration(T).ease(d3.easeCubicInOut));
    tr(band).attr("d", bandD);
    tr(senLine).attr("x1", x(sl[0][0])).attr("y1", y(sl[0][1])).attr("x2", x(sl[1][0])).attr("y2", y(sl[1][1]));
    tr(senLbl).attr("x", x(2025) + 16).attr("y", y(sl[1][1]) + 5);
    senLbl.text(t("s4.sen"));
    tr(bandLbl).attr("x", x(2025) + 16).attr("y", y(hi[1][1]) - 4);
    bandLbl.text(t("s4.band"));

    if (a && first) {
      band.attr("opacity", 0).transition("reveal").delay(pointsDur + 700).duration(800).attr("opacity", 1);
      bandLbl.attr("opacity", 0).transition("reveal").delay(pointsDur + 900).duration(600).attr("opacity", 1);
      const len = Math.hypot(x(2025) - x(2001), y(sl[1][1]) - y(sl[0][1]));
      senLine.style("stroke-dasharray", `${len} ${len}`).style("stroke-dashoffset", len)
        .transition("reveal").delay(pointsDur + 100).duration(900).ease(d3.easeCubicInOut).style("stroke-dashoffset", 0)
        .on("end", () => senLine.style("stroke-dasharray", null));
      senLbl.attr("opacity", 0).transition("reveal").delay(pointsDur + 900).duration(500).attr("opacity", 1);
      falseG.attr("opacity", 0).transition("reveal").delay(pointsDur + 1400).duration(600).attr("opacity", 1);
      fsLbl.attr("opacity", 0).transition("reveal").delay(pointsDur + 1600).duration(600).attr("opacity", 1);
    }
    update.done = true;
  }
  update(u, animate);
  return { update };
}

/** Per-season adaptation gap: dots on a days axis with the on-track band. No trend line by design. */
export function gapStrip(container, { u, width, height, band, color, animate }) {
  const m = { t: 34, r: 24, b: 44, l: 64 };
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const years = u.seasons.map((s) => s.year);
  const x = d3.scalePoint().domain(years).range([0, W]).padding(0.5);
  const y = d3.scaleLinear().domain([0, 50]).range([H, 0]);
  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
  g.append("rect").attr("x", 0).attr("width", W).attr("y", y(band[1])).attr("height", y(band[0]) - y(band[1])).style("fill", C.paperDeep);
  g.append("text").attr("class", "anno anno-muted").attr("x", W - 8).attr("y", y(band[1]) + 20).attr("text-anchor", "end").style("font-size", "14px").text(t("s5.ontrack"));
  const xa = g.append("g").attr("class", "axis").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).tickSize(0).tickPadding(12));
  xa.select(".domain").remove();
  const ya = g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickValues([0, 15, 30, 45]).tickSize(5).tickPadding(8));
  ya.select(".domain").remove();
  g.append("text").attr("class", "anno-mono anno-muted").attr("x", -m.l + 4).attr("y", -14).style("font-size", "14px").text(t("s5.days"));
  g.append("line").attr("x1", 0).attr("x2", W).attr("y1", H).attr("y2", H).style("stroke", "rgba(27,27,27,.35)");
  const cells = g.selectAll("g.season").data(u.seasons).join("g").attr("class", "season").attr("transform", (s) => `translate(${x(s.year)},0)`);
  cells.each(function (s) {
    const c = d3.select(this);
    if (s.gap === null) {
      c.append("text").attr("class", "anno-mono anno-muted").attr("y", H - 10).attr("text-anchor", "middle").text(t("s5.nd"));
      return;
    }
    const v = Math.max(0, Math.min(50, s.gap));
    c.append("line").attr("y1", H).attr("y2", y(v)).style("stroke", "rgba(27,27,27,.25)");
    c.append("circle").attr("cy", y(v)).attr("r", 8).style("fill", color(s.gap)).style("stroke", C.ink).style("stroke-width", 1);
    c.append("text").attr("class", "anno-mono").attr("y", y(v) - 16).attr("text-anchor", "middle").text(fmtNum(s.gap, 0));
  });
  if (animate && !reduced()) cells.attr("opacity", 0).transition().delay((s, i) => 150 + i * 110).duration(450).attr("opacity", 1);
  return svg;
}

/* ───────────── textures (seeded) ───────────── */

function valueNoise(rng, gw, gh) {
  const grid = Array.from({ length: (gw + 1) * (gh + 1) }, () => rng.next());
  const at = (i, j) => grid[j * (gw + 1) + i];
  const sm = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const X = u * gw;
    const Y = v * gh;
    const i = Math.min(gw - 1, Math.floor(X));
    const j = Math.min(gh - 1, Math.floor(Y));
    const fx = sm(X - i);
    const fy = sm(Y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

function fbm(rng, aspect) {
  const oct = [4, 8, 16, 32, 64].map((f) => ({ f, n: valueNoise(rng, Math.round(f * aspect), f) }));
  return (u, v) => {
    let s = 0;
    let amp = 0.5;
    let norm = 0;
    for (const o of oct) {
      s += amp * o.n(u, v);
      norm += amp;
      amp *= 0.52;
    }
    return s / norm;
  };
}

/** Cloud deck canvas. Returns { canvas, cover } where cover = share of pixels with optical depth > 0.5. */
export function cloudCanvas(w, h, seed) {
  const rng = createRng(seed).sub("clouds");
  const n = fbm(rng, w / h);
  const shade = fbm(rng.sub("shade"), w / h);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(w, h);
  let covered = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = n(i / w, j / h);
      const d = Math.min(1, Math.max(0, (v - 0.27) / 0.2)); // optical depth proxy
      const s = shade(i / w + 0.01, j / h + 0.012);
      const g = 206 + 46 * d - 52 * Math.max(0, s - 0.46);
      const k = (j * w + i) * 4;
      img.data[k] = g;
      img.data[k + 1] = g + 2;
      img.data[k + 2] = g + 4;
      img.data[k + 3] = 255 * Math.min(0.9, 0.16 + 0.8 * d);
      if (d > 0.5) covered++;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: cv, cover: covered / (w * h) };
}

/** Radar-grain canvas: single-look speckle (exponential intensity) over a field pattern. */
export function speckleCanvas(w, h, seed, mask) {
  const rng = createRng(seed).sub("speckle");
  const fields = fbm(rng.sub("fields"), w / h);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const inside = mask ? mask(i, j) : true;
      const f = fields(i / w, j / h);
      const mean = inside ? (f > 0.52 ? 0.14 : 0.5) : 0.1; // flooded paddies are dark
      const I = -mean * Math.log(1 - rng.next());
      const g = Math.max(0, Math.min(255, 26 + 128 * Math.sqrt(I)));
      const k = (j * w + i) * 4;
      img.data[k] = g * 0.86;
      img.data[k + 1] = g * 0.97;
      img.data[k + 2] = g;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
