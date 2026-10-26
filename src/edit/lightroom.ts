/**
 * Edit foto ↔ Lightroom: our settings (`PhotoAdjust`) as Camera Raw settings
 * (`crs:` in an XMP sidecar or preset), and back. The names are Adobe's
 * (Process Version 2012 and later, as Lightroom Classic and Camera Raw
 * write them; LightCraft's reader was a reference for which ones matter).
 *
 * The sliders line up name for name, but the engines differ: Lightroom will
 * show the same numbers, the colors can come out a little different.
 *
 * Not carried: a RAW's white balance in Kelvin (ours is relative, Lightroom
 * starts from the camera's own), Matte (no Lightroom slider), and anything
 * pointing at Adobe's own files — profiles, masks, lens profiles.
 */

import { COLOR_BANDS, type ColorBand, type CurvePoint, type GradeWheel, type PhotoAdjust, type ToneCurve } from '../kreasi/engine/document';

/** Attributes and ordered lists, as Rust writes them (`export::Develop`). */
export interface Develop {
  attrs: [string, string][];
  seqs: [string, string[]][];
}

const BAND_NAME: Record<ColorBand, string> = {
  merah: 'Red',
  oranye: 'Orange',
  kuning: 'Yellow',
  hijau: 'Green',
  aqua: 'Aqua',
  biru: 'Blue',
  ungu: 'Purple',
  magenta: 'Magenta',
};
const CURVE_NAME: Record<keyof ToneCurve, string> = {
  rgb: 'ToneCurvePV2012',
  r: 'ToneCurvePV2012Red',
  g: 'ToneCurvePV2012Green',
  b: 'ToneCurvePV2012Blue',
};
/** Same meaning, same range (−100…100 or 0…100), our name → Adobe's. */
const SAME: [keyof PhotoAdjust, string][] = [
  ['contrast', 'Contrast2012'],
  ['highlights', 'Highlights2012'],
  ['shadows', 'Shadows2012'],
  ['whites', 'Whites2012'],
  ['blacks', 'Blacks2012'],
  ['texture', 'Texture'],
  ['clarity', 'Clarity2012'],
  ['dehaze', 'Dehaze'],
  ['vibrance', 'Vibrance'],
  ['saturation', 'Saturation'],
  ['sharpen', 'Sharpness'],
  ['sharpenDetail', 'SharpenDetail'],
  ['sharpenMasking', 'SharpenEdgeMasking'],
  ['noise', 'LuminanceSmoothing'],
  ['noiseDetail', 'LuminanceNoiseReductionDetail'],
  ['noiseContrast', 'LuminanceNoiseReductionContrast'],
  ['colorNoise', 'ColorNoiseReduction'],
  ['colorNoiseDetail', 'ColorNoiseReductionDetail'],
  ['colorNoiseSmooth', 'ColorNoiseReductionSmoothness'],
  ['grain', 'GrainAmount'],
  ['grainSize', 'GrainSize'],
  ['grainRough', 'GrainFrequency'],
];
const WHEELS: { key: 'shadows' | 'midtones' | 'highlights' | 'global'; hue: string; sat: string; lum: string }[] = [
  { key: 'shadows', hue: 'SplitToningShadowHue', sat: 'SplitToningShadowSaturation', lum: 'ColorGradeShadowLum' },
  { key: 'midtones', hue: 'ColorGradeMidtoneHue', sat: 'ColorGradeMidtoneSat', lum: 'ColorGradeMidtoneLum' },
  { key: 'highlights', hue: 'SplitToningHighlightHue', sat: 'SplitToningHighlightSaturation', lum: 'ColorGradeHighlightLum' },
  { key: 'global', hue: 'ColorGradeGlobalHue', sat: 'ColorGradeGlobalSat', lum: 'ColorGradeGlobalLum' },
];

const signed = (v: number, digits = 0) => (v > 0 ? '+' : '') + v.toFixed(digits);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Our Exposure multiplies the picture by 1 + v/100; Lightroom's is in stops. */
const toStops = (v: number) => Math.log2(Math.max(0.01, 1 + v / 100));
const fromStops = (ev: number) => Math.round(clamp((2 ** ev - 1) * 100, -100, 100));

/** Our sharpening radius 0–100 (30 by default) ↔ Lightroom's 0.5–3.0 px (1.0 by default). */
const toRadius = (r: number) => (r <= 30 ? 0.5 + (r / 30) * 0.5 : 1 + ((r - 30) / 70) * 2);
const fromRadius = (px: number) => Math.round(px <= 1 ? ((px - 0.5) / 0.5) * 30 : 30 + ((px - 1) / 2) * 70);

