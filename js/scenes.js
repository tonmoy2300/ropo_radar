// Scene engine (1920×1080 stage, keyboard-driven) and the 8 video scenes.
/* global d3 */
import { loadGeo, generate, GAP_BAND, NISAR_GAP, PIXELS } from "./data.js";
import { loadI18n, t, tb, raw, fmtDate, fmtNum, fmtP, bnDigits, upzBn, smsInfo } from "./i18n.js";
import { drawMap, transplantScale, gapScale, rampLegend, labelPoint } from "./map.js";
import { vhChart, onsetChart, gapStrip, cloudCanvas, speckleCanvas, C } from "./charts.js";
import { doyOf } from "./detect.js";

// `?still` renders every scene in its final state (for stills); same path as prefers-reduced-motion.
export const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("still");

/* ───────────── DOM helpers ───────────── */
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function place(e, { x, y, w, h }) {
  Object.assign(e.style, { position: "absolute", left: `${x}px`, top: `${y}px` });
  if (w) e.style.width = `${w}px`;
  if (h) e.style.height = `${h}px`;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ───────────── derived text (all numbers from stats.js / detect.js results) ───────────── */
export function trendView(u) {
  const s = u.sen;
  const k = 10; // per year → per decade
  const lo = s.lo * k;
  const hi = s.hi * k;
  const ci = lo < 0 ? `${fmtNum(lo, 1)} to ${fmtNum(hi, 1)}` : `${fmtNum(lo, 1)}–${fmtNum(hi, 1)}`;
  return {
    slope: fmtNum(s.slope * k, 1, { plus: true }),
    ci,
    p: `p ${fmtP(u.mk.p)}`,
    meta: `Mann-Kendall S = ${u.mk.S}, Z = ${fmtNum(u.mk.Z, 2)}, n = ${u.mk.n}`,
  };
}

export function confidenceOf(u) {
  const n = u.seasons.filter((s) => s.gap !== null).length;
  const level = u.bh.significant && n >= u.seasons.length - 1 ? "moderate" : "low";
  return { level, n, total: u.seasons.length };
}

export function adviceFor(u) {
  const perDecade = u.sen.slope * 10;
  const dir = perDecade >= 0 ? "later" : "earlier";
  const slope = Math.round(Math.abs(perDecade));
  const n = u.seasons.filter((s) => s.gap !== null).length;
  const gap = Math.round(u.gapMedian);
  const conf = confidenceOf(u);
  // Only claim a shift when the onset trend survives the Benjamini-Hochberg correction.
  const k = u.bh.significant ? "" : "Flat";
  return {
    en: t(`s7.advisory${k}`, { upazila: u.name, slope, direction: t(`s7.${dir}`), n, gap }),
    bn: tb(`s7.advisory${k}`, { upazila: upzBn(u.name), slope: bnDigits(slope), direction: tb(`s7.${dir}`), n: bnDigits(n), gap: bnDigits(gap) }),
    smsEn: t(`s7.sms${k}`, { upazila: u.name, slope, days: slope === 1 ? "day" : "days", direction: t(`s7.${dir}`), conf: t(`s7.conf.${conf.level}`) }),
    smsBn: tb(`s7.sms${k}`, { upazila: upzBn(u.name), slope: bnDigits(slope), direction: tb(`s7.${dir}`) }),
    conf,
    shift: u.bh.significant,
  };
}

function seasonOf(u, year) {
  return u.seasons.find((s) => s.year === year);
}

/* ───────────── reusable panels (scene + explore) ───────────── */

export function heroBlock(u) {
  const v = trendView(u);
  const d = el("div", "hero");
  d.innerHTML = `
    <div class="fig-label"><b>${esc(u.name)}</b><span>usable-rain onset trend, 2001–2025</span></div>
    <div class="hero-num" style="margin-top:14px">${v.slope}<small>${t("s4.unit")}</small></div>
    <div class="hero-meta"><span class="ci">[${t("s4.ci")} ${v.ci}]</span>&nbsp;&nbsp; ${v.p}</div>
    <div class="hero-meta muted" style="font-size:17px;margin-top:6px">${v.meta} · BH-adjusted p ${fmtP(u.bh.adjusted)}</div>`;
  return d;
}

export function trendTable(model, selected, onPick) {
  const tb = el("table", "stat-table");
  const [h1, h2, h3, h4, h5] = raw("s4.tableHead");
  tb.innerHTML = `<thead><tr><th>${h1}</th><th>${h2}</th><th>${h3}</th><th>${h4}</th><th>${h5}</th></tr></thead><tbody></tbody>`;
  const body = tb.querySelector("tbody");
  const rows = [...model.upazilas].sort((a, b) => b.sen.slope - a.sen.slope);
  for (const u of rows) {
    const v = trendView(u);
    const tr = el("tr");
    tr.dataset.name = u.name;
    tr.innerHTML = `<td>${esc(u.name)}</td><td>${v.slope}</td><td class="dim">${v.ci}</td><td>${fmtP(u.mk.p).replace("= ", "")}</td>
      <td class="${u.bh.significant ? "sig" : "dim"}"><span class="dot ${u.bh.significant ? "fill" : ""}"></span></td>`;
    tr.addEventListener("click", () => onPick(u));
    body.append(tr);
  }
  const select = (name) => body.querySelectorAll("tr").forEach((r) => r.classList.toggle("sel", r.dataset.name === name));
  select(selected);
  return { table: tb, select };
}

function messyVerdict(m) {
  const d = m.det;
  if (d.status === "detected" && d.ambiguous) {
    return `<span class="mono" style="color:var(--silt-ink)">AMBIGUOUS</span> ${fmtDate(m.year, d.doy)} and ${d.alternates.map((a) => fmtDate(m.year, a.doy)).join(", ")} both pass. Needs a water mask (OPERA DSWx-S1).`;
  }
  if (d.status === "detected") {
    return `<span class="mono" style="color:var(--paddy-ink)">DETECTED</span> ${fmtDate(m.year, d.doy)} ± ${d.uncertainty} d`;
  }
  return `<span class="mono" style="color:var(--brick)">NOT DETECTED</span> ${esc(d.reason)} <span class="muted">(${d.nValid}/${d.nObs} acquisitions valid)</span>`;
}

export function messyPanel(model, width, animate) {
  const wrap = el("div");
  const titles = { flood: t("s6.flood"), double: t("s6.double"), sparse: t("s6.sparse") };
  model.messy.forEach((m, i) => {
    const box = el("div");
    box.style.marginTop = i ? "26px" : "14px";
    box.innerHTML = `<div class="fig-label" style="font-size:13px"><b>${String.fromCharCode(65 + i)}</b><span>${titles[m.key]}</span></div>`;
    const ch = el("div");
    box.append(ch);
    vhChart(ch, { series: m.series, year: m.year, det: m.det, width, height: 150, mode: "mini", animate, delay: 400 + i * 500 });
    const v = el("div", "", messyVerdict(m));
    v.style.cssText = "font-size:16px;line-height:1.4;margin-top:2px";
    box.append(v);
    wrap.append(box);
  });
  return wrap;
}

function pixelInfo(u, season, pixel, idx) {
  const d = pixel.det;
  return `${esc(u.name)} · pixel ${idx + 1} of ${PIXELS} · ${season.year} · revisit ${season.revisit} d · ${d.nValid} of ${d.nObs} acquisitions valid · ${d.tested} candidate minima tested`;
}

export function phoneMock(u) {
  const a = adviceFor(u);
  const ph = el("div", "phone");
  const bars = ["low", "moderate", "high"].map((l, i) => `<i class="${i <= ["low", "moderate", "high"].indexOf(a.conf.level) ? "on" : ""}"></i>`).join("");
  ph.innerHTML = `
    <div class="notch"></div>
    <div class="status"><span>09:41</span><span>SMS · 4G</span></div>
    <div class="app-head"><div class="t">Ropon Radar<span class="bn">${tb("word")}</span></div>
      <div class="s">${esc(u.name)} upazila · <span class="bn">${upzBn(u.name)}</span> · Aman season</div></div>
    <div class="body">
      <div class="msg-bn bn" lang="bn">${a.bn}</div>
      <div class="msg-en" lang="en">${esc(a.en)}</div>
      <div class="conf"><span class="bn">${tb("s7.confLabel")}: ${tb(`s7.conf.${a.conf.level}`)}</span><span class="bars">${bars}</span>
        <span>${t("s7.confLabel")}: ${t(`s7.conf.${a.conf.level}`)}</span></div>
      <div class="demo">${t("s7.demo")} · <span class="bn">${tb("s7.demo")}</span></div>
    </div>`;
  return ph;
}

/** SMS box with live counter. `typed` animates typing via ctx.later; `editable` for explore mode. */
export function smsBox({ text, bn = false, typed = false, editable = false, later }) {
  const wrap = el("div");
  wrap.innerHTML = `<div class="fig-label" style="margin-bottom:12px"><span>${bn ? t("s7.smsHeadBn") : t("s7.smsHead")}</span></div>`;
  const box = el("div", `sms${bn ? " sms-bn bn" : ""}`);
  if (bn) box.lang = "bn";
  const counter = el("div", "counter");
  const meter = el("div", "meter", "<i></i>");
  wrap.append(box, counter, meter);
  const render = (s) => {
    const info = smsInfo(s);
    // English target: one SMS (≤ 160). Bangla needs UCS-2: 70 per single SMS, 67 per part when split.
    const cap = bn ? info.capacity : info.limit;
    counter.classList.toggle("over", info.units > cap);
    const seg = info.segments > 1 ? ` · ${t("s7.segments", { n: info.segments })}` : "";
    counter.innerHTML = `<span>${info.encoding} · ${bn ? t("s7.limitBn") : t("s7.limitEn")}</span><span><b>${info.units}</b> / ${cap}${seg}</span>`;
    meter.firstChild.style.width = `${Math.min(100, (100 * info.units) / cap)}%`;
  };
  if (editable) {
    box.contentEditable = "true";
    box.spellcheck = false;
    box.textContent = text;
    box.addEventListener("input", () => render(box.textContent));
    render(text);
  } else if (typed && !REDUCED) {
    const chars = [...text];
    let i = 0;
    box.innerHTML = '<span class="caret"></span>';
    render("");
    const step = () => {
      i = Math.min(chars.length, i + 2);
      const s = chars.slice(0, i).join("");
      box.innerHTML = `${esc(s)}<span class="caret"></span>`;
      render(s);
      if (i < chars.length) later(45, step);
    };
    wrap.start = () => later(0, step);
  } else {
    box.textContent = text;
    render(text);
  }
  return wrap;
}

export function evidenceDrawer(model, u) {
  const v = trendView(u);
  const years = u.onset.filter((o) => o.doy !== null);
  const dr = el("aside", "drawer");
  dr.innerHTML = `
    <button class="close" type="button">Close</button>
    <h3>${t("s8.shown")}</h3>
    <div class="hero-num" style="font-size:52px">${v.slope}<small>${t("s4.unit")}</small></div>
    <dl style="margin-top:18px">
      <dt>${t("s8.value")}</dt><dd class="mono">Sen slope ${fmtNum(u.sen.slope, 3)} d/yr × 10 · [${t("s4.ci")} ${v.ci}]</dd>
      <dt>${t("s8.fn")}</dt><dd class="mono">stats.senSlope(years, onsetDOY)</dd>
      <dt>trend test</dt><dd class="mono">stats.mannKendall → S = ${u.mk.S}, Var(S) = ${fmtNum(u.mk.varS, 1)}, ${v.p}</dd>
      <dt>multiple tests</dt><dd class="mono">stats.benjaminiHochberg(${model.upazilas.length} upazilas, q = ${u.bh.q.toFixed(2)}) → ${u.bh.significant ? "significant" : "not significant"}</dd>
      <dt>${t("s8.inputs")}</dt><dd class="mono" style="font-size:14px;line-height:1.5">${years.length} onset DOYs via detect.detectOnset():<br>${years.map((o) => o.doy).join(" ")}</dd>
    </dl>
    <h3>${t("s8.mode")}</h3>
    <dl><dt>${t("s8.mode")}</dt><dd><b>${model.mode}</b> · ${t("s8.modeValue").split("—")[1] || ""}</dd>
      <dt>${t("s8.seed")}</dt><dd class="mono">mulberry32(${model.seed})</dd></dl>
    <h3>${t("s8.datasets")}</h3>
    <ul>${raw("datasets").map(([n, d]) => `<li><b>${esc(n)}</b><span>${esc(d)}</span></li>`).join("")}</ul>
    <h3>${t("s8.methods")}</h3>
    <ul>${raw("methods").map(([n, d]) => `<li><b>${esc(n)}</b><span class="mono" style="font-size:15px">${esc(d)}</span></li>`).join("")}</ul>`;
  return dr;
}

/* ───────────── scenes ───────────── */

function header(sec, key, vars = {}, { x = 96, y = 128, title = true } = {}) {
  const h = place(el("div"), { x, y });
  h.innerHTML = `<div class="fig-label"><span>${t(`scenes.${key}.fig`, vars)}</span></div>` +
    (title ? `<h1 class="scene-title">${t(`scenes.${key}.title`)}</h1>` : "");
  sec.append(h);
  return h;
}

function districtSvg(tile, model, w, h, pad, { stroke, upStroke, width = 2 }) {
  const proj = d3.geoMercator().fitExtent([[pad, pad], [w - pad, h - pad]], model.geo.upazilas);
  const path = d3.geoPath(proj);
  const svg = d3.select(tile).append("svg").attr("width", w).attr("height", h).style("position", "absolute").style("left", 0).style("top", 0);
  svg.append("g").selectAll("path").data(model.geo.upazilas.features).join("path").attr("d", path)
    .style("fill", "none").style("stroke", upStroke).style("stroke-width", 1);
  svg.append("path").attr("d", path(model.geo.district.features[0])).style("fill", "none").style("stroke", stroke).style("stroke-width", width);
  return { svg, proj, path };
}

function scaleBar(svg, proj, x, y, color) {
  // 10 km, measured on the projection at the district's latitude
  const c = proj.invert([x, y]);
  const km = 10;
  const dLon = km / (111.32 * Math.cos((c[1] * Math.PI) / 180));
  const px = proj([c[0] + dLon, c[1]])[0] - proj(c)[0];
  const g = svg.append("g").attr("transform", `translate(${x},${y})`).style("color", color);
  g.append("path").attr("d", `M0,-6 V0 H${px} V-6`).style("fill", "none").style("stroke", "currentColor").style("stroke-width", 1.5);
  g.append("text").attr("x", px + 8).attr("y", 0).attr("class", "anno-mono").style("fill", "currentColor").style("stroke", "none").style("font-size", "14px").text(`${km} km`);
}

const S1 = {
  key: "s1", theme: "paper", seconds: 15,
  build(sec, ctx) {
    const { model } = ctx;
    header(sec, "s1", {}, { title: false });
    const W = 1060, H = 740;
    const tile = place(el("div"), { x: 96, y: 186, w: W, h: H });
    tile.style.cssText += ";overflow:hidden;background:#56624A";
    sec.append(tile);
    const { svg, proj } = districtSvg(tile, model, W, H, 70, { stroke: "rgba(244,241,234,.95)", upStroke: "rgba(244,241,234,.4)", width: 2 });
    const { canvas, cover } = cloudCanvas(820, 390, model.seed);
    canvas.style.cssText = `position:absolute;left:0;top:-20px;width:${1640}px;height:${780}px;transform:translateX(0);will-change:transform;` +
      `transition:transform ${REDUCED ? 0 : 26}s linear`;
    tile.append(canvas);
    const lab = place(el("div", "mono"), { x: 18, y: 16 });
    lab.style.cssText += ";font-size:14px;letter-spacing:.08em;color:#F4F1EA;background:rgba(27,27,27,.72);padding:6px 10px";
    lab.textContent = t("s1.tile", { district: model.district }).toUpperCase();
    tile.append(lab);
    const bar = d3.select(tile).append("svg").attr("width", 150).attr("height", 36).style("position", "absolute").style("left", "18px").style("top", `${H - 54}px`)
      .style("background", "rgba(27,27,27,.72)");
    scaleBar(bar, proj, 12, 24, "#F4F1EA");

    const right = place(el("div"), { x: 1250, y: 330, w: 574 });
    right.innerHTML = `
      <h1 class="scene-title">${t("scenes.s1.title")}</h1>
      <p class="lede">Aman rice is transplanted in the heart of the monsoon — exactly when optical satellites are blind.</p>
      <hr class="rule" style="margin:44px 0 22px">
      <div class="hero-num">${Math.round(cover * 100)}<small>%</small></div>
      <div class="hero-meta muted" style="font-size:18px">${t("s1.cloud")} (synthetic, seed ${model.seed})</div>`;
    sec.append(right);
    ctx.later(80, () => { canvas.style.transform = "translateX(-560px)"; });
    if (!REDUCED) {
      right.style.opacity = 0;
      right.style.transition = "opacity 900ms var(--ease)";
      ctx.later(900, () => { right.style.opacity = 1; });
    }
  },
};

const S2 = {
  key: "s2", theme: "radar", seconds: 20,
  build(sec, ctx) {
    const { model } = ctx;
    const u = model.featured;
    const px = model.featuredPixel;
    header(sec, "s2", { year: px.year });
    const W = 620, H = 560;
    const tile = place(el("div"), { x: 96, y: 300, w: W, h: H });
    tile.style.overflow = "hidden";
    sec.append(tile);
    // radar grain, masked to the district
    const proj = d3.geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], model.geo.upazilas);
    const mcv = document.createElement("canvas");
    mcv.width = W / 2;
    mcv.height = H / 2;
    const mctx = mcv.getContext("2d");
    const half = d3.geoMercator().fitExtent([[20, 20], [W / 2 - 20, H / 2 - 20]], model.geo.upazilas);
    d3.geoPath(half, mctx)(model.geo.district.features[0]);
    mctx.fill();
    const mask = mctx.getImageData(0, 0, W / 2, H / 2).data;
    const sp = speckleCanvas(W / 2, H / 2, model.seed, (i, j) => mask[(j * (W / 2) + i) * 4 + 3] > 128);
    sp.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;image-rendering:pixelated;opacity:0;transition:opacity ${REDUCED ? 0 : 2400}ms var(--ease)`;
    tile.append(sp);
    const { canvas } = cloudCanvas(410, 280, model.seed);
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;opacity:1;transition:opacity ${REDUCED ? 0 : 2600}ms var(--ease)`;
    tile.append(canvas);
    const svg = d3.select(tile).append("svg").attr("width", W).attr("height", H).style("position", "absolute").style("left", 0).style("top", 0);
    const path = d3.geoPath(proj);
    svg.append("g").selectAll("path").data(model.geo.upazilas.features).join("path").attr("d", path)
      .style("fill", "none").style("stroke", "rgba(216,227,224,.25)");
    svg.append("path").attr("d", path(model.geo.district.features[0])).style("fill", "none").style("stroke", C.radarFg).style("stroke-width", 1.5);
    // crosshair on the featured upazila
    const [cx, cy] = proj(labelPoint(u.feature));
    const ch = svg.append("g").attr("transform", `translate(${cx},${cy})`).style("opacity", 0);
    ch.append("circle").attr("r", 16).style("fill", "none").style("stroke", "#E9C46A").style("stroke-width", 2);
    ch.append("path").attr("d", "M-30,0 H-18 M18,0 H30 M0,-30 V-18 M0,18 V30").style("stroke", "#E9C46A").style("stroke-width", 2);
    const halo = (sel) => sel.style("paint-order", "stroke").style("stroke", C.radarBg).style("stroke-width", 6).style("stroke-linejoin", "round");
    halo(ch.append("text").attr("x", 38).attr("y", -8).attr("class", "anno-strong").style("fill", C.radarFg).text(t("s2.pixel")));
    halo(ch.append("text").attr("x", 38).attr("y", 16).attr("class", "anno-mono").style("fill", C.radarFg).text(u.name));
    const scale = d3.select(tile).append("svg").attr("width", 200).attr("height", 40).style("position", "absolute").style("left", 0).style("top", `${H - 40}px`);
    scaleBar(scale, proj, 24, 30, C.radarMuted);
    const cap = place(el("div", "mono"), { x: 96, y: 876 });
    cap.style.cssText += ";font-size:14px;color:var(--radar-muted);letter-spacing:.06em";
    cap.textContent = "SAR · C-BAND · VH · SEES THROUGH CLOUD";
    sec.append(cap);

    const chart = place(el("div"), { x: 790, y: 280, w: 1040, h: 640 });
    sec.append(chart);
    ctx.later(60, () => { canvas.style.opacity = 0; sp.style.opacity = 1; });
    ctx.later(REDUCED ? 0 : 1800, () => ch.transition().duration(REDUCED ? 0 : 600).style("opacity", 1));
    ctx.later(REDUCED ? 0 : 2400, () => vhChart(chart, {
      series: px.series, year: px.year, det: px.det, width: 1040, height: 640, mode: "story", dark: true, animate: true,
    }));
  },
};

