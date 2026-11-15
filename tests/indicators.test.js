// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../js/indicators.js");

const NA = NaN;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sameSeries = (actual, expected, eps = 1e-9) => {
  assert.equal(actual.length, expected.length, "length");
  expected.forEach((e, i) => {
    if (Number.isNaN(e)) assert.ok(Number.isNaN(actual[i]), `index ${i}: expected na, got ${actual[i]}`);
    else assert.ok(close(actual[i], e, eps), `index ${i}: expected ${e}, got ${actual[i]}`);
  });
};

// Deterministic synthetic market: trend + oscillation, no randomness.
function makeBars(n, start = 100) {
  const bars = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const open = p;
    const c = p + Math.sin(i / 4) * 2 + Math.cos(i / 11) * 1.3;
    const high = Math.max(open, c) + 0.5 + (i % 3) * 0.2;
    const low = Math.min(open, c) - 0.5 - (i % 2) * 0.3;
    bars.push({ time: 1700000000 + i * 60, open, high, low, close: c, volume: 10 + (i % 5) });
    p = c;
  }
  return bars;
}

test("div returns na on zero or na divisor", () => {
  assert.ok(Number.isNaN(I.div(1, 0)));
  assert.ok(Number.isNaN(I.div(0, 0)));
  assert.ok(Number.isNaN(I.div(1, NA)));
  assert.equal(I.div(6, 3), 2);
});

test("sma is na until len values, then the window mean", () => {
  sameSeries(I.sma([1, 2, 3, 4, 5], 3), [NA, NA, 2, 3, 4]);
});

test("sma skips na values and keeps the window on na bars", () => {
  // window after index 3: [1,2,4]; index 2 is na and leaves the window [1,2] unfilled.
  sameSeries(I.sma([1, 2, NA, 4, 5], 3), [NA, NA, NA, 7 / 3, 11 / 3]);
  // An na bar after warm-up repeats the current window mean.
  sameSeries(I.sma([1, 2, 3, NA, 5], 3), [NA, NA, 2, 2, 10 / 3]);
});

test("ema seeds with the SMA of the first len values", () => {
  const out = I.ema([1, 2, 3, 4, 5], 3);
  const alpha = 0.5;
  const e3 = alpha * 4 + (1 - alpha) * 2;
  const e4 = alpha * 5 + (1 - alpha) * e3;
  sameSeries(out, [NA, NA, 2, e3, e4]);
});

test("ema returns na on na bars without advancing state", () => {
  const out = I.ema([1, 2, 3, NA, 5], 3);
  sameSeries(out, [NA, NA, 2, NA, 0.5 * 5 + 0.5 * 2]);
});

test("rma uses alpha = 1/len", () => {
  const out = I.rma([2, 4, 6, 8], 2);
  sameSeries(out, [NA, 3, 0.5 * 6 + 0.5 * 3, 0.5 * 8 + 0.5 * 4.5]);
});

test("stoch: 100 * (close - lowest) / (highest - lowest) from bar len-1", () => {
  const high = [10, 12, 11, 13];
  const low = [8, 9, 7, 10];
  const src = [9, 11, 8, 12];
  const out = I.stoch(src, high, low, 3);
  sameSeries(out, [NA, NA, (100 * (8 - 7)) / (12 - 7), (100 * (12 - 7)) / (13 - 7)]);
});

test("stoch repeats the previous value on a flat range", () => {
  const high = [10, 12, 5, 5, 5];
  const low = [8, 9, 5, 5, 5];
  const src = [9, 11, 5, 5, 5];
  const out = I.stoch(src, high, low, 2);
  // bar 1: (11-8)/(12-8) = 75; bar 2: (5-5)/(12-5) = 0; bars 3-4: flat, repeat 0.
  sameSeries(out, [NA, 75, 0, 0, 0]);
  // bar 2: high [12,10]=12, low [9,10]=9 -> 100*(10-9)/3; bar 3 is flat at 10 and repeats it.
  const carried = I.stoch([9, 11, 10, 10], [10, 12, 10, 10], [8, 9, 10, 10], 2);
  sameSeries(carried, [NA, 75, 100 / 3, 100 / 3]);
});