// ── To Lightroom ──

/** `a` as Camera Raw settings. `raw`: the photo is a RAW (its white balance can't be carried). */
export function toCrs(a: PhotoAdjust, raw: boolean): Develop {
  const attrs: [string, string][] = [
    ['Version', '15.0'],
    ['ProcessVersion', '11.0'],
    ['HasSettings', 'True'],
    ['ConvertToGrayscale', a.mono ? 'True' : 'False'],
  ];
  const put = (name: string, v: number | undefined, digits = 0) => {
    if (v != null && Number.isFinite(v)) attrs.push([name, signed(v, digits)]);
  };
  put('Exposure2012', toStops(a.brightness ?? 0), 2);
  for (const [ours, theirs] of SAME) put(theirs, a[ours] as number | undefined);
  if (!raw) {
    put('IncrementalTemperature', a.warmth);
    put('IncrementalTint', a.tint);
  }
  if (a.sharpenRadius != null) attrs.push(['SharpenRadius', toRadius(a.sharpenRadius).toFixed(1)]);
  for (const b of COLOR_BANDS) {
    const s = a.hsl?.[b.id];
    if (!s) continue;
    put(`HueAdjustment${BAND_NAME[b.id]}`, s.h);
    put(`SaturationAdjustment${BAND_NAME[b.id]}`, s.s);
    put(`LuminanceAdjustment${BAND_NAME[b.id]}`, s.l);
  }
  if (a.vignette?.amount) {
    put('PostCropVignetteAmount', a.vignette.amount);
    put('PostCropVignetteMidpoint', a.vignette.midpoint ?? 50);
    put('PostCropVignetteRoundness', a.vignette.roundness ?? 0);
    put('PostCropVignetteFeather', a.vignette.feather ?? 50);
    attrs.push(['PostCropVignetteStyle', '1']);
  }
  for (const w of WHEELS) {
    const g = a.grade?.[w.key];
    if (!g) continue;
    attrs.push([w.hue, String(Math.round(g.hue))], [w.sat, String(Math.round(g.sat))]);
    put(w.lum, g.lum);
  }
  if (a.grade) {
    put('ColorGradeBlending', a.grade.blending ?? 50);
    put('SplitToningBalance', a.grade.balance ?? 0);
  }
  const seqs: [string, string[]][] = [];
  for (const k of Object.keys(CURVE_NAME) as (keyof ToneCurve)[]) {
    const pts = a.curve?.[k];
    if (pts?.length) seqs.push([CURVE_NAME[k], pts.map(([x, y]) => `${Math.round(x * 255)}, ${Math.round(y * 255)}`)]);
  }
  if (seqs.length) attrs.push(['ToneCurveName2012', 'Custom']);
  return { attrs, seqs };
}

// ── From Lightroom ──

export interface ImportedPreset {
  name: string;
  /** Lightroom's preset group, when the file says. */
  group: string | null;
  adjust: PhotoAdjust;
  /** It uses things that don't come across (masks, profiles, Kelvin white balance…). */
  partial: string[];
}