const S3 = {
  key: "s3", theme: "paper", seconds: 20,
  build(sec, ctx) {
    const { model } = ctx;
    header(sec, "s3");
    const all = model.upazilas.flatMap((u) => u.seasons.map((s) => s.transplantDoy)).filter((d) => d !== null);
    const domain = [d3.min(all), d3.max(all)];
    const scale = transplantScale(domain);
    let year = 2017;
    const mapBox = place(el("div"), { x: 40, y: 250, w: 1020, h: 740 });
    sec.append(mapBox);
    const fill = (u) => {
      const s = seasonOf(u, year);
      return s.transplantDoy === null ? "#D8D3C6" : scale(s.transplantDoy);
    };
    const label = (u) => {
      const s = seasonOf(u, year);
      return [u.name, s.transplantDoy === null ? t("s3.notDetected") : fmtDate(year, s.transplantDoy)];
    };
    const map = drawMap(mapBox, { model, width: 1020, height: 740, pad: 30, fill, label, animate: !REDUCED, selected: null,
      onClick: (u) => ctx.select(u.name) });

    const right = place(el("div"), { x: 1150, y: 262, w: 674 });
    sec.append(right);
    right.innerHTML = `
      <div class="fig-label"><span>Season</span></div>
      <div class="slider" style="margin-top:6px"><span class="year">2017</span></div>
      <input class="range" type="range" min="2017" max="2025" step="1" value="2017" aria-label="Season">
      <div class="slider-ticks">${[2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => `<span>${String(y).slice(2)}</span>`).join("")}</div>
      <div class="revisit mono" style="font-size:16px;margin-top:22px;min-height:48px"></div>
      <table class="stat-table" style="margin-top:14px"><thead><tr><th>Upazila</th><th>Median date</th><th>IQR</th><th>Detected</th></tr></thead><tbody></tbody></table>
      <div class="legend" style="margin-top:28px"></div>`;
    const input = right.querySelector("input");
    const yearEl = right.querySelector(".year");
    const body = right.querySelector("tbody");
    const rev = right.querySelector(".revisit");
    rampLegend(right.querySelector(".legend"), { scale, domain, width: 360, left: `${fmtDate(2021, domain[0])} · ${t("s3.legendEarly")}`, right: `${t("s3.legendLate")} · ${fmtDate(2021, domain[1])}` });

    const render = (animate) => {
      yearEl.textContent = year;
      input.value = year;
      map.update({ fill, label }, animate);
      const s0 = model.upazilas[0].seasons.find((s) => s.year === year);
      rev.innerHTML = `${t("s3.revisit", { d: s0.revisit })}${s0.revisit > 6 ? `<br><span style="font-family:var(--font-ui);color:var(--brick)">${t("s3.revisitNote12")}</span>` : ""}`;
      body.innerHTML = [...model.upazilas].sort((a, b) => (seasonOf(a, year).transplantDoy ?? 999) - (seasonOf(b, year).transplantDoy ?? 999)).map((u) => {
        const s = seasonOf(u, year);
        const iqr = s.iqr ? `${fmtDate(year, s.iqr[0])} – ${fmtDate(year, s.iqr[1])}` : "—";
        return `<tr data-name="${esc(u.name)}"><td><span style="display:inline-block;width:12px;height:12px;margin-right:10px;background:${fill(u)}"></span>${esc(u.name)}</td>
          <td>${s.transplantDoy === null ? t("s3.notDetected") : fmtDate(year, s.transplantDoy)}</td><td class="dim">${iqr}</td>
          <td>${t("s3.detectedOf", { n: s.nDetected, total: PIXELS })}</td></tr>`;
      }).join("");
    };
    render(false);
    let auto = true;
    input.addEventListener("input", () => {
      auto = false;
      year = +input.value;
      render(true);
    });
    const tick = () => {
      if (!auto || year >= 2025) return;
      year += 1;
      render(true);
      ctx.later(1150, tick);
    };
    ctx.later(REDUCED ? 1500 : 3600, tick);
  },
};