test("crossover / crossunder compare with the last non-na pair", () => {
  const a = [1, 2, NA, 4, 3];
  const b = [2, 2, 3, 3, 3.5];
  assert.deepEqual(I.crossover(a, b), [false, false, false, true, false]);
  assert.deepEqual(I.crossunder(a, b), [false, false, false, false, true]);
});

test("rsi matches Wilder smoothing", () => {
  const src = [44, 44.15, 43.9, 44.35, 44.8, 45.1];
  const out = I.rsi(src, 3);
  // manual: gains/losses from index 1
  const up = [NA, 0.15, 0, 0.45, 0.45, 0.3];
  const down = [NA, 0, 0.25, 0, 0, 0];
  const ru = I.rma(up, 3);
  const rd = I.rma(down, 3);
  const expected = ru.map((u, i) => (Number.isNaN(u) ? NA : rd[i] === 0 ? 100 : 100 - 100 / (1 + u / rd[i])));
  sameSeries(out, expected);
});

test("market cipher b: warm-up lengths follow the Pine defaults", () => {
  const bars = makeBars(200);
  const m = I.marketCipherB(bars);
  const firstValid = (arr) => arr.findIndex((v) => !Number.isNaN(v));
  // x valid at 8, y needs 9 non-na |s-x| -> 16, fast ema(12) -> 27, slow sma(3) -> 29
  assert.equal(firstValid(m.fast), 27);
  assert.equal(firstValid(m.slow), 29);
  assert.equal(firstValid(m.vwap), 29);
  // m sma(5) -> 4, f sma(5) -> 8, mf sma(60) -> 67
  assert.equal(firstValid(m.mf), 67);
  // stoch(40) from 39, sma(2) -> 40; stoch(81) from 80, sma(2) -> 81
  assert.equal(firstValid(m.rsi), 40);
  assert.equal(firstValid(m.stoch), 81);
});

test("market cipher b: wave values equal a direct formula evaluation", () => {
  const bars = makeBars(120);
  const m = I.marketCipherB(bars);
  const s = bars.map((b) => (b.high + b.low + b.close) / 3);
  const x = I.ema(s, 9);
  const y = I.ema(s.map((v, i) => Math.abs(v - x[i])), 9);
  const z = s.map((v, i) => (v - x[i]) / (0.015 * y[i]));
  const fast = I.ema(z, 12);
  const slow = I.sma(fast, 3);
  sameSeries(m.fast, fast);
  sameSeries(m.slow, slow);
  sameSeries(m.vwap, fast.map((v, i) => v - slow[i]));
});

test("market cipher b: signals are crosses gated by -60 / 72", () => {
  const bars = makeBars(400);
  const m = I.marketCipherB(bars);
  for (let i = 0; i < bars.length; i++) {
    assert.equal(m.buySignal[i], m.buy[i] && m.fast[i] < -60, `buySignal ${i}`);
    assert.equal(m.sellSignal[i], m.sell[i] && m.fast[i] > 72, `sellSignal ${i}`);
    if (m.buy[i]) assert.ok(m.fast[i] > m.slow[i] && m.fast[i - 1] <= m.slow[i - 1]);
    if (m.sell[i]) assert.ok(m.fast[i] < m.slow[i] && m.fast[i - 1] >= m.slow[i - 1]);
  }
  assert.ok(m.buy.some(Boolean) && m.sell.some(Boolean), "synthetic data should cross");
});

test("market cipher b: flat candles give na instead of Infinity", () => {
  const bars = Array.from({ length: 100 }, (_, i) => ({
    time: i, open: 5, high: 5, low: 5, close: 5, volume: 1,
  }));
  const m = I.marketCipherB(bars);
  for (const key of ["fast", "slow", "vwap", "mf"]) {
    assert.ok(m[key].every((v) => !Number.isFinite(v) ? Number.isNaN(v) : true), `${key} has no Infinity`);
  }
});

