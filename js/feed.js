// js/feed.js -- Binance market-data feed for Pulse Terminal.
// Two venues share one feed engine:
//   spot  (crypto)                 api.binance.com + stream.binance.com, one combined socket
//   perp  (stocks / commodities)   fapi.binance.com + fstream.binance.com, "market" socket for
//                                  trades / klines / ticker and "public" socket for depth
// Streams per instrument:
//   <sym>@aggTrade        real-time trades -> the live candle moves on every trade
//   <sym>@kline_<tf>      authoritative OHLCV -> reconciles trade-built candles
//   <sym>@depth20@100ms   top-20 order book every 100 ms
//   <sym>@ticker          24h stats
// Updates are buffered and flushed to the app once per animation frame.
// Exposes global `PulseFeed`.
(function (global) {
  "use strict";

  const VENUES = {
    spot: {
      rest: ["https://api.binance.com", "https://data-api.binance.vision"],
      prefix: "/api/v3",
      sockets: [{ hosts: ["wss://stream.binance.com:9443", "wss://data-stream.binance.vision"], path: "/stream", kinds: ["trade", "kline", "ticker", "depth"] }],
      intervals: ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"],
      historyLimit: 1000,
    },
    perp: {
      rest: ["https://fapi.binance.com"],
      prefix: "/fapi/v1",
      sockets: [
        { hosts: ["wss://fstream.binance.com"], path: "/market/stream", kinds: ["trade", "kline", "ticker"] },
        { hosts: ["wss://fstream.binance.com"], path: "/public/stream", kinds: ["depth"] },
      ],
      intervals: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"],
      historyLimit: 1000,
    },
  };
  const INTERVAL_MS = {
    "1s": 1000,
    "1m": 60000,
    "3m": 180000,
    "5m": 300000,
    "15m": 900000,
    "30m": 1800000,
    "1h": 3600000,
    "4h": 14400000,
    "1d": 86400000,
    "1w": 604800000,
  };
  const DAY = 86400000;
  const MONDAY_OFFSET = 4 * DAY; // 1970-01-05 was a Monday; Binance weeks start Monday 00:00 UTC

  // Start (unix seconds) of the candle that contains trade time ms.
  function bucketStart(ms, tf) {
    if (tf === "1M") {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    }
    if (tf === "1w") return (Math.floor((ms - MONDAY_OFFSET) / INTERVAL_MS["1w"]) * INTERVAL_MS["1w"] + MONDAY_OFFSET) / 1000;
    const step = INTERVAL_MS[tf];
    return (Math.floor(ms / step) * step) / 1000;
  }
  const MAX_BARS = 2000;
  const TRIM_TO = 1500;
  const MAX_RETRY_DELAY = 30000;

  const restHost = { spot: 0, perp: 0 };

  async function fetchJson(venue, path, signal) {
    const v = VENUES[venue];
    let lastErr = null;
    for (let k = 0; k < v.rest.length; k++) {
      const idx = (restHost[venue] + k) % v.rest.length;
      try {
        const res = await fetch(v.rest[idx] + v.prefix + path, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${v.rest[idx]}`);
        restHost[venue] = idx;
        return await res.json();
      } catch (err) {
        if (err.name === "AbortError") throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  const supports = (venue, tf) => VENUES[venue].intervals.includes(tf);

  // Tick sizes and price precision, keyed by instrument id.
  async function fetchSymbolInfo(instruments) {
    const info = {};
    const byVenue = { spot: [], perp: [] };
    for (const it of instruments) byVenue[it.venue].push(it);
    const jobs = [];
    if (byVenue.spot.length) {
      const list = byVenue.spot.map((i) => `"${i.symbol}"`).join(",");
      jobs.push(fetchJson("spot", `/exchangeInfo?symbols=${encodeURIComponent(`[${list}]`)}`).then((d) => d.symbols || []));
    }
    if (byVenue.perp.length) jobs.push(fetchJson("perp", "/exchangeInfo").then((d) => d.symbols || []));
    const all = [].concat(...(await Promise.all(jobs)));
    const want = new Map(instruments.map((i) => [i.symbol, i.id]));
    for (const s of all) {
      const id = want.get(s.symbol);
      if (!id) continue;
      const pf = (s.filters || []).find((f) => f.filterType === "PRICE_FILTER");
      const tick = pf ? parseFloat(pf.tickSize) : 0.01;
      const precision = Math.max(0, Math.min(8, Math.round(-Math.log10(tick))));
      info[id] = { tickSize: tick, precision };
    }
    return info;
  }

  // Last price and 24h change for a set of instruments of one venue (pair tabs, palette).
  async function fetchTickers(instruments) {
    const out = {};
    const spot = instruments.filter((i) => i.venue === "spot");
    const perp = instruments.filter((i) => i.venue === "perp");
    const rows = [];
    if (spot.length) {
      const list = spot.map((i) => `"${i.symbol}"`).join(",");
      rows.push(...(await fetchJson("spot", `/ticker/24hr?type=MINI&symbols=${encodeURIComponent(`[${list}]`)}`)));
    }
    if (perp.length) rows.push(...(await fetchJson("perp", "/ticker/24hr")));
    const want = new Map(instruments.map((i) => [i.symbol, i.id]));
    for (const r of rows) {
      const id = want.get(r.symbol);
      if (!id) continue;
      const last = +r.lastPrice;
      const open = +r.openPrice;
      out[id] = { last, changePct: open ? ((last - open) / open) * 100 : 0 };
    }
    return out;
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

  // Klines in [startMs, endMs); pages through the 1000-row limit.
  async function fetchKlines(inst, interval, startMs, endMs) {
    const out = [];
    let from = startMs;
    for (let guard = 0; guard < 4 && from < endMs; guard++) {
      const rows = await fetchJson(
        inst.venue,
        `/klines?symbol=${inst.symbol}&interval=${interval}&startTime=${from}&endTime=${endMs - 1}&limit=1000`,
      );
      if (!rows.length) break;
      for (const r of rows) out.push(parseKline(r));
      from = rows[rows.length - 1][0] + 1;
      if (rows.length < 1000) break;
    }
    return out;
  }

  // Latest `limit` klines (used for the multi-timeframe table).
  async function fetchRecentKlines(inst, interval, limit, signal) {
    const rows = await fetchJson(inst.venue, `/klines?symbol=${inst.symbol}&interval=${interval}&limit=${limit}`, signal);
    return rows.map(parseKline);
  }

  function create(handlers) {
    const h = Object.assign(
      {
        onHistory() {},
        onBars() {},
        onDepth() {},
        onTicker() {},
        onStatus() {},
        onStats() {},
        onError() {},
      },
      handlers,
    );

    let gen = 0;
    let sockets = [];
    let abort = null;
    let inst = null;
    let interval = "1m";
    let bars = [];
    let retry = 0;
    let retryTimer = 0;
    let timeOffset = 0;
    let rafId = 0;
    const wsHost = {};

    // per-frame dirty state
    let changedFrom = -1;
    let resetBars = false;
    let closedTimes = []; // bars whose final kline (x=true) arrived this frame
    let trimmed = []; // bars dropped from the front this frame
    let pendingDepth = null;
    let pendingTicker = null;

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
      const now = Date.now();
      if (now - lastStatsAt > 500) {
        lastStatsAt = now;
        while (tradeTimes.length && tradeTimes[0] < now - 1000) tradeTimes.shift();
        h.onStats({ latency, tradesPerSec: tradeTimes.length });
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
      return bucketStart(ms, interval);
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

    const parseLevels = (levels) => (levels || []).map((l) => [+l[0], +l[1]]);

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
        // spot sends bids/asks, futures sends b/a
        pendingDepth = { bids: parseLevels(d.bids || d.b), asks: parseLevels(d.asks || d.a) };
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
      }
    }

    function streamsFor(kinds) {
      const s = inst.symbol.toLowerCase();
      const map = {
        trade: `${s}@aggTrade`,
        kline: `${s}@kline_${interval}`,
        ticker: `${s}@ticker`,
        depth: `${s}@depth20@100ms`,
      };
      return kinds.map((k) => map[k]).join("/");
    }

    function closeSockets() {
      for (const ws of sockets) {
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        try {
          ws.close();
        } catch (_) {}
      }
      sockets = [];
    }

    function openSockets(myGen) {
      const specs = VENUES[inst.venue].sockets;
      let openCount = 0;
      specs.forEach((spec, si) => {
        const key = `${inst.venue}:${si}`;
        const hi = wsHost[key] || 0;
        let opened = false;
        const sock = new WebSocket(`${spec.hosts[hi]}${spec.path}?streams=${streamsFor(spec.kinds)}`);
        sockets.push(sock);
        sock.onopen = () => {
          if (myGen !== gen) return;
          opened = true;
          if (++openCount === specs.length) {
            retry = 0;
            h.onStatus({ state: "live" });
          }
        };
        sock.onmessage = onMessage;
        sock.onerror = () => {
          try {
            sock.close();
          } catch (_) {}
        };
        sock.onclose = () => {
          if (myGen !== gen) return;
          if (!opened) wsHost[key] = (hi + 1) % spec.hosts.length; // try the other host
          // any socket dropping restarts the session (fresh history, then sockets)
          closeSockets();
          const delay = Math.min(1000 * Math.pow(2, retry), MAX_RETRY_DELAY);
          retry++;
          h.onStatus({ state: "reconnecting", retryIn: delay });
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            if (myGen === gen) load(myGen, true);
          }, delay);
        };
      });
    }

    async function syncClock(signal) {
      try {
        const t0 = Date.now();
        const data = await fetchJson(inst.venue, "/time", signal);
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
        const limit = VENUES[inst.venue].historyLimit;
        const [hist] = await Promise.all([
          fetchJson(inst.venue, `/klines?symbol=${inst.symbol}&interval=${interval}&limit=${limit}`, signal),
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
      closeSockets();
      openSockets(myGen);
    }

    return {
      start(instrument, tf) {
        gen++;
        clearTimeout(retryTimer);
        closeSockets();
        inst = instrument;
        interval = tf;
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
        closeSockets();
      },
      bars: () => bars,
      serverNow: () => Date.now() + timeOffset,
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { bucketStart, supports, INTERVAL_MS };
  global.PulseFeed = { create, fetchSymbolInfo, fetchTickers, fetchKlines, fetchRecentKlines, supports, bucketStart, VENUES, INTERVAL_MS };
})(typeof window !== "undefined" ? window : globalThis);