const S4 = {
  key: "s4", theme: "paper", seconds: 25,
  build(sec, ctx) {
    const { model } = ctx;
    header(sec, "s4");
    let u = ctx.upazila();
    const heroBox = place(el("div"), { x: 96, y: 268, w: 1080 });
    sec.append(heroBox);
    const chartBox = place(el("div"), { x: 40, y: 480, w: 1140, h: 500 });
    sec.append(chartBox);
    const chart = onsetChart(chartBox, { model, u, width: 1140, height: 500, animate: true });
    const right = place(el("div"), { x: 1250, y: 268, w: 574 });
    sec.append(right);
    const tbl = trendTable(model, u.name, (v) => ctx.select(v.name));
    right.append(tbl.table);
    const leg = el("div", "", `<p style="font-size:16px;margin:16px 0 0;color:var(--muted)"><span class="dot fill" style="color:var(--brick)"></span>&nbsp; ${t("s4.bhLegend")}
      &nbsp;·&nbsp; <span class="dot"></span>&nbsp; ${t("s4.notSig")}</p>
      <div class="note" style="margin-top:34px">${t("s4.rule")}</div>`);
    right.append(leg);
    const renderHero = () => {
      heroBox.innerHTML = "";
      heroBox.append(heroBlock(u));
    };
    renderHero();
    if (!REDUCED) {
      heroBox.style.opacity = 0;
      heroBox.style.transition = "opacity 700ms var(--ease)";
      ctx.later(2400, () => { heroBox.style.opacity = 1; });
    }
    return {
      onSelect(name) {
        u = model.upazilas.find((v) => v.name === name);
        tbl.select(name);
        renderHero();
        chart.update(u, true);
      },
    };
  },
};