test("market cipher b: settings change the lengths", () => {
  const bars = makeBars(200);
  const m = I.marketCipherB(bars, { wt_avgLen: 5 });
  assert.equal(m.fast.findIndex((v) => !Number.isNaN(v)), 16 + 4);
  assert.equal(m.params.wt_emaLen, 9);
});

test("vwap resets at the UTC day boundary", () => {
  const bars = [
    { time: 86400 - 60, high: 11, low: 9, close: 10, volume: 2 },
    { time: 86400, high: 21, low: 19, close: 20, volume: 3 },
  ];
  sameSeries(I.vwap(bars), [10, 20]);
});

test("vwap seed carries the session sums from before the first bar", () => {
  const bars = [{ time: 86400 + 600, high: 21, low: 19, close: 20, volume: 1 }];
  // earlier in the same day: price 10, volume 3 -> pv 30
  sameSeries(I.vwap(bars, { day: 1, pv: 30, vol: 3 }), [(30 + 20) / 4]);
  // a seed for another day is ignored
  sameSeries(I.vwap(bars, { day: 0, pv: 30, vol: 3 }), [20]);
});

test("heikin ashi open uses previous HA values", () => {
  const ha = I.heikinAshi([
    { time: 1, open: 10, high: 12, low: 9, close: 11 },
    { time: 2, open: 11, high: 13, low: 10, close: 12 },
  ]);
  assert.equal(ha[0].open, 10.5);
  assert.equal(ha[0].close, 10.5);
  assert.equal(ha[1].open, 10.5);
  assert.equal(ha[1].close, 11.5);
});

test("donchian midpoint is na until len bars, then (highest + lowest) / 2", () => {
  const high = [5, 7, 6, 9];
  const low = [1, 2, 3, 4];
  sameSeries(I.donchian(high, low, 3), [NA, NA, (7 + 1) / 2, (9 + 2) / 2]);
});

test("ichimoku: lines follow the TradingView formulas and shift", () => {
  const bars = makeBars(200);
  const ich = I.ichimoku(bars, { tenkan: 9, kijun: 26, senkou: 52, displacement: 26 });
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const t = I.donchian(high, low, 9);
  const k = I.donchian(high, low, 26);
  sameSeries(ich.tenkan, t);
  sameSeries(ich.kijun, k);
  sameSeries(ich.spanA, t.map((v, i) => (v + k[i]) / 2));
  sameSeries(ich.spanB, I.donchian(high, low, 52));
  assert.equal(ich.shift, 25);
  assert.equal(ich.spanB.findIndex((v) => !Number.isNaN(v)), 51);
});

test("ichimoku presets: crypto 20/60/120/30, classic 9/26/52/26", () => {
  assert.deepEqual({ ...I.ICHIMOKU_PRESETS.crypto }, { tenkan: 20, kijun: 60, senkou: 120, displacement: 30 });
  assert.deepEqual({ ...I.ICHIMOKU_PRESETS.classic }, { tenkan: 9, kijun: 26, senkou: 52, displacement: 26 });
});

test("ichimoku read: price far above a rising market is above the cloud and bullish", () => {
  const bars = Array.from({ length: 150 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i }));
  const r = I.ichimokuRead(bars, I.ichimoku(bars));
  assert.equal(r.ready, true);
  assert.equal(r.position, "above");
  assert.equal(r.tk, "bull");
  assert.equal(r.chikou, "above");
  assert.equal(r.futureBullish, true);
  assert.ok(r.score > 0.9);
  const down = bars.map((b, i) => ({ time: i, open: 300 - i, high: 301 - i, low: 299 - i, close: 299.5 - i }));
  const d = I.ichimokuRead(down, I.ichimoku(down));
  assert.equal(d.position, "below");
  assert.ok(d.score < -0.9);
});
