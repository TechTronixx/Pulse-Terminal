// scripts/make-icons.js -- writes monogram SVG badges for instruments without a coin logo.
// Usage: node scripts/make-icons.js
"use strict";

const fs = require("fs");
const path = require("path");
const { LIST } = require("../js/instruments.js");

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const out = path.resolve(__dirname, "..", "icons", "markets");
fs.mkdirSync(out, { recursive: true });
for (const it of LIST) {
  if (!it.mono) continue;
  const ink = luminance(it.color) > 0.35 ? "#111111" : "#ffffff";
  const size = it.mono.length >= 3 ? 10.5 : it.mono.length === 2 ? 13 : 16;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="16" fill="${it.color}"/>` +
    `<text x="16" y="16" dy="0.36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" ` +
    `font-weight="700" font-size="${size}" fill="${ink}">${it.mono}</text></svg>\n`;
  fs.writeFileSync(path.join(out, `${it.id.toLowerCase()}.svg`), svg);
}
console.log("icons written to", out);