const S5 = {
  key: "s5", theme: "paper", seconds: 20,
  build(sec, ctx) {
    const { model } = ctx;
    header(sec, "s5");
    let u = ctx.upazila();
    const color = gapScale(GAP_BAND);
    const mapBox = place(el("div"), { x: 40, y: 250, w: 900, h: 740 });
    sec.append(mapBox);
    const map = drawMap(mapBox, {
      model, width: 900, height: 740, pad: 30, animate: !REDUCED, selected: u.name,
      fill: (v) => color(v.gapMedian),
      label: (v) => [v.name, v.gapMedian === null ? t("s5.nd") : `${fmtNum(v.gapMedian, 0)} d`],
      onClick: (v) => ctx.select(v.name),
    });
    const right = place(el("div"), { x: 1010, y: 262, w: 814 });
    sec.append(right);
    const count = (c) => model.upazilas.filter((v) => v.category === c).length;
    const sw = (col, lbl, rng, n) => `<div style="display:flex;align-items:center;gap:14px;font-size:18px">
      <span style="width:34px;height:18px;background:${col};border:1px solid rgba(27,27,27,.25)"></span><b style="font-weight:500;min-width:150px">${lbl}</b>
      <span class="mono muted" style="font-size:16px">${rng} · ${n} upazila${n === 1 ? "" : "s"}</span></div>`;
    right.innerHTML = `<div style="display:grid;gap:12px">
        ${sw(color(GAP_BAND[0] - 12), t("s5.early"), `&lt; ${GAP_BAND[0]} d`, count("early"))}
        ${sw(color((GAP_BAND[0] + GAP_BAND[1]) / 2), t("s5.ontrack"), `${GAP_BAND[0]}–${GAP_BAND[1]} d`, count("on track"))}
        ${sw(color(GAP_BAND[1] + 12), t("s5.late"), `&gt; ${GAP_BAND[1]} d`, count("late"))}</div>
      <p class="muted" style="font-size:16px;margin:14px 0 0">${t("s5.band", { a: GAP_BAND[0], b: GAP_BAND[1] })} Map shows the ${t("s5.median")} across seasons.</p>
      <div class="fig-label strip-head" style="margin-top:40px"></div>
      <div class="strip"></div>
      <div class="note" style="margin-top:18px"></div>`;
    const drawStrip = (animate) => {
      right.querySelector(".strip-head").innerHTML = `<b>${esc(u.name)}</b><span>gap per season, 2017–2025</span>`;
      const st = right.querySelector(".strip");
      st.innerHTML = "";
      gapStrip(st, { u, width: 814, height: 300, band: GAP_BAND, color, animate });
      right.querySelector(".note").innerHTML = `<b style="font-weight:500">${u.seasons.length} seasons — per-year gap shown, no trend claimed.</b>`;
    };
    drawStrip(true);
    return {
      onSelect(name) {
        u = model.upazilas.find((v) => v.name === name);
        map.select(name);
        drawStrip(true);
      },
    };
  },
};

