// api/_news-core.js -- RSS parsing and keyword sentiment for /api/news.
// Pure functions (no network) so they can be unit-tested. Files starting with "_"
// inside api/ are not deployed as routes by Vercel.
"use strict";

const FEEDS = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "Bitcoin.com", url: "https://news.bitcoin.com/feed/" },
];

// Case-insensitive names, case-sensitive tickers (avoids matching "link", "ada", "sol").
const COINS = {
  BTC: { names: /\bbitcoin\b/i, ticker: /\bBTC\b/ },
  ETH: { names: /\b(ethereum|ether)\b/i, ticker: /\bETH\b/ },
  SOL: { names: /\bsolana\b/i, ticker: /\bSOL\b/ },
  BNB: { names: /\b(bnb chain|binance coin)\b/i, ticker: /\bBNB\b/ },
  DOGE: { names: /\bdogecoin\b/i, ticker: /\bDOGE\b/ },
  XRP: { names: /\bripple\b/i, ticker: /\bXRP\b/ },
  ADA: { names: /\bcardano\b/i, ticker: /\bADA\b/ },
  LINK: { names: /\bchainlink\b/i, ticker: /\bLINK\b/ },
};

const BULLISH = [
  "surge", "surges", "surged", "soar", "soars", "soared", "rally", "rallies", "rallied", "jump", "jumps", "jumped",
  "gain", "gains", "gained", "rise", "rises", "rising", "rose", "climb", "climbs", "climbed", "record high", "all-time high",
  "bull", "bullish", "breakout", "breaks out", "approve", "approves", "approved", "approval", "inflow", "inflows",
  "adopt", "adopts", "adoption", "accumulate", "accumulates", "accumulation", "upgrade", "partnership", "rebound",
  "rebounds", "recover", "recovers", "recovery", "outperform", "outperforms", "buying", "buys", "boost", "boosts",
  "optimism", "optimistic", "milestone", "green",
];
const BEARISH = [
  "plunge", "plunges", "plunged", "crash", "crashes", "crashed", "drop", "drops", "dropped", "fall", "falls", "fell",
  "slump", "slumps", "tumble", "tumbles", "tumbled", "sink", "sinks", "sank", "decline", "declines", "declined",
  "bear", "bearish", "sell-off", "selloff", "selling", "liquidation", "liquidations", "liquidated", "hack", "hacked",
  "exploit", "exploited", "lawsuit", "sues", "sued", "ban", "bans", "banned", "outflow", "outflows", "fraud", "scam",
  "warning", "warns", "fear", "fears", "dump", "dumps", "dumped", "reject", "rejects", "rejected", "investigation",
  "crackdown", "losses", "loses", "lost", "slide", "slides", "weak", "weakness", "red", "capitulation", "panic",
  "breach", "breached", "vanishes", "threat", "threatens", "hike", "plummets", "slips", "stolen", "drain", "drained",
];
const NEGATIONS = new Set(["not", "no", "never", "without", "fails", "failed"]);

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const stripTags = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(decodeEntities(m[1])) : "";
}

function parseRss(xml, source) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[0];
    const title = tag(block, "title");
    let url = tag(block, "link");
    if (!url) {
      const g = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
      url = g ? stripTags(decodeEntities(g[1])) : "";
    }
    const published = Date.parse(tag(block, "pubDate")) || 0;
    const description = tag(block, "description").slice(0, 400);
    if (!title || !/^https?:\/\//.test(url)) continue;
    items.push({ title, url, source, published, description });
  }
  return items;
}

function countTerms(words, text, list) {
  let n = 0;
  for (const term of list) {
    if (term.includes(" ") || term.includes("-")) {
      if (text.includes(term)) n++;
      continue;
    }
    for (let i = 0; i < words.length; i++) {
      if (words[i] !== term) continue;
      const negated = NEGATIONS.has(words[i - 1]) || NEGATIONS.has(words[i - 2]);
      n += negated ? -1 : 1;
    }
  }
  return n;
}

// Keyword score in [-1, 1]: (bullish - bearish) / (bullish + bearish).
function scoreHeadline(text) {
  const lower = String(text).toLowerCase();
  const words = lower.split(/[^a-z0-9'-]+/).filter(Boolean);
  const pos = countTerms(words, lower, BULLISH);
  const neg = countTerms(words, lower, BEARISH);
  const p = Math.max(0, pos) + Math.max(0, -neg);
  const n = Math.max(0, neg) + Math.max(0, -pos);
  if (p + n === 0) return 0;
  return (p - n) / (p + n);
}

const tagOf = (score) => (score > 0.15 ? "bullish" : score < -0.15 ? "bearish" : "neutral");

function mentions(coin, text) {
  const c = COINS[coin];
  return !!c && (c.names.test(text) || c.ticker.test(text));
}

// Merge feeds, dedupe, score, and pick coin-specific items (topped up with general market news).
function buildNews(feedItems, coin, now, limit = 20) {
  const seen = new Set();
  const all = [];
  for (const it of feedItems) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const text = `${it.title}. ${it.description || ""}`;
    const score = scoreHeadline(it.title) * 0.7 + scoreHeadline(it.description || "") * 0.3;
    all.push({
      title: it.title,
      url: it.url,
      source: it.source,
      published: it.published,
      score: Math.round(score * 100) / 100,
      tag: tagOf(score),
      coinSpecific: mentions(coin, text),
    });
  }
  all.sort((a, b) => b.published - a.published);
  const specific = all.filter((x) => x.coinSpecific);
  const general = all.filter((x) => !x.coinSpecific);
  const items = specific.slice(0, limit);
  for (const g of general) {
    if (items.length >= Math.max(8, Math.min(limit, specific.length + 6))) break;
    items.push(g);
  }
  items.sort((a, b) => b.published - a.published);

  // Summary over the last 24h, coin-specific items weighted 2x.
  const dayAgo = now - 86400000;
  let w = 0;
  let s = 0;
  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const it of items) {
    counts[it.tag]++;
    if (it.published && it.published < dayAgo) continue;
    const wt = it.coinSpecific ? 2 : 1;
    w += wt;
    s += it.score * wt;
  }
  return {
    coin,
    updated: now,
    items,
    summary: { ...counts, score: w ? Math.round((s / w) * 100) / 100 : 0, sample: items.length },
  };
}

module.exports = { FEEDS, COINS, parseRss, scoreHeadline, tagOf, mentions, buildNews, decodeEntities };
