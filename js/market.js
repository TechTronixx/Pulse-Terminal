// js/market.js -- slower market data for the Signal and Market panels:
//   multi-timeframe klines (Binance spot or perp), Fear & Greed (alternative.me for crypto,
//   CNN via api/sentiment.js for stocks), fundamentals (CoinGecko, crypto only), and news (/api/news).
// Exposes global `PulseMarket`.
(function (global) {
  "use strict";

  const MTF = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "1y"];
  const MTF_REFRESH = {
    "1m": 15e3, "3m": 20e3, "5m": 30e3, "15m": 60e3, "30m": 90e3, "1h": 120e3,
    "4h": 300e3, "1d": 600e3, "1w": 1800e3, "1M": 3600e3, "1y": 3600e3,
  };
  const LONG_TF = { "1w": true, "1M": true, "1y": true };

  // Binance has no yearly interval: build UTC-year candles from monthly ones.
  function toYears(months) {
    const out = [];
    for (const b of months) {
      const y = new Date(b.time * 1000).getUTCFullYear();
      const last = out[out.length - 1];
      if (last && last.year === y) {
        last.high = Math.max(last.high, b.high);
        last.low = Math.min(last.low, b.low);
        last.close = b.close;
        last.volume += b.volume;
      } else {
        out.push({ year: y, time: Date.UTC(y, 0, 1) / 1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
      }
    }
    return out;
  }
  async function getJson(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function klines(inst, tf, signal) {
    const interval = tf === "1y" ? "1M" : tf;
    const limit = LONG_TF[tf] ? 1000 : 300;
    const bars = await global.PulseFeed.fetchRecentKlines(inst, interval, limit, signal);
    return tf === "1y" ? toYears(bars) : bars;
  }
  async function fearGreed(signal) {
    const d = await getJson("https://api.alternative.me/fng/?limit=8", signal);
    const rows = (d.data || []).map((r) => ({ value: +r.value, label: r.value_classification, time: +r.timestamp }));
    if (!rows.length) throw new Error("No Fear & Greed data");
    return { value: rows[0].value, label: rows[0].label, time: rows[0].time, history: rows, source: "crypto" };
  }

  // US stock market Fear & Greed (CNN), proxied by api/sentiment.js.
  async function stockFearGreed(signal) {
    const d = await getJson("api/sentiment", signal);
    if (!Number.isFinite(d.value)) throw new Error("No stock sentiment data");
    return d;
  }

  async function coingecko(inst, signal) {
    const id = inst.cg;
    const d = await getJson(
      `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
      signal,
    );
    const m = d.market_data || {};
    const usd = (o) => (o && Number.isFinite(o.usd) ? o.usd : NaN);
    return {
      id,
      name: d.name,
      rank: d.market_cap_rank,
      price: usd(m.current_price),
      marketCap: usd(m.market_cap),
      fdv: usd(m.fully_diluted_valuation),
      volume: usd(m.total_volume),
      circulating: m.circulating_supply,
      total: m.total_supply,
      max: m.max_supply,
      ath: usd(m.ath),
      athChange: m.ath_change_percentage ? m.ath_change_percentage.usd : NaN,
      athDate: m.ath_date ? m.ath_date.usd : null,
      change24h: m.price_change_percentage_24h,
      change7d: m.price_change_percentage_7d,
      change30d: m.price_change_percentage_30d,
      change1y: m.price_change_percentage_1y,
      categories: (d.categories || []).filter(Boolean).slice(0, 3),
    };
  }

  async function news(inst, signal) {
    return getJson(`api/news?coin=${encodeURIComponent(inst.id)}`, signal);
  }

  function create(h) {
    let pair = null;
    let ctrl = null;
    const timers = [];

    function every(ms, fn) {
      fn();
      timers.push(setInterval(fn, ms));
    }

    function run(task, onOk, onErr, retryMs) {
      const myPair = pair;
      task(ctrl.signal)
        .then((v) => myPair === pair && onOk(v))
        .catch((e) => {
          if (e.name === "AbortError" || myPair !== pair) return;
          onErr(e);
          // public APIs rate-limit bursts (CoinGecko answers 429 without CORS headers): retry sooner
          if (retryMs) timers.push(setTimeout(() => myPair === pair && run(task, onOk, onErr), retryMs));
        });
    }

    return {
      MTF,
      start(p) {
        this.stop();
        pair = p;
        ctrl = new AbortController();
        for (const tf of MTF) {
          every(MTF_REFRESH[tf], () => run((s) => klines(pair, tf, s), (bars) => h.onKlines(tf, bars), (e) => h.onError("klines " + tf, e)));
        }
        // sentiment: crypto Fear & Greed for crypto, CNN Fear & Greed for stocks, none for commodities
        if (pair.group === "crypto") every(15 * 60e3, () => run(fearGreed, h.onFearGreed, (e) => h.onError("fng", e), 60e3));
        else if (pair.group === "stocks") every(15 * 60e3, () => run(stockFearGreed, h.onFearGreed, (e) => h.onError("fng", e), 60e3));
        if (pair.cg) every(5 * 60e3, () => run((s) => coingecko(pair, s), h.onFundamentals, (e) => h.onError("coingecko", e), 45e3));
        every(5 * 60e3, () => run((s) => news(pair, s), h.onNews, (e) => h.onError("news", e), 60e3));
      },
      stop() {
        timers.splice(0).forEach((t) => {
          clearInterval(t);
          clearTimeout(t);
        });
        if (ctrl) ctrl.abort();
      },
    };
  }

  global.PulseMarket = { create, MTF };
})(typeof window !== "undefined" ? window : globalThis);