const S6 = {
  key: "s6", theme: "paper", seconds: 20,
  build(sec, ctx) {
    const { model } = ctx;
    header(sec, "s6");
    const u = model.featured;
    const px = model.featuredPixel;
    const season = seasonOf(u, px.year);
    const pIdx = season.pixels.findIndex((p) => p.series === px.series);
    const left = place(el("div"), { x: 96, y: 262, w: 1150 });
    sec.append(left);
    left.innerHTML = `<div class="tabs"><button type="button" data-tab="s1" class="on">${t("s6.tabS1", { year: px.year })}</button>
      <button type="button" data-tab="nisar">${t("s6.tabNisar")}<span class="prov">${t("s6.provisional")}</span></button></div>
      <div class="info mono muted" style="font-size:15px;margin-top:14px;min-height:22px"></div><div class="chart" style="margin-top:6px"></div>`;
    const right = place(el("div"), { x: 1330, y: 262, w: 494 });
    right.innerHTML = `<div class="fig-label"><b>${t("s6.testsHead")}</b></div>`;
    right.append(messyPanel(model, 494, true));
    sec.append(right);
    const chart = left.querySelector(".chart");
    const info = left.querySelector(".info");
    const show = (tab) => {
      left.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
      ctx.setNisar(tab === "nisar");
      chart.innerHTML = "";
      if (tab === "s1") {
        info.textContent = pixelInfo(u, season, px, pIdx);
        vhChart(chart, { series: px.series, year: px.year, det: px.det, width: 1150, height: 600, mode: "diagnostic", animate: true });
      } else {
        const n = model.nisar;
        const [g0, g1] = n.gap;
        info.innerHTML = `<span style="color:var(--brick)">${t("nisarBadge")}</span> · ${t("s6.nisarNote")} · ${n.det.nValid} of ${n.det.nObs} acquisitions`;
        vhChart(chart, {
          series: n.series, year: n.year, det: n.det, width: 1150, height: 600, mode: "diagnostic", animate: true,
          yDomain: [-31, -14], unit: "L-band HV, dB", today: n.today, noData: n.gap,
          noDataLabel: t("s6.noData", { from: fmtDate(n.year, g0), to: fmtDate(n.year, g1) }),
        });
      }
    };
    left.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
    show("s1");
    ctx.later(12500, () => show("nisar"));
  },
};

const S7 = {
  key: "s7", theme: "paper", seconds: 15,
  build(sec, ctx) {
    const { model } = ctx;
    const u = model.featured;
    header(sec, "s7", { upazila: u.name });
    const a = adviceFor(u);
    const left = place(el("div"), { x: 96, y: 300, w: 540 });
    left.innerHTML = `<p class="lede" style="margin-top:0;color:var(--ink)">Built from the onset trend and the adaptation gap for <b style="font-weight:500">${esc(u.name)}</b>.</p>
      <hr class="rule" style="margin:34px 0 22px">
      <div class="fig-label"><span>${t("s7.confLabel")}</span></div>
      <div style="font:400 44px/1.1 var(--font-display);margin-top:10px">${t(`s7.conf.${a.conf.level}`)}</div>
      <p style="font-size:18px;line-height:1.5;margin:12px 0 0">${t(`s7.confWhy.${a.conf.level}`, { n: a.conf.n, total: a.conf.total })}</p>`;
    sec.append(left);
    const phone = place(phoneMock(u), { x: 700, y: 176 });
    sec.append(phone);
    const right = place(el("div"), { x: 1190, y: 300, w: 634 });
    const en = smsBox({ text: a.smsEn, typed: true, later: ctx.later });
    const bn = smsBox({ text: a.smsBn, bn: true, typed: true, later: ctx.later });
    bn.style.marginTop = "44px";
    right.append(en, bn);
    sec.append(right);
    if (!REDUCED) {
      phone.style.opacity = 0;
      phone.style.transform = "translateY(16px)";
      phone.style.transition = "opacity 800ms var(--ease), transform 800ms var(--ease)";
      ctx.later(200, () => { phone.style.opacity = 1; phone.style.transform = "none"; });
      ctx.later(1600, () => en.start());
      ctx.later(6200, () => bn.start());
    }
  },
};

