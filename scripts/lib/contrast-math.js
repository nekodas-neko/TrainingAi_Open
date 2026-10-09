'use strict';
// Colour maths shared by `check-contrast.js` and `check-small-text-contrast.js` (issue 2429), so
// the repo has ONE oklch -> sRGB -> WCAG luminance implementation. The self-test anchors that pin it
// (black/white, chromatic red) stay in `check-contrast.js`, which runs them before reporting.

function oklchToLinearSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const clamp = v => Math.min(1, Math.max(0, v));
// WCAG relative luminance is defined on LINEARISED sRGB, which is what the transform above
// already returns — there is no gamma round-trip to do here.
const lum = ([L, C, H]) => {
  const [r, g, b] = oklchToLinearSrgb(L, C, H).map(clamp);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function ratioFromLum(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const ratio = (fg, bg) => ratioFromLum(lum(fg), lum(bg));

const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const relLum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// A token is `[L, C, H]`, plus `hueVaries` when H comes from `var(--brand-hue, N)`.
function tokens(src) {
  const out = {};
  const RE = /--([a-z0-9-]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+(?:([0-9.]+)|var\(\s*--brand-hue\s*,\s*([0-9.]+)\s*\))/g;
  for (const m of src.matchAll(RE)) {
    const fixed = m[4] !== undefined;
    out[m[1]] = [parseFloat(m[2]), parseFloat(m[3]), parseFloat(fixed ? m[4] : m[5])];
    if (!fixed) out[m[1]].hueVaries = true;
  }
  return out;
}

module.exports = { tokens, oklchToLinearSrgb, clamp, lum, ratioFromLum, ratio, toGamma, toLinear, relLum };
