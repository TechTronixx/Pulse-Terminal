// js/vpvr.js -- VPVR (Volume Profile Visible Range) calculation layer.
// Pure: no DOM, no chart library. Exposes global `VPVR` so it can be unit-tested
// in isolation (run `node js/vpvr.js` to execute the built-in self-check).
//
// Buy/sell split uses real Binance taker buy base volume when present on the
// candle (`takerBuy`). Within-candle volume is distributed across the candle's
// [low, high] range, overlap-weighted across price bins -- the standard VPVR
// approximation when per-trade ticks are unavailable.
(function (global) {
  "use strict";

  // Compute a volume profile over the given visible candles.
  // opts: { rows = 24, vaPct = 0.70 }
  // candle: { time, open, high, low, close, volume, takerBuy? }
  function computeProfile(visibleCandles, opts) {
    opts = opts || {};
    const rows = Math.max(1, Math.floor(opts.rows == null ? 24 : opts.rows));
    const vaPct = clamp01(opts.vaPct == null ? 0.7 : opts.vaPct);

    // --- filter + normalize input, track taker availability ---
    const candles = [];
    let hasTaker = false;
    let inputVolume = 0;
    for (const c of visibleCandles || []) {
      if (!c) continue;
      const o = +c.open, h = +c.high, l = +c.low, v = +c.volume;
      if (![o, h, l, v].every(Number.isFinite)) continue;
      if (!(h >= l)) continue; // malformed
      if (v > 0) inputVolume += v;
      const tb = +c.takerBuy;
      const takerFinite = Number.isFinite(tb);
      if (takerFinite) hasTaker = true;
      const buy = takerFinite ? Math.max(0, Math.min(v, tb)) : 0;
      candles.push({
        h, l, v,
        buy,
        sell: takerFinite ? Math.max(0, v - buy) : 0,
        hasTaker: takerFinite,
      });
    }

    if (candles.length === 0 || inputVolume === 0) return emptyProfile();

    // --- visible high / low ---
    let hi = -Infinity, lo = Infinity;
    for (const c of candles) {
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi >= lo)) return emptyProfile();

    // --- bin layout (last bin snaps to hi so the top price is always covered) ---
    let binSize = (hi - lo) / rows;
    let binCount = rows;
    if (!(binSize > 0)) { // flat or sub-tick range -> single bin
      binSize = (hi - lo) || 1;
      binCount = 1;
    }
    const bins = new Array(binCount);
    for (let i = 0; i < binCount; i++) {
      const pl = lo + i * binSize;
      const ph = i === binCount - 1 ? hi : lo + (i + 1) * binSize;
      bins[i] = {
        priceLow: pl, priceHigh: ph, priceMid: (pl + ph) / 2,
        total: 0, buy: 0, sell: 0, delta: 0, deltaPct: 0, pctOfTotal: 0,
        inValueArea: false, isPOC: false,
      };
    }

    // --- distribute each candle across the bins its [low, high] range overlaps ---
    for (const c of candles) {
      if (c.v <= 0) continue;
      const span = c.h - c.l;
      if (span <= 0) {
        // flat candle (high == low): all volume to the single containing bin
        let idx = Math.floor((c.l - lo) / binSize);
        if (idx < 0) idx = 0;
        if (idx >= binCount) idx = binCount - 1;
        const b = bins[idx];
        b.total += c.v;
        if (c.hasTaker) { b.buy += c.buy; b.sell += c.sell; }
        continue;
      }
      let first = Math.floor((c.l - lo) / binSize);
      let last = Math.floor((c.h - lo) / binSize);
      if (first < 0) first = 0;
      if (last >= binCount) last = binCount - 1;
      for (let i = first; i <= last; i++) {
        const b = bins[i];
        const overlap = Math.min(c.h, b.priceHigh) - Math.max(c.l, b.priceLow);
        if (overlap <= 0) continue;
        const frac = overlap / span;
        b.total += c.v * frac;
        if (c.hasTaker) { b.buy += c.buy * frac; b.sell += c.sell * frac; }
      }
    }

    // --- POC + totals + per-bin derived metrics ---
    let maxVol = -Infinity, pocIdx = 0, sumTotal = 0;
    for (let i = 0; i < binCount; i++) {
      const b = bins[i];
      if (b.total > maxVol) { maxVol = b.total; pocIdx = i; }
      sumTotal += b.total;
      b.delta = b.buy - b.sell;
      b.deltaPct = b.total > 0 ? (b.delta / b.total) * 100 : 0;
    }
    const total = sumTotal > 0 ? sumTotal : inputVolume;
    for (const b of bins) b.pctOfTotal = total > 0 ? (b.total / total) * 100 : 0;
    bins[pocIdx].isPOC = true;

    // --- value area: expand from POC, adding the larger neighbor each step ---
    const target = total * vaPct;
    const inVA = new Array(binCount).fill(false);
    inVA[pocIdx] = true;
    let cum = bins[pocIdx].total;
    let loIdx = pocIdx - 1, hiIdx = pocIdx + 1;
    while (cum < target && (loIdx >= 0 || hiIdx < binCount)) {
      const below = loIdx >= 0 ? bins[loIdx].total : -Infinity;
      const above = hiIdx < binCount ? bins[hiIdx].total : -Infinity;
      if (below >= above) { inVA[loIdx] = true; cum += bins[loIdx].total; loIdx--; }
      else { inVA[hiIdx] = true; cum += bins[hiIdx].total; hiIdx++; }
    }
    let vah = null, val = null, valueAreaVolume = 0;
    for (let i = 0; i < binCount; i++) {
      if (inVA[i]) {
        bins[i].inValueArea = true;
        valueAreaVolume += bins[i].total;
        if (val === null || bins[i].priceLow < val) val = bins[i].priceLow;
        if (vah === null || bins[i].priceHigh > vah) vah = bins[i].priceHigh;
      }
    }

    return {
      bins, totalVolume: total, valueAreaVolume,
      pocPrice: bins[pocIdx].priceMid, pocIdx, vah, val, vaPct,
      hasTaker, rows: binCount, binSize,
      priceLow: lo, priceHigh: hi, pricePrecision: derivePrecision(binSize),
    };
  }

  function emptyProfile() {
    return {
      bins: [], totalVolume: 0, valueAreaVolume: 0, pocPrice: null, pocIdx: -1,
      vah: null, val: null, vaPct: 0.7, hasTaker: false, rows: 0, binSize: 0,
      priceLow: null, priceHigh: null, pricePrecision: 2,
    };
  }

  function clamp01(x) { x = +x; if (!Number.isFinite(x)) return 0; return Math.min(1, Math.max(0, x)); }

  function derivePrecision(binSize) {
    if (!(binSize > 0)) return 2;
    const d = Math.ceil(-Math.log10(binSize));
    return Math.max(0, Math.min(8, Number.isFinite(d) ? d : 2));
  }

  function formatPrice(p, precision) {
    if (!Number.isFinite(+p)) return "-";
    const pr = precision == null ? 2 : precision;
    return (+p).toLocaleString("en-US", { minimumFractionDigits: pr, maximumFractionDigits: pr });
  }

  function formatVolume(v) {
    const n = +v;
    if (!Number.isFinite(n)) return "-";
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(2);
  }

  // --- self-check: `node js/vpvr.js` ---
  function assert(cond, msg) { if (!cond) throw new Error("VPVR self-check FAILED: " + msg); }

  function demo() {
    const cs = [];
    let p = 100;
    for (let i = 0; i < 60; i++) {
      const o = p;
      const close = p + Math.sin(i / 5) * 3;
      const high = Math.max(o, close) + 1 + (i % 3);
      const low = Math.min(o, close) - 1 - (i % 2);
      const volume = 100 + (i % 7) * 10;
      cs.push({
        time: i, open: o, high: high, low: low, close: close, volume: volume,
        takerBuy: volume * (close >= o ? 0.6 : 0.3),
      });
      p = close;
    }
    const inputTotal = cs.reduce((a, c) => a + c.volume, 0);
    const prof = computeProfile(cs, { rows: 24, vaPct: 0.7 });

    const binTotal = prof.bins.reduce((a, b) => a + b.total, 0);
    assert(Math.abs(binTotal - inputTotal) / inputTotal < 1e-6,
      "sum of bins ~= input volume (got " + binTotal + " vs " + inputTotal + ")");

    let maxBin = prof.bins[0];
    for (const b of prof.bins) if (b.total > maxBin.total) maxBin = b;
    assert(Math.abs(maxBin.priceMid - prof.pocPrice) < 1e-9, "POC == max-volume bin");

    assert(prof.vah == null || prof.val == null || prof.vah >= prof.val, "VAH >= VAL");

    const vaPctActual = prof.totalVolume > 0 ? prof.valueAreaVolume / prof.totalVolume : 0;
    assert(vaPctActual >= 0.7 - 1e-6,
      "value area >= 70% (got " + (vaPctActual * 100).toFixed(1) + "%)");

    const prof2 = computeProfile(cs.slice(0, 20), { rows: 24, vaPct: 0.7 });
    assert(prof2.totalVolume !== prof.totalVolume || prof2.pocPrice !== prof.pocPrice,
      "recalc on a different visible range yields a different profile");

    assert(computeProfile([], {}).bins.length === 0, "no data -> empty profile");
    const one = computeProfile([{ time: 1, open: 5, high: 5, low: 5, close: 5, volume: 10 }], {});
    assert(one.bins.length === 1 && one.bins[0].total === 10, "one flat candle -> single bin with all volume");
    assert(computeProfile([{ time: 1, open: 5, high: 6, low: 4, close: 5, volume: 0 }], {}).bins.length === 0,
      "zero-volume candle -> empty profile");
    assert(computeProfile([{ time: 1, open: 5, high: 6, low: 4, close: 5, volume: 10 }], {}).hasTaker === false,
      "missing taker -> hasTaker false");

    console.log("VPVR self-check OK. bins=" + prof.bins.length +
      " POC=" + prof.pocPrice.toFixed(2) +
      " VAH=" + prof.vah.toFixed(2) + " VAL=" + prof.val.toFixed(2) +
      " VA=" + (vaPctActual * 100).toFixed(1) + "%" +
      " total=" + binTotal.toFixed(2));
  }

  global.VPVR = { computeProfile, derivePrecision, formatPrice, formatVolume, demo };

  if (typeof require !== "undefined" && require.main === module) demo();
})(typeof window !== "undefined" ? window : globalThis);