const S8 = {
  key: "s8", theme: "paper", seconds: 15,
  build(sec, ctx) {
    const { model } = ctx;
    const u = ctx.upazila();
    header(sec, "s8");
    const hero = place(heroBlock(u), { x: 96, y: 290, w: 980 });
    sec.append(hero);
    const chartBox = place(el("div"), { x: 40, y: 520, w: 1060, h: 440 });
    sec.append(chartBox);
    onsetChart(chartBox, { model, u, width: 1060, height: 440, animate: false });
    const dr = evidenceDrawer(model, u);
    sec.append(dr);
    ctx.later(REDUCED ? 0 : 900, () => dr.classList.add("open"));
    const closing = el("div", "closing");
    closing.innerHTML = `<div class="t">Ropon Radar<span class="bn">${tb("word")}</span></div>
      <div class="s">${t("s8.closing")}</div>
      <div class="m">${t("s8.closingMeta", { seed: model.seed })}</div>`;
    sec.append(closing);
    ctx.later(9800, () => closing.classList.add("on"));
  },
};

export const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

/* ───────────── engine ───────────── */

function startScenes(model) {
  document.body.className = REDUCED ? "mode-scene still" : "mode-scene";
  const vp = el("div");
  vp.id = "viewport";
  const stage = el("div", "paper-grid");
  stage.id = "stage";
  stage.innerHTML = `
    <header class="runhead"><span class="wordmark">Ropon Radar</span><span class="bn">${tb("word")}</span><span class="sep"></span>
      <span>${t("place", { district: model.district })}</span></header>
    <div class="badge" role="note">${t("badge")}<span class="prov">${t("nisarBadge")}</span></div>
    <main id="scene-host"></main>
    <p id="caption" aria-live="polite"></p>
    <nav class="chrome scene-nav" aria-label="Scenes">
      <button type="button" class="step" data-step="-1" aria-label="Previous scene">&larr; Back</button>
      <span class="tabs-n">${SCENES.map((s, i) => `<button type="button" data-go="${i}" title="${esc(t(`scenes.${s.key}.title`))}">${String(i + 1).padStart(2, "0")}</button>`).join("")}</span>
      <button type="button" class="step next" data-step="1" aria-label="Next scene">Next &rarr;</button>
    </nav>
    <div class="chrome counter"><span class="n"></span><span>${t("keys")}</span></div>
    <div class="chrome progress"><i></i></div>`;
  vp.append(stage);
  document.body.append(vp);
  const host = stage.querySelector("#scene-host");
  const cap = stage.querySelector("#caption");
  const badge = stage.querySelector(".badge");
  const counter = stage.querySelector(".counter .n");
  const bar = stage.querySelector(".progress i");

  const fit = () => {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transformOrigin = "center";
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  fit();
  window.addEventListener("resize", fit);

  let idx = Math.max(0, Math.min(SCENES.length - 1, (parseInt(location.hash.replace("#s", ""), 10) || 1) - 1));
  let timers = [];
  let current = null;
  let hooks = {};
  let selected = model.featured.name;

  const ctx = {
    model,
    later: (ms, fn) => timers.push(setTimeout(fn, ms)),
    upazila: () => model.upazilas.find((u) => u.name === selected),
    select: (name) => {
      selected = name;
      hooks.onSelect && hooks.onSelect(name);
    },
    setNisar: (on) => badge.classList.toggle("nisar", on),
  };

  function go(i) {
    idx = (i + SCENES.length) % SCENES.length;
    timers.forEach(clearTimeout);
    timers = [];
    hooks = {};
    ctx.setNisar(false);
    const old = current;
    if (old) {
      old.classList.remove("on");
      old.querySelectorAll("*").forEach((n) => d3.select(n).interrupt());
      setTimeout(() => old.remove(), REDUCED ? 0 : 650);
    }
    const sc = SCENES[idx];
    const sec = el("section", "scene");
    sec.dataset.scene = sc.key;
    host.append(sec);
    stage.classList.toggle("theme-radar", sc.theme === "radar");
    stage.classList.toggle("paper-grid", sc.theme !== "radar");
    hooks = sc.build(sec, ctx) || {};
    current = sec;
    setTimeout(() => sec.classList.add("on"), 30);
    cap.innerHTML = `<span class="n">${String(idx + 1).padStart(2, "0")}</span>${t(`scenes.${sc.key}.caption`)}`;
    counter.textContent = `${idx + 1} / ${SCENES.length} · ${sc.seconds} s`;
    stage.querySelectorAll(".scene-nav [data-go]").forEach((b) => b.classList.toggle("on", +b.dataset.go === idx));
    stage.querySelector(".scene-nav [data-step='-1']").disabled = idx === 0;
    stage.querySelector(".scene-nav [data-step='1']").disabled = idx === SCENES.length - 1;
    bar.style.transition = "none";
    bar.style.width = "0";
    setTimeout(() => {
      bar.style.transition = `width ${sc.seconds}s linear`;
      bar.style.width = "100%";
    }, 30);
    history.replaceState(null, "", `#s${idx + 1}`);
  }

  stage.querySelector(".scene-nav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.go) go(+b.dataset.go);
    else go(Math.max(0, Math.min(SCENES.length - 1, idx + +b.dataset.step)));
    b.blur(); // keep arrow keys working after a click
  });
  window.focus();
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, [contenteditable=true]") && !["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " ") { e.preventDefault(); if (idx < SCENES.length - 1) go(idx + 1); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); if (idx > 0) go(idx - 1); }
    else if (k === "c" || k === "C") document.body.classList.toggle("no-captions");
    else if (k === "h" || k === "H") document.body.classList.toggle("no-chrome");
    else if (k === "r" || k === "R") go(idx);
    else if (k === "e" || k === "E") location.href = "?mode=explore";
    else if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const names = model.upazilas.map((u) => u.name);
      const j = names.indexOf(selected) + (k === "ArrowDown" ? 1 : -1);
      ctx.select(names[(j + names.length) % names.length]);
    }
  });
  go(idx);
}

export async function boot() {
  // Load every self-hosted face before the first scene, so nothing reflows on camera.
  const faces = ["400 20px Fraunces", "600 20px Fraunces", "italic 400 20px Fraunces", "400 20px 'IBM Plex Sans'", "500 20px 'IBM Plex Sans'",
    "600 20px 'IBM Plex Sans'", "400 20px 'IBM Plex Mono'", "500 20px 'IBM Plex Mono'"];
  const fonts = Promise.all([...faces.map((f) => document.fonts.load(f)),
    document.fonts.load("400 20px 'Noto Sans Bengali'", "রোপণ"), document.fonts.load("600 20px 'Noto Sans Bengali'", "রোপণ")]);
  const [geo] = await Promise.all([loadGeo("."), loadI18n("."), fonts]);
  const model = generate(geo);
  window.__ropon = model; // for inspection in the console
  const params = new URLSearchParams(location.search);
  if (params.get("mode") === "explore") {
    startExplore(model);
  } else {
    startScenes(model);
  }
}

