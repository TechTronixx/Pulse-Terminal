// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../js/verdict.js");
const N = require("../api/_news-core.js");

const NA = NaN;

// Minimal MCB-shaped object: arrays of length n, last bar values given.
function mcb(n, last, flags = {}) {
  const arr = (v) => Array.from({ length: n }, (_, i) => (i === n - 1 ? v : 0));
  const bools = (idx) => Array.from({ length: n }, (_, i) => i === idx);
  return {
    fast: arr(last.fast),
    slow: arr(last.slow),
    mf: arr(last.mf),
    rsi: arr(last.rsi),
    stoch: arr(last.stoch),
    buy: bools(flags.buy ?? -1),
    sell: bools(flags.sell ?? -1),
    buySignal: bools(flags.buySignal ?? -1),
    sellSignal: bools(flags.sellSignal ?? -1),
  };
}

test("zones follow the script's 53 / 60 levels", () => {
  assert.equal(V.zoneOf(-65).key, "oversold");
  assert.equal(V.zoneOf(-55).key, "nearOversold");
  assert.equal(V.zoneOf(10).key, "neutral");
  assert.equal(V.zoneOf(55).key, "nearOverbought");
  assert.equal(V.zoneOf(61).key, "overbought");
});

test("fresh big green dot means Long", () => {
  const r = V.readTimeframe(mcb(50, { fast: -62, slow: -66, mf: -5, rsi: 20, stoch: 10 }, { buySignal: 48, buy: 48 }));
  assert.equal(r.action, "Long");
  assert.equal(r.dot.type, "buySignal");
  assert.equal(r.dot.ago, 1);
});

test("all bearish components give Short when not oversold", () => {
  const r = V.readTimeframe(mcb(50, { fast: 20, slow: 30, mf: -10, rsi: 40, stoch: 60 }, { sell: 47 }));
  assert.ok(r.score <= -0.35, `score ${r.score}`);
  assert.equal(r.action, "Short");
  assert.equal(r.bias, "Bearish");
});

test("bullish but overbought waits", () => {
  const r = V.readTimeframe(mcb(50, { fast: 70, slow: 60, mf: 10, rsi: 80, stoch: 50 }, { buy: 46 }));
  assert.ok(r.score > 0.35);
  assert.equal(r.action, "Wait");
  assert.ok(r.reasons.some((x) => x.includes("overbought")));
});

test("warm-up returns a not-ready Wait", () => {
  const r = V.readTimeframe(mcb(10, { fast: NA, slow: NA, mf: NA, rsi: NA, stoch: NA }));
  assert.equal(r.ready, false);
  assert.equal(r.action, "Wait");
});

test("technical blends timeframes by weight and the chart's classic read", () => {
  const rows = { "4h": { ready: true, score: 1 }, "1d": { ready: true, score: -1 } };
  assert.equal(V.technical(rows, null), 0);
  assert.ok(Math.abs(V.technical(rows, 1) - 0.2) < 1e-9);
  assert.equal(V.technical({}, null), null);
});

test("overall renormalizes missing parts and blocks trades against technicals", () => {
  const a = V.overall({ technical: 0.6, sentiment: null, news: null, fundamentals: null });
  assert.equal(a.action, "Long");
  assert.equal(a.total, 1);
  const b = V.overall({ technical: -0.2, sentiment: 1, news: 1, fundamentals: 1 });
  assert.equal(b.action, "Wait");
  assert.equal(b.note, "Technicals disagree with the rest");
});

test("overall waits instead of chasing stretched timeframes", () => {
  const parts = { technical: -0.5, sentiment: -0.7, news: -0.5, fundamentals: -0.3 };
  assert.equal(V.overall(parts).action, "Short");
  const r = V.overall(parts, { zones: { ready: 5, oversold: 4, overbought: 0 } });
  assert.equal(r.action, "Wait");
  assert.ok(r.note.includes("4 of 5 timeframes are already oversold"));
});

test("levels use the 20-bar swing with a 1:2 target", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({ high: 110 + (i === 25 ? 5 : 0), low: 90 - (i === 20 ? 5 : 0), close: 100 }));
  const long = V.levels(bars, "Long");
  assert.deepEqual(long, { entry: 100, stop: 85, target: 130 });
  const short = V.levels(bars, "Short");
  assert.deepEqual(short, { entry: 100, stop: 115, target: 70 });
  assert.equal(V.levels(bars, "Wait"), null);
});

test("sentiment maps Fear & Greed to [-1, 1]", () => {
  assert.equal(V.sentiment({ value: 50 }), 0);
  assert.equal(V.sentiment({ value: 0 }), -1);
  assert.equal(V.sentiment({ value: 100 }), 1);
  assert.equal(V.sentiment(null), null);
});

test("headline scoring: bullish, bearish, negated, neutral", () => {
  assert.ok(N.scoreHeadline("Bitcoin surges to record high as ETF inflows jump") > 0.5);
  assert.ok(N.scoreHeadline("Solana plunges after exchange hack") < -0.5);
  assert.ok(N.scoreHeadline("Ether did not crash despite fears") > N.scoreHeadline("Ether crash deepens"));
  assert.equal(N.scoreHeadline("Ethereum developers meet on Thursday"), 0);
});

test("coin matching avoids common words", () => {
  assert.equal(N.mentions("LINK", "Read the link below"), false);
  assert.equal(N.mentions("LINK", "Chainlink adds new oracle"), true);
  assert.equal(N.mentions("SOL", "The sol-gel process"), false);
  assert.equal(N.mentions("SOL", "SOL rallies 10%"), true);
});

test("rss parsing handles CDATA and entities", () => {
  const xml = `<rss><channel><item><title><![CDATA[Bitcoin &amp; Ether rally]]></title><link>https://ex.com/a</link><pubDate>Sun, 15 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Up big&lt;/p&gt;</description></item><item><title>No link</title></item></channel></rss>`;
  const items = N.parseRss(xml, "Ex");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Bitcoin & Ether rally");
  assert.equal(items[0].description, "Up big");
  assert.equal(items[0].published, Date.parse("Sun, 15 Nov 2026 10:00:00 GMT"));
});
