// Upazila maps (hand-styled D3). Global `d3` comes from /vendor/d3.v7.min.js.
/* global d3 */
import { C } from "./charts.js";

/** Interior label point: midpoint of the widest horizontal span of the largest polygon. */
export function labelPoint(feature) {
  const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const area = (r) => Math.abs(r.reduce((a, p, i) => a + (i ? r[i - 1][0] * p[1] - p[0] * r[i - 1][1] : 0), 0));
  const ring = polys.reduce((a, b) => (area(b[0]) > area(a[0]) ? b : a))[0];
  const ys = ring.map((p) => p[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  let best = null;
  for (let k = 3; k <= 17; k++) {
    const y = y0 + ((y1 - y0) * k) / 20;
    const xs = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [xa, ya] = ring[i];
      const [xb, yb] = ring[i + 1];
      if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // prefer wide spans near the vertical middle
      const w = (xs[i + 1] - xs[i]) * (1 - 0.6 * Math.abs(k - 10) / 10);
      if (!best || w > best.w) best = { w, p: [(xs[i] + xs[i + 1]) / 2, y] };
    }
  }
  return best.p;
}

/**
 * Draw the upazila map into `container` (a DOM element).
 * opts: { model, width, height, pad, fill(u) → colour, label(u) → [line1, line2], onClick(u),
 *         selected, animate, textColor, stroke }
 * Returns { update(opts), select(name) }.
 */
export function drawMap(container, opts) {
  const { model, width, height, pad = 24 } = opts;
  const geo = model.geo.upazilas;
  const byName = new Map(model.upazilas.map((u) => [u.name, u]));
  const proj = d3.geoMercator().fitExtent([[pad, pad], [width - pad, height - pad]], geo);
  const path = d3.geoPath(proj);

  const svg = d3.select(container).append("svg")
    .attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img");

  const feats = geo.features.map((f) => {
    const [x, y] = proj(labelPoint(f));
    return { f, u: byName.get(f.properties.name), x, y };
  });
  // fill order: west → east, like a sweep across the district
  const order = [...feats].sort((a, b) => a.x - b.x).map((d) => d.u.name);

  const g = svg.append("g");
  const units = g.selectAll("g.upz").data(feats).join("g")
    .attr("class", "upz")
    .on("click", (_, d) => opts.onClick && opts.onClick(d.u));
  units.append("path").attr("d", (d) => path(d.f)).attr("fill", C.paperDeep);
  units.append("title").text((d) => d.u.name);

  svg.append("path").attr("class", "district-outline").attr("d", path(model.geo.district.features[0]));

  const labels = svg.append("g").attr("class", "labels");
  const lab = labels.selectAll("g").data(feats).join("g").attr("transform", (d) => `translate(${d.x},${d.y})`);
  lab.append("text").attr("class", "map-label").attr("text-anchor", "middle").attr("y", -4);
  lab.append("text").attr("class", "map-value").attr("text-anchor", "middle").attr("y", 16);

  function update(next = {}, animate = false) {
    Object.assign(opts, next);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("still")) animate = false;
    const dur = animate ? 700 : 0;
    units.select("path").transition().duration(dur)
      .delay((d) => (animate && next.sweep ? order.indexOf(d.u.name) * 160 : 0))
      .ease(d3.easeCubicInOut)
      .attr("fill", (d) => opts.fill(d.u));
    lab.each(function (d) {
      const [a, b] = opts.label ? opts.label(d.u) : [d.u.name, ""];
      const sel = d3.select(this);
      sel.select(".map-label").text(a);
      sel.select(".map-value").text(b);
    });
    if (animate && next.sweep) {
      lab.attr("opacity", 0).transition().duration(500)
        .delay((d) => 300 + order.indexOf(d.u.name) * 160).attr("opacity", 1);
    }
    select(opts.selected);
  }
  function select(name) {
    opts.selected = name;
    units.classed("sel", (d) => d.u.name === name);
    units.filter((d) => d.u.name === name).raise();
  }

  update({ sweep: opts.animate }, opts.animate);
  return { update, select, proj, path, order, svg };
}

/** Sequential transplant-date scale: early = paddy green → late = silt ochre. */
export function transplantScale(domain) {
  return d3.scaleLinear().domain(domain).range(["#4F7424", "#D9B26A"]).interpolate(d3.interpolateLab).clamp(true);
}

/** Diverging gap scale around the on-track band [a, b]: water ← neutral → brick. */
export function gapScale([a, b]) {
  const s = d3.scaleLinear()
    .domain([a - 9, a, b, b + 9])
    .range(["#1F5E6E", "#E6E0D2", "#E6E0D2", "#A4432F"])
    .interpolate(d3.interpolateLab).clamp(true);
  return (v) => (v === null ? "#D8D3C6" : s(v));
}

/** Small horizontal ramp legend with direct end labels (HTML string into el). */
export function rampLegend(container, { scale, domain, width = 260, left, right, ticks = [] }) {
  const svg = d3.select(container).append("svg").attr("width", width + 4).attr("height", 46);
  const id = "g" + Math.random().toString(36).slice(2, 8);
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.0001, 0.1).forEach((t) => grad.append("stop").attr("offset", t).attr("stop-color", scale(domain[0] + t * (domain[1] - domain[0]))));
  svg.append("rect").attr("x", 2).attr("y", 4).attr("width", width).attr("height", 12).attr("fill", `url(#${id})`);
  svg.append("text").attr("class", "anno-mono").attr("x", 2).attr("y", 36).text(left);
  svg.append("text").attr("class", "anno-mono").attr("x", width + 2).attr("y", 36).attr("text-anchor", "end").text(right);
  ticks.forEach(([v, s]) => {
    const x = 2 + ((v - domain[0]) / (domain[1] - domain[0])) * width;
    svg.append("line").attr("x1", x).attr("x2", x).attr("y1", 2).attr("y2", 20).attr("stroke", "var(--ink)");
    svg.append("text").attr("class", "anno-mono").attr("x", x).attr("y", 36).attr("text-anchor", "middle").text(s);
  });
  return svg;
}