/* ───────────── explore mode ───────────── */
export function startExplore(model) {
  document.body.className = "mode-explore paper-grid";
  const state = { u: model.featured, year: 2025, vhYear: model.featuredPixel.year, pixel: 0, tab: "s1" };
  const fp = seasonOf(model.featured, model.featuredPixel.year);
  state.pixel = fp.pixels.findIndex((p) => p.series === model.featuredPixel.series);
  const page = el("div", "explore");
  page.innerHTML = `
    <div class="explore-head">
      <div class="runhead" style="position:static"><span class="wordmark">Ropon Radar</span><span class="bn">${tb("word")}</span><span class="sep"></span>
        <span>${t("place", { district: model.district })} · explore</span></div>
      <div class="links"><a href="./">Scene mode (video)</a><a href="lowband.html">Text-only view</a><a href="tests/stats.test.html">Tests</a>
        <button class="btn-line" type="button" data-evidence>Evidence</button></div>
    </div>
    <div class="picker"><span class="fig-label" style="margin-right:10px"><span>Upazila</span></span></div>
    <div class="badge badge-float" role="note">${t("badge")}<span class="prov">${t("nisarBadge")}</span></div>`;
  document.body.append(page);
  const picker = page.querySelector(".picker");
  const badge = page.querySelector(".badge");
  model.upazilas.forEach((u) => {
    const b = el("button", "btn-line", esc(u.name));
    b.type = "button";
    b.dataset.name = u.name;
    b.addEventListener("click", () => pick(u.name));
    picker.append(b);
  });
  const section = (key, vars, lede) => {
    const sec = el("section", "fig");
    sec.innerHTML = `<div class="fig-label"><span>${t(`scenes.${key}.fig`, vars)}</span></div><h2>${t(`scenes.${key}.title`)}</h2>${lede ? `<p class="lede">${lede}</p>` : ""}`;
    page.append(sec);
    return sec;
  };
  const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

  // Fig 2 — radar curve (the one dark panel)
  const s2 = section("s2", { year: model.featuredPixel.year }, t("scenes.s2.caption"));
  const radar = el("div", "radar-panel");
  s2.append(radar);
  vhChart(radar, { series: model.featuredPixel.series, year: model.featuredPixel.year, det: model.featuredPixel.det,
    width: 1360, height: 480, mode: "story", dark: true, animate: false });

  // Fig 3 — transplant map + season slider
  const s3 = section("s3", {}, t("scenes.s3.caption"));
  const g3 = el("div", "grid2");
  s3.append(g3);
  const all = model.upazilas.flatMap((u) => u.seasons.map((x) => x.transplantDoy)).filter((d) => d !== null);
  const dom3 = [d3.min(all), d3.max(all)];
  const sc3 = transplantScale(dom3);
  const m3box = el("div");
  const r3 = el("div");
  g3.append(m3box, r3);
  const fill3 = (u) => {
    const x = seasonOf(u, state.year);
    return x.transplantDoy === null ? "#D8D3C6" : sc3(x.transplantDoy);
  };
  const label3 = (u) => {
    const x = seasonOf(u, state.year);
    return [u.name, x.transplantDoy === null ? t("s3.notDetected") : fmtDate(state.year, x.transplantDoy)];
  };
  const map3 = drawMap(m3box, { model, width: 780, height: 640, pad: 20, fill: fill3, label: label3, selected: state.u.name, onClick: (u) => pick(u.name) });
  r3.innerHTML = `<div class="fig-label"><span>Season</span></div><div class="slider"><span class="year"></span></div>
    <input class="range" type="range" min="2017" max="2025" step="1" aria-label="Season">
    <div class="slider-ticks">${YEARS.map((y) => `<span>${String(y).slice(2)}</span>`).join("")}</div>
    <div class="revisit mono" style="font-size:15px;margin-top:18px;min-height:44px"></div>
    <table class="stat-table" style="margin-top:10px"><thead><tr><th>Upazila</th><th>Median date</th><th>IQR</th><th>Detected</th></tr></thead><tbody></tbody></table>
    <div class="legend" style="margin-top:22px"></div>`;
  rampLegend(r3.querySelector(".legend"), { scale: sc3, domain: dom3, width: 360,
    left: `${fmtDate(2021, dom3[0])} · ${t("s3.legendEarly")}`, right: `${t("s3.legendLate")} · ${fmtDate(2021, dom3[1])}` });
  const in3 = r3.querySelector("input");
  const render3 = (anim) => {
    r3.querySelector(".year").textContent = state.year;
    in3.value = state.year;
    map3.update({ fill: fill3, label: label3 }, anim);
    const rv = model.upazilas[0].seasons.find((x) => x.year === state.year).revisit;
    r3.querySelector(".revisit").innerHTML = `${t("s3.revisit", { d: rv })}${rv > 6 ? `<br><span style="font-family:var(--font-ui);color:var(--brick)">${t("s3.revisitNote12")}</span>` : ""}`;
    r3.querySelector("tbody").innerHTML = model.upazilas.map((u) => {
      const x = seasonOf(u, state.year);
      const iqr = x.iqr ? `${fmtDate(state.year, x.iqr[0])} – ${fmtDate(state.year, x.iqr[1])}` : "—";
      return `<tr data-name="${esc(u.name)}" class="${u.name === state.u.name ? "sel" : ""}"><td>${esc(u.name)}</td>
        <td>${x.transplantDoy === null ? t("s3.notDetected") : fmtDate(state.year, x.transplantDoy)}</td>
        <td class="dim">${iqr}</td><td>${t("s3.detectedOf", { n: x.nDetected, total: PIXELS })}</td></tr>`;
    }).join("");
    r3.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => pick(tr.dataset.name)));
  };
  in3.addEventListener("input", () => {
    state.year = +in3.value;
    render3(true);
  });

  // Fig 4 — onset trend
  const s4 = section("s4", {}, t("scenes.s4.caption"));
  const g4 = el("div", "grid2");
  s4.append(g4);
  const l4 = el("div");
  const r4 = el("div");
  g4.append(l4, r4);
  const hero4 = el("div");
  const c4 = el("div");
  c4.style.marginTop = "24px";
  l4.append(hero4, c4);
  const chart4 = onsetChart(c4, { model, u: state.u, width: 800, height: 440, animate: false });
  const tbl4 = trendTable(model, state.u.name, (u) => pick(u.name));
  r4.append(tbl4.table, el("div", "", `<p style="font-size:15px;margin:14px 0 0;color:var(--muted)"><span class="dot fill" style="color:var(--brick)"></span>&nbsp; ${t("s4.bhLegend")} · <span class="dot"></span>&nbsp; ${t("s4.notSig")}</p>
    <div class="note" style="margin-top:26px">${t("s4.rule")}</div>`));

  // Fig 5 — adaptation gap
  const s5 = section("s5", {}, t("scenes.s5.caption"));
  const g5 = el("div", "grid2");
  s5.append(g5);
  const color5 = gapScale(GAP_BAND);
  const m5box = el("div");
  const r5 = el("div");
  g5.append(m5box, r5);
  const map5 = drawMap(m5box, { model, width: 780, height: 640, pad: 20, selected: state.u.name, fill: (v) => color5(v.gapMedian),
    label: (v) => [v.name, v.gapMedian === null ? t("s5.nd") : `${fmtNum(v.gapMedian, 0)} d`], onClick: (v) => pick(v.name) });
  r5.innerHTML = `<p style="font-size:16px;margin:0" class="muted">${t("s5.band", { a: GAP_BAND[0], b: GAP_BAND[1] })} Map shows the ${t("s5.median")} across seasons.</p>
    <div class="fig-label strip-head" style="margin-top:28px"></div><div class="strip"></div><div class="note" style="margin-top:14px"></div>`;

  // Fig 6 — pixel inspector
  const s6 = section("s6", {}, t("scenes.s6.caption"));
  const ctl = el("div", "inspector-controls");
  ctl.innerHTML = `<div class="tabs" style="border:0"><button type="button" data-tab="s1" class="on">Sentinel-1 C-band</button>
      <button type="button" data-tab="nisar">${t("s6.tabNisar")}<span class="prov">${t("s6.provisional")}</span></button></div>
    <label class="mono">season <select class="yr">${YEARS.map((y) => `<option>${y}</option>`).join("")}</select></label>
    <span class="mono stepper">pixel <button class="btn-line prev" type="button" aria-label="Previous pixel">&lsaquo;</button><b class="pn"></b><button class="btn-line next" type="button" aria-label="Next pixel">&rsaquo;</button></span>`;
  s6.append(ctl);
  const info6 = el("div", "mono muted");
  info6.style.cssText = "font-size:15px;margin-top:14px";
  const c6 = el("div");
  const messyHead = el("div", "fig-label", `<b>${t("s6.testsHead")}</b>`);
  messyHead.style.marginTop = "36px";
  const messy6 = el("div", "messy-grid");
  s6.append(info6, c6, messyHead, messy6);
  const mp = messyPanel(model, 430, false);
  [...mp.children].forEach((ch) => {
    ch.style.marginTop = "0";
    messy6.append(ch);
  });
  const render6 = () => {
    ctl.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
    badge.classList.toggle("nisar", state.tab === "nisar");
    const yr = ctl.querySelector(".yr");
    yr.value = state.vhYear;
    yr.disabled = state.tab === "nisar";
    ctl.querySelectorAll(".prev,.next").forEach((b) => { b.disabled = state.tab === "nisar"; });
    c6.innerHTML = "";
    if (state.tab === "s1") {
      const season = seasonOf(state.u, state.vhYear);
      const p = season.pixels[state.pixel];
      ctl.querySelector(".pn").textContent = `${state.pixel + 1}/${PIXELS}`;
      info6.textContent = pixelInfo(state.u, season, p, state.pixel);
      vhChart(c6, { series: p.series, year: state.vhYear, det: p.det, width: 1390, height: 520, mode: "diagnostic", animate: false });
    } else {
      const n = model.nisar;
      info6.innerHTML = `<span style="color:var(--brick)">${t("nisarBadge")}</span> · ${t("s6.nisarNote")}`;
      vhChart(c6, { series: n.series, year: n.year, det: n.det, width: 1390, height: 520, mode: "diagnostic", animate: false,
        yDomain: [-31, -14], unit: "L-band HV, dB", today: n.today, noData: n.gap,
        noDataLabel: t("s6.noData", { from: fmtDate(n.year, n.gap[0]), to: fmtDate(n.year, n.gap[1]) }) });
    }
  };
  ctl.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    render6();
  }));
  ctl.querySelector(".yr").addEventListener("change", (e) => {
    state.vhYear = +e.target.value;
    render6();
  });
  ctl.querySelector(".prev").addEventListener("click", () => {
    state.pixel = (state.pixel + PIXELS - 1) % PIXELS;
    render6();
  });
  ctl.querySelector(".next").addEventListener("click", () => {
    state.pixel = (state.pixel + 1) % PIXELS;
    render6();
  });

  // Fig 7 — advice, with editable SMS
  const s7 = section("s7", { upazila: "the selected upazila" }, t("scenes.s7.caption"));
  const g7 = el("div", "advice-grid");
  s7.append(g7);

  const render = () => {
    picker.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.name === state.u.name));
    render3(false);
    map3.select(state.u.name);
    hero4.innerHTML = "";
    hero4.append(heroBlock(state.u));
    chart4.update(state.u, true);
    tbl4.select(state.u.name);
    map5.select(state.u.name);
    r5.querySelector(".strip-head").innerHTML = `<b>${esc(state.u.name)}</b><span>gap per season, 2017–2025</span>`;
    const st = r5.querySelector(".strip");
    st.innerHTML = "";
    gapStrip(st, { u: state.u, width: 560, height: 280, band: GAP_BAND, color: color5, animate: false });
    r5.querySelector(".note").innerHTML = `<b style="font-weight:500">${state.u.seasons.length} seasons — per-year gap shown, no trend claimed.</b>`;
    render6();
    const a = adviceFor(state.u);
    g7.innerHTML = "";
    const right = el("div");
    right.innerHTML = `<div class="fig-label"><span>${t("s7.confLabel")}</span></div>
      <div style="font:400 40px/1.1 var(--font-display);margin-top:8px">${t(`s7.conf.${a.conf.level}`)}</div>
      <p style="font-size:17px;margin:10px 0 30px;max-width:40em">${t(`s7.confWhy.${a.conf.level}`, { n: a.conf.n, total: a.conf.total })}</p>`;
    right.append(smsBox({ text: a.smsEn, editable: true }));
    const bn = smsBox({ text: a.smsBn, bn: true, editable: true });
    bn.style.marginTop = "36px";
    const hint = el("p", "muted", "Both SMS boxes are editable; the counter follows GSM-7 / UCS-2 rules.");
    hint.style.fontSize = "15px";
    right.append(bn, hint);
    g7.append(phoneMock(state.u), right);
  };
  function pick(name) {
    state.u = model.upazilas.find((u) => u.name === name);
    render();
  }

  // Evidence drawer
  let drawer = null;
  page.querySelector("[data-evidence]").addEventListener("click", () => {
    if (drawer) drawer.remove();
    drawer = evidenceDrawer(model, state.u);
    document.body.append(drawer);
    drawer.querySelector(".close").addEventListener("click", () => drawer.classList.remove("open"));
    setTimeout(() => drawer.classList.add("open"), 30);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer) drawer.classList.remove("open");
  });
  render();
}
