// Strings (English + Bangla), number and date formatting, SMS length.
import { dateOf } from "./detect.js";

let EN = null;
let BN = null;

export async function loadI18n(root = ".") {
  [EN, BN] = await Promise.all([
    fetch(`${root}/i18n/en.json`, { cache: "no-cache" }).then((r) => r.json()),
    fetch(`${root}/i18n/bn.json`, { cache: "no-cache" }).then((r) => r.json()),
  ]);
  return { en: EN, bn: BN };
}

const get = (obj, key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

/** English string by dotted key, with {placeholders}. */
export const t = (key, vars) => fill(get(EN, key) ?? key, vars);
/** Bangla string by dotted key. */
export const tb = (key, vars) => fill(get(BN, key) ?? key, vars);
export const raw = (key) => get(EN, key);

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Western → Bengali digits (keeps signs and decimal point). */
export const bnDigits = (s) => String(s).replace(/[0-9]/g, (d) => BN_DIGITS[d]);

export const upzBn = (name) => get(BN, `upazilas.${name}`) ?? name;

/** "14 Jul" for a DOY. */
export function fmtDate(year, doy) {
  if (doy === null || doy === undefined) return "—";
  const { month, day } = dateOf(year, Math.round(doy));
  return `${day} ${EN.months[month - 1]}`;
}
export function fmtDateBn(year, doy) {
  const { month, day } = dateOf(year, Math.round(doy));
  return `${bnDigits(day)} ${BN.months[month - 1]}`;
}

/** Fixed decimals with a real minus sign; `plus` adds "+" to positives. */
export function fmtNum(v, digits = 1, { plus = false } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  const zero = Number(s) === 0;
  return (v < 0 && !zero ? "−" : plus && !zero ? "+" : "") + s;
}
export function fmtP(p) {
  if (p < 0.001) return "< 0.001";
  return "= " + p.toFixed(3);
}

// GSM 03.38 basic set and extension table (extension characters cost 2 septets).
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€\f";

/** SMS encoding and length: GSM-7 (160 / 153 per part) or UCS-2 (70 / 67 per part). */
export function smsInfo(text) {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) septets += 1;
    else if (GSM_EXT.includes(ch)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "GSM-7", units: septets, limit: 160, segments, capacity: segments === 1 ? 160 : segments * 153 };
  }
  const units = text.length; // UTF-16 code units
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "UCS-2", units, limit: 70, segments, capacity: segments === 1 ? 70 : segments * 67 };
}