const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** A Lightroom Classic / Camera Raw preset or sidecar (.xmp) as our settings; null if it holds none. */
export function fromXmp(text: string, fallbackName: string): ImportedPreset | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const desc = [...doc.getElementsByTagNameNS(RDF, 'Description')].find(
    (d) => [...d.attributes].some((x) => x.namespaceURI === CRS) || d.getElementsByTagNameNS(CRS, '*').length,
  );
  if (!desc) return null;

  // Values come as attributes, or as child elements in some files.
  const v = new Map<string, string>();
  for (const x of [...desc.attributes]) if (x.namespaceURI === CRS) v.set(x.localName, x.value);
  const lists = new Map<string, string[]>();
  for (const el of [...desc.children]) {
    if (el.namespaceURI !== CRS) continue;
    const items = [...el.getElementsByTagNameNS(RDF, 'li')].map((li) => li.textContent?.trim() ?? '');
    if (el.getElementsByTagNameNS(RDF, 'Seq').length || el.getElementsByTagNameNS(RDF, 'Bag').length) lists.set(el.localName, items);
    else if (el.getElementsByTagNameNS(RDF, 'Alt').length) v.set(el.localName, items[0] ?? '');
    else if (!el.children.length) v.set(el.localName, el.textContent?.trim() ?? '');
    else lists.set(el.localName, items);
  }
  const num = (name: string): number | undefined => {
    const s = v.get(name);
    if (s == null || s === '') return undefined;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  };

  const a: PhotoAdjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, mono: v.get('ConvertToGrayscale') === 'True' };
  const set = <K extends keyof PhotoAdjust>(k: K, val: PhotoAdjust[K] | undefined) => {
    if (val != null) a[k] = val;
  };
  const r = (n: number | undefined, lo = -100, hi = 100) => (n == null ? undefined : Math.round(clamp(n, lo, hi)));
  const ev = num('Exposure2012');
  if (ev != null) a.brightness = fromStops(ev);
  for (const [ours, theirs] of SAME) set(ours, r(num(theirs), ours === 'sharpen' ? 0 : -100, 100) as never);
  set('warmth', r(num('IncrementalTemperature')));
  set('tint', r(num('IncrementalTint')));
  const radius = num('SharpenRadius');
  if (radius != null) a.sharpenRadius = clamp(fromRadius(radius), 0, 100);

  const hsl: NonNullable<PhotoAdjust['hsl']> = {};
  for (const b of COLOR_BANDS) {
    const n = BAND_NAME[b.id];
    const h = num(`HueAdjustment${n}`) ?? 0;
    const s = num(`SaturationAdjustment${n}`) ?? 0;
    const l = num(`LuminanceAdjustment${n}`) ?? 0;
    if (h || s || l) hsl[b.id] = { h: r(h)!, s: r(s)!, l: r(l)! };
  }
  if (Object.keys(hsl).length) a.hsl = hsl;

  const vig = num('PostCropVignetteAmount');
  if (vig) {
    a.vignette = {
      amount: r(vig)!,
      midpoint: r(num('PostCropVignetteMidpoint'), 0, 100),
      roundness: r(num('PostCropVignetteRoundness')),
      feather: r(num('PostCropVignetteFeather'), 0, 100),
    };
  }

  const grade: NonNullable<PhotoAdjust['grade']> = {};
  for (const w of WHEELS) {
    const sat = num(w.sat) ?? 0;
    const lum = num(w.lum) ?? 0;
    if (sat || lum) grade[w.key] = { hue: r(num(w.hue), 0, 360) ?? 0, sat: r(sat, 0, 100)!, lum: r(lum)! } as GradeWheel;
  }
  if (Object.keys(grade).length) {
    const blending = num('ColorGradeBlending');
    const balance = num('SplitToningBalance');
    if (blending != null) grade.blending = r(blending, 0, 100);
    if (balance != null) grade.balance = r(balance);
    a.grade = grade;
  }

  const curve: ToneCurve = {};
  for (const k of Object.keys(CURVE_NAME) as (keyof ToneCurve)[]) {
    const items = lists.get(CURVE_NAME[k]);
    if (!items?.length) continue;
    const pts = items
      .map((s) => s.split(',').map((n) => Number(n.trim())) as [number, number])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y]): CurvePoint => [clamp(x / 255, 0, 1), clamp(y / 255, 0, 1)])
      .sort((m, n) => m[0] - n[0]);
    const straight = pts.length === 2 && pts[0]![1] === 0 && pts[1]![1] === 1;
    if (pts.length >= 2 && !straight) curve[k] = pts;
  }
  if (Object.keys(curve).length) a.curve = curve;

  // What doesn't come across, said plainly.
  const partial: string[] = [];
  const has = (name: string) => v.has(name) || lists.has(name);
  if (['MaskGroupBasedCorrections', 'PaintBasedCorrections', 'GradientBasedCorrections', 'CircularGradientBasedCorrections'].some(has)) partial.push('masking');
  if (has('Look') || (v.get('CameraProfile') && v.get('CameraProfile') !== 'Adobe Standard')) partial.push('profil');
  if (num('Temperature') != null) partial.push('white balance Kelvin');
  if (['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights'].some((p) => (num(p) ?? 0) !== 0)) partial.push('kurva parametrik');
  if (has('RetouchAreas')) partial.push('retouch');
  if (has('LensProfileEnable') && v.get('LensProfileEnable') === '1') partial.push('profil lensa');

  const any = Object.keys(a).some((k) => !['brightness', 'contrast', 'saturation', 'warmth', 'fade', 'mono'].includes(k)) || a.brightness || a.contrast || a.saturation || a.warmth || a.mono;
  if (!any && !partial.length) return null;
  return {
    name: v.get('Name') || fallbackName,
    group: v.get('Group') || null,
    adjust: a,
    partial,
  };
}
