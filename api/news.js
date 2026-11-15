// api/news.js -- Vercel serverless function: GET /api/news?coin=BTC
// Crypto: public RSS feeds (CoinDesk, Cointelegraph, Decrypt, Bitcoin.com). Stocks and commodities:`n// Yahoo Finance per-symbol RSS. Scores headlines
// with a keyword lexicon, and returns JSON. Cached at the edge for 5 minutes.
"use strict";

const { FEEDS, COINS, YAHOO, yahooFeed, parseRss, buildNews } = require("./_news-core.js");

const FEED_TIMEOUT_MS = 6000;

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { "user-agent": "PulseTerminal/2.0 (+https://pulse-terminal.vercel.app)", accept: "application/rss+xml, application/xml, text/xml" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRss(await res.text(), feed.source);
  } finally {
    clearTimeout(timer);
  }
}

async function getNews(coin) {
  const yahoo = YAHOO[coin];
  const feeds = yahoo ? [yahooFeed(yahoo)] : FEEDS;
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const items = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else failed.push(feeds[i].source);
  });
  const out = buildNews(items, coin, Date.now(), 20, !!yahoo);
  out.sources = feeds.map((f) => f.source).filter((s) => !failed.includes(s));
  out.failed = failed;
  return out;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const coin = String(url.searchParams.get("coin") || "BTC").toUpperCase();
  if (!COINS[coin] && !YAHOO[coin]) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: `Unsupported coin "${coin}". Use one of ${Object.keys(COINS).concat(Object.keys(YAHOO)).join(", ")}.` }));
    return;
  }
  try {
    const body = await getNews(coin);
    res.statusCode = body.sources.length ? 200 : 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=600");
    res.end(JSON.stringify(body));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "News feeds are unavailable right now." }));
  }
};

module.exports.getNews = getNews;
