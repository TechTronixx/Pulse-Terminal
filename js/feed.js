// js/feed.js -- Binance market-data feed for Pulse Terminal.
// One combined WebSocket per session:
//   <sym>@aggTrade        real-time trades -> the live candle moves on every trade
//   <sym>@kline_<tf>      authoritative OHLCV (1-2 s) -> reconciles trade-built candles
//   <sym>@depth20@100ms   top-20 order book every 100 ms
//   <sym>@ticker          24h stats every 1 s
//   <pair>@miniTicker     last price + 24h change for the pair tabs
// Updates are buffered and flushed to the app once per animation frame.
// Exposes global `PulseFeed`.
(function (global) {
  "use strict";

  const REST_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];
  const WS_HOSTS = ["wss://stream.binance.com:9443", "wss://data-stream.binance.vision"];
  const INTERVAL_MS = {
    "1s": 1000,
    "1m": 60000,
    "3m": 180000,
    "5m": 300000,
    "15m": 900000,
    "30m": 1800000,
  };
  const HISTORY_LIMIT = 1000;
  const MAX_BARS = 2000;
  const TRIM_TO = 1500;
  const MAX_RETRY_DELAY = 30000;

  let restHost = 0;
  let wsHost = 0;

  async function fetchJson(path, signal) {
    let lastErr = null;
    for (let k = 0; k < REST_HOSTS.length; k++) {
      const idx = (restHost + k) % REST_HOSTS.length;
      try {
        const res = await fetch(REST_HOSTS[idx] + path, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${REST_HOSTS[idx]}`);
        restHost = idx;
        return await res.json();
      } catch (err) {
        if (err.name === "AbortError") throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // Tick sizes and price precision for the given base symbols (e.g. ["BTC", "ETH"]).
  async function fetchSymbolInfo(bases) {
    const symbols = bases.map((b) => `"${b}USDT"`).join(",");
    const data = await fetchJson(`/api/v3/exchangeInfo?symbols=${encodeURIComponent(`[${symbols}]`)}`);
    const info = {};
    for (const s of data.symbols || []) {
      const pf = (s.filters || []).find((f) => f.filterType === "PRICE_FILTER");
      const tick = pf ? parseFloat(pf.tickSize) : 0.01;
      const precision = Math.max(0, Math.min(8, Math.round(-Math.log10(tick))));
      info[s.baseAsset] = { tickSize: tick, precision };
    }
    return info;
  }

  const parseKline = (k) => ({
    time: Math.floor(k[0] / 1000),
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
    takerBuy: +k[9],
    closed: true,
  });

  // Klines in [startMs, endMs) for VWAP seeding; pages through the 1000-row limit.
  async function fetchKlines(base, interval, startMs, endMs) {
    const out = [];
    let from = startMs;
    for (let guard = 0; guard < 4 && from < endMs; guard++) {
      const rows = await fetchJson(
        `/api/v3/klines?symbol=${base}USDT&interval=${interval}&startTime=${from}&endTime=${endMs - 1}&limit=1000`,
      );
      if (!rows.length) break;
      for (const r of rows) out.push(parseKline(r));
      from = rows[rows.length - 1][0] + 1;
      if (rows.length < 1000) break;
    }
    return out;
  }

  function create(handlers) {
    const h = Object.assign(
      {
        onHistory() {},
        onBars() {},
        onDepth() {},
        onTicker() {},
        onMini() {},
        onStatus() {},
        onStats() {},
        onError() {},
      },
      handlers,
    );

    let gen = 0;
    let ws = null;
    let abort = null;
    let symbol = "";
    let interval = "1m";
    let pairs = [];
    let bars = [];
    let retry = 0;
    let retryTimer = 0;
    let timeOffset = 0;
    let rafId = 0;

    // per-frame dirty state
    let changedFrom = -1;
    let resetBars = false;
    let closedTimes = []; // bars whose final kline (x=true) arrived this frame
    let trimmed = []; // bars dropped from the front this frame
    let pendingDepth = null;
    let pendingTicker = null;
    let pendingMinis = null;

    // trades for the live bar that arrived after the last kline snapshot
    let liveTrades = [];

    // stats
    const tradeTimes = [];
    let latency = NaN;
    let lastStatsAt = 0;

    function schedule() {
      if (rafId) return;
      const raf = global.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
      rafId = raf(flush);
    }

    function flush() {
      rafId = 0;
      if (changedFrom >= 0 || resetBars) {
        h.onBars(bars, { from: resetBars ? 0 : changedFrom, reset: resetBars, closedTimes, trimmed });
        changedFrom = -1;
        resetBars = false;
        closedTimes = [];
        trimmed = [];
      }
      if (pendingDepth) {
        h.onDepth(pendingDepth);
        pendingDepth = null;
      }
      if (pendingTicker) {
        h.onTicker(pendingTicker);
        pendingTicker = null;
      }
      if (pendingMinis) {
        h.onMini(pendingMinis);
        pendingMinis = null;
      }
      const now = Date.now();
      if (now - lastStatsAt > 500) {
        lastStatsAt = now;
        while (tradeTimes.length && tradeTimes[0] < now - 1000) tradeTimes.shift();
        h.onStats({ latency, tradesPerSec: tradeTimes.length, host: WS_HOSTS[wsHost] });
      }
    }

    function markChanged(i) {
      if (changedFrom < 0 || i < changedFrom) changedFrom = i;
      if (bars.length > MAX_BARS) {
        trimmed = trimmed.concat(bars.splice(0, bars.length - TRIM_TO));
        resetBars = true;
      }
      schedule();
    }

    function sampleLatency(eventTime) {
      const ms = Date.now() + timeOffset - eventTime;
      if (!Number.isFinite(ms) || ms < 0 || ms > 60000) return;
      latency = Number.isNaN(latency) ? ms : latency * 0.9 + ms * 0.1;
    }

    function bucketOf(ms) {
      const step = INTERVAL_MS[interval];
      return Math.floor(ms / step) * (step / 1000);
    }

    function applyTrade(t) {
      const price = +t.p;
      const qty = +t.q;
      const T = t.T;
      const buyer = !t.m; // m = buyer is maker -> taker sold
      tradeTimes.push(Date.now());
      sampleLatency(t.E);

      const time = bucketOf(T);
      const last = bars[bars.length - 1];
      if (!last || time > last.time) {
        if (last) last.closed = true;
        bars.push({
          time,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: qty,
          takerBuy: buyer ? qty : 0,
          closed: false,
          lastTradeT: T,
        });
        liveTrades = [{ T, price, qty, buyer }];
        markChanged(bars.length - 1);
        return;
      }
      if (time < last.time) return; // late trade for a closed bar; the kline fixes it
      if (price > last.high) last.high = price;
      if (price < last.low) last.low = price;
      if (!(T < last.lastTradeT)) {
        last.close = price;
        last.lastTradeT = T;
      }
      last.volume += qty;
      if (buyer) last.takerBuy += qty;
      liveTrades.push({ T, price, qty, buyer });
      markChanged(bars.length - 1);
    }

    function applyKline(k) {
      const time = Math.floor(k.t / 1000);
      const exact = {
        open: +k.o,
        high: +k.h,
        low: +k.l,
        close: +k.c,
        volume: +k.v,
        takerBuy: +k.V,
      };
      const last = bars[bars.length - 1];
      if (!last || time > last.time) {
        if (last) last.closed = true;
        bars.push(Object.assign({ time, closed: !!k.x, lastTradeT: k.E }, exact));
        if (k.x) closedTimes.push(time);
        liveTrades = [];
        markChanged(bars.length - 1);
        return;
      }
      if (time < last.time) {
        // final values for the previous bar
        const i = bars.length - 2;
        if (i >= 0 && bars[i].time === time) {
          Object.assign(bars[i], exact, { closed: true });
          if (k.x) closedTimes.push(time);
          markChanged(i);
        }
        return;
      }
      // same bar: kline snapshot at k.E plus any trades that arrived after it
      liveTrades = liveTrades.filter((tr) => tr.T > k.E);
      let { high, low, close, volume, takerBuy } = exact;
      let lastT = k.E;
      for (const tr of liveTrades) {
        if (tr.price > high) high = tr.price;
        if (tr.price < low) low = tr.price;
        volume += tr.qty;
        if (tr.buyer) takerBuy += tr.qty;
        if (tr.T >= lastT) {
          close = tr.price;
          lastT = tr.T;
        }
      }
      Object.assign(last, {
        open: exact.open,
        high,
        low,
        close,
        volume,
        takerBuy,
        closed: !!k.x,
        lastTradeT: lastT,
      });
      if (k.x) closedTimes.push(time);
      markChanged(bars.length - 1);
    }

    function parseLevels(levels) {
      return levels.map((l) => [+l[0], +l[1]]);
    }

    function onMessage(ev) {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      const stream = msg.stream || "";
      const d = msg.data;
      if (!d) return;
      if (d.e === "aggTrade") applyTrade(d);
      else if (d.e === "kline") applyKline(d.k);
      else if (stream.endsWith("@depth20@100ms")) {
        pendingDepth = { bids: parseLevels(d.bids), asks: parseLevels(d.asks) };
        schedule();
      } else if (d.e === "24hrTicker") {
        pendingTicker = {
          last: +d.c,
          changePct: +d.P,
          change: +d.p,
          open: +d.o,
          high: +d.h,
          low: +d.l,
          volume: +d.v,
          quoteVolume: +d.q,
          trades: +d.n,
        };
        sampleLatency(d.E);
        schedule();
      } else if (d.e === "24hrMiniTicker") {
        const base = d.s.replace(/USDT$/, "");
        const open = +d.o;
        const last = +d.c;
        pendingMinis = pendingMinis || {};
        pendingMinis[base] = { last, changePct: open ? ((last - open) / open) * 100 : 0 };
        schedule();
      }
    }

    function streamsFor() {
      const s = symbol.toLowerCase() + "usdt";
      const list = [`${s}@aggTrade`, `${s}@kline_${interval}`, `${s}@depth20@100ms`, `${s}@ticker`];
      for (const p of pairs) list.push(`${p.toLowerCase()}usdt@miniTicker`);
      return list.join("/");
    }

    function closeSocket() {
      if (!ws) return;
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch (_) {}
      ws = null;
    }

    function openSocket(myGen) {
      let opened = false;
      const sock = new WebSocket(`${WS_HOSTS[wsHost]}/stream?streams=${streamsFor()}`);
      ws = sock;
      sock.onopen = () => {
        if (myGen !== gen) return;
        opened = true;
        retry = 0;
        h.onStatus({ state: "live" });
      };
      sock.onmessage = onMessage;
      sock.onerror = () => {
        try {
          sock.close();
        } catch (_) {}
      };
      sock.onclose = () => {
        if (myGen !== gen) return;
        ws = null;
        if (!opened) wsHost = (wsHost + 1) % WS_HOSTS.length; // try the other host
        const delay = Math.min(1000 * Math.pow(2, retry), MAX_RETRY_DELAY);
        retry++;
        h.onStatus({ state: "reconnecting", retryIn: delay });
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (myGen === gen) load(myGen, true);
        }, delay);
      };
    }

    async function syncClock(signal) {
      try {
        const t0 = Date.now();
        const data = await fetchJson("/api/v3/time", signal);
        const t1 = Date.now();
        timeOffset = data.serverTime - (t0 + t1) / 2;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        timeOffset = 0;
      }
    }

    async function load(myGen, isReconnect) {
      if (abort) abort.abort();
      abort = new AbortController();
      const { signal } = abort;
      h.onStatus({ state: isReconnect ? "reconnecting" : "connecting" });
      try {
        const sym = symbol.toUpperCase() + "USDT";
        const [hist] = await Promise.all([
          fetchJson(`/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${HISTORY_LIMIT}`, signal),
          syncClock(signal),
        ]);
        if (myGen !== gen) return;
        bars = hist.map(parseKline);
        if (bars.length) bars[bars.length - 1].closed = false;
        liveTrades = [];
        changedFrom = -1;
        resetBars = false;
        closedTimes = [];
        trimmed = [];
        h.onHistory(bars);
      } catch (err) {
        if (err.name === "AbortError" || myGen !== gen) return;
        h.onError(err);
        const delay = Math.min(1000 * Math.pow(2, retry), MAX_RETRY_DELAY);
        retry++;
        h.onStatus({ state: "offline", retryIn: delay });
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (myGen === gen) load(myGen, true);
        }, delay);
        return;
      }
      closeSocket();
      openSocket(myGen);
    }

    return {
      start(base, tf, allPairs) {
        gen++;
        clearTimeout(retryTimer);
        closeSocket();
        symbol = base;
        interval = tf;
        pairs = allPairs || [];
        retry = 0;
        bars = [];
        latency = NaN;
        tradeTimes.length = 0;
        load(gen, false);
      },
      stop() {
        gen++;
        clearTimeout(retryTimer);
        if (abort) abort.abort();
        closeSocket();
      },
      bars: () => bars,
      serverNow: () => Date.now() + timeOffset,
    };
  }

  global.PulseFeed = { create, fetchSymbolInfo, fetchKlines, INTERVAL_MS };
})(typeof window !== "undefined" ? window : globalThis);
