// api/sentiment.js -- Vercel serverless function: GET /api/sentiment
// CNN's US stock market Fear & Greed Index (0-100), reshaped like the crypto index the app
// already reads: { value, label, time (unix s), history: [{ value, label, time }] newest first }.
// CNN's endpoint has no CORS headers, so the browser cannot read it directly.
"use strict";

const URL_CNN = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

const titleCase = (s) => String(s || "").replace(/\b\w/g, (m) => m.toUpperCase());

function shape(j) {
  const now = j.fear_and_greed || {};
  const hist = ((j.fear_and_greed_historical || {}).data || [])
    .map((p) => ({ value: Math.round(p.y), label: titleCase(p.rating), time: Math.floor(p.x / 1000) }))
    .sort((a, b) => b.time - a.time);
  // one point per UTC day, newest first
  const days = [];
  const seen = new Set();
  for (const p of hist) {
    const d = Math.floor(p.time / 86400);
    if (seen.has(d)) continue;
    seen.add(d);
    days.push(p);
    if (days.length >= 8) break;
  }
  const value = Math.round(now.score);
  return {
    value,
    label: titleCase(now.rating),
    time: Math.floor(Date.parse(now.timestamp) / 1000) || Math.floor(Date.now() / 1000),
    history: [{ value, label: titleCase(now.rating), time: Math.floor(Date.now() / 1000) }].concat(days.slice(1, 7)),
    source: "stocks",
  };
}

async function getSentiment() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(URL_CNN, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return shape(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  try {
    const body = await getSentiment();
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=900, stale-while-revalidate=1800");
    res.end(JSON.stringify(body));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Stock market sentiment is unavailable right now." }));
  }
};

module.exports.getSentiment = getSentiment;
module.exports.shape = shape;
