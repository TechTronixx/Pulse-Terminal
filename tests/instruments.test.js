// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const IN = require("../js/instruments.js");
const N = require("../api/_news-core.js");

test("every instrument has a unique id, a Binance symbol, a venue and an icon file", () => {
  const ids = new Set();
  for (const it of IN.LIST) {
    assert.ok(!ids.has(it.id), `duplicate ${it.id}`);
    ids.add(it.id);
    assert.equal(it.symbol, `${it.id}USDT`);
    assert.equal(it.venue, it.group === "crypto" ? "spot" : "perp");
    assert.ok(fs.existsSync(path.join(__dirname, "..", it.icon)), `missing icon ${it.icon}`);
  }
});

test("groups are crypto, stocks and commodities, each non-empty", () => {
  assert.deepEqual(IN.GROUPS.map((g) => g.id), ["crypto", "stocks", "commodities"]);
  for (const g of IN.GROUPS) assert.ok(IN.inGroup(g.id).length >= 6, g.id);
});

test("crypto has CoinGecko ids; stocks and commodities have a news symbol", () => {
  for (const it of IN.LIST) {
    if (it.group === "crypto") assert.ok(it.cg, it.id);
    else assert.ok(it.news && N.YAHOO[it.id], it.id);
  }
});

test("news matching for stocks and commodities", () => {
  assert.equal(N.mentions("NVDA", "Nvidia beats estimates"), true);
  assert.equal(N.mentions("NVDA", "Retirement income plan"), false);
  assert.equal(N.mentions("XAU", "Gold hits record as dollar slips"), true);
  assert.equal(N.mentions("CL", "OPEC+ agrees to cut output"), true);
  assert.equal(N.mentions("COPPER", "Gold and silver rally"), false);
});

test("candle buckets match Binance boundaries (weeks start Monday, months on the 1st)", () => {
  const F = require("../js/feed.js");
  const t = Date.UTC(2026, 10, 15, 9, 30, 12); // Sunday 2026-11-15 09:30:12 UTC
  assert.equal(F.bucketStart(t, "1h"), Date.UTC(2026, 10, 15, 9) / 1000);
  assert.equal(F.bucketStart(t, "4h"), Date.UTC(2026, 10, 15, 8) / 1000);
  assert.equal(F.bucketStart(t, "1d"), Date.UTC(2026, 10, 15) / 1000);
  assert.equal(F.bucketStart(t, "1w"), Date.UTC(2026, 10, 9) / 1000); // Monday 9 Nov
  assert.equal(F.bucketStart(t, "1M"), Date.UTC(2026, 10, 1) / 1000);
});
