// js/indicators.js -- pure indicator math with TradingView Pine Script semantics.
// No DOM, no chart library. Works in the browser (global `PulseIndicators`) and in
// Node (`require("./js/indicators.js")`) so the math can be unit-tested.
//
// Pine semantics reproduced here (see tests/indicators.test.js):
// - `na` is NaN. Arithmetic with na yields na; comparisons with na are false.
// - `a / b` with b == 0 yields na.
// - ta.sma: mean of the last `len` non-na values; na bars leave the window as it was.
// - ta.ema / ta.rma: na bars return na and are skipped; seeded with the SMA of the
//   first `len` non-na values, na before that.
// - ta.stoch: from bar_index len-1 on, over the last `len` bars; a flat range (or an
//   na input) repeats the previous value.
// - ta.crossover / ta.crossunder: compared with the most recent earlier bar where both
//   series were non-na.
(function (global) {
  "use strict";

  const NA = NaN;
  const isNa = (v) => v === null || v === undefined || Number.isNaN(v);

  // Pine division: dividing by zero (or by na) yields na.
  function div(a, b) {
    if (isNa(a) || isNa(b) || b === 0) return NA;
    return a / b;
  }

  function sma(src, len) {
    const n = src.length;
    const out = new Array(n).fill(NA);
    const win = [];
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (!isNa(v)) {
        win.push(v);
        if (win.length > len) win.shift();
      }
      if (win.length === len) {
        let sum = 0;
        for (let k = 0; k < len; k++) sum += win[k];
        out[i] = sum / len;
      }
    }
    return out;
  }

  // Shared EMA-style recurrence seeded with an SMA (ta.ema uses 2/(len+1), ta.rma 1/len).
  function seededSmoothing(src, len, alpha) {
    const n = src.length;
    const out = new Array(n).fill(NA);
    let count = 0;
    let seed = 0;
    let prev = NA;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (isNa(v)) continue;
      if (count < len) {
        seed += v;
        count++;
        if (count === len) {
          prev = seed / len;
          out[i] = prev;
        }
        continue;
      }
      prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  const ema = (src, len) => seededSmoothing(src, len, 2 / (len + 1));
  const rma = (src, len) => seededSmoothing(src, len, 1 / len);

  // ta.stoch(source, high, low, len)
  function stoch(source, high, low, len) {
    const n = source.length;
    const out = new Array(n).fill(NA);
    let prev = NA;
    for (let i = 0; i < n; i++) {
      if (i < len - 1) {
        out[i] = prev;
        continue;
      }
      let hi = -Infinity;
      let lo = Infinity;
      let seen = 0;
      for (let k = i; k > i - len && k >= 0; k--) {
        if (!isNa(high[k]) && high[k] > hi) hi = high[k];
        if (!isNa(low[k]) && low[k] < lo) lo = low[k];
        if (!isNa(high[k]) || !isNa(low[k])) seen++;
      }
      const src = source[i];
      if (!seen || isNa(src)) {
        out[i] = prev;
        continue;
      }
      const range = hi - lo;
      if (range === 0) {
        if (src === lo) {
          out[i] = prev;
        } else {
          out[i] = NA;
          prev = NA;
        }
        continue;
      }
      prev = (100 * (src - lo)) / range;
      out[i] = prev;
    }
    return out;
  }

  function cross(a, b, up) {
    const n = a.length;
    const out = new Array(n).fill(false);
    let pa = NA;
    let pb = NA;
    for (let i = 0; i < n; i++) {
      const ca = a[i];
      const cb = b[i];
      if (up) out[i] = pa <= pb && ca > cb;
      else out[i] = pa >= pb && ca < cb;
      if (!isNa(ca) && !isNa(cb)) {
        pa = ca;
        pb = cb;
      }
    }
    return out;
  }
  const crossover = (a, b) => cross(a, b, true);
  const crossunder = (a, b) => cross(a, b, false);

  // ta.rsi(src, len): rma of gains over rma of losses.
  function rsi(src, len) {
    const n = src.length;
    const up = new Array(n).fill(NA);
    const down = new Array(n).fill(NA);
    for (let i = 1; i < n; i++) {
      const ch = src[i] - src[i - 1];
      if (isNa(ch)) continue;
      up[i] = Math.max(ch, 0);
      down[i] = Math.max(-ch, 0);
    }
    const ru = rma(up, len);
    const rd = rma(down, len);
    const out = new Array(n).fill(NA);
    for (let i = 0; i < n; i++) {
      if (isNa(ru[i]) || isNa(rd[i])) continue;
      if (rd[i] === 0) out[i] = 100;
      else if (ru[i] === 0) out[i] = 0;
      else out[i] = 100 - 100 / (1 + ru[i] / rd[i]);
    }
    return out;
  }

  // ta.stdev(src, len) with biased=true (population), as Pine's default.
  function stdev(src, len) {
    const avg = sma(src, len);
    const n = src.length;
    const out = new Array(n).fill(NA);
    for (let i = len - 1; i < n; i++) {
      if (isNa(avg[i])) continue;
      let s = 0;
      let ok = true;
      for (let k = 0; k < len; k++) {
        const v = src[i - k];
        if (isNa(v)) {
          ok = false;
          break;
        }
        s += (v - avg[i]) * (v - avg[i]);
      }
      if (ok) out[i] = Math.sqrt(s / len);
    }
    return out;
  }

  const hlc3 = (bars) => bars.map((b) => (b.high + b.low + b.close) / 3);

  // Session VWAP anchored to the UTC day (Binance spot session), like ta.vwap.
  // `seed` = { day, pv, vol }: sums for the part of the first day before bars[0]
  // (the loaded history can start mid-session on 1s / 1m).
  function vwap(bars, seed) {
    const out = new Array(bars.length).fill(NA);
    let day = null;
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const d = Math.floor(b.time / 86400);
      if (d !== day) {
        day = d;
        const seeded = i === 0 && seed && seed.day === d;
        pv = seeded ? seed.pv : 0;
        vol = seeded ? seed.vol : 0;
      }
      const tp = (b.high + b.low + b.close) / 3;
      pv += tp * b.volume;
      vol += b.volume;
      out[i] = div(pv, vol);
    }
    return out;
  }

  function heikinAshi(bars) {
    const out = new Array(bars.length);
    let po = NA;
    let pc = NA;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const close = (b.open + b.high + b.low + b.close) / 4;
      const open = i === 0 ? (b.open + b.close) / 2 : (po + pc) / 2;
      out[i] = {
        time: b.time,
        open,
        high: Math.max(b.high, open, close),
        low: Math.min(b.low, open, close),
        close,
      };
      po = open;
      pc = close;
    }
    return out;
  }

  function macd(src, fastLen, slowLen, sigLen) {
    const f = ema(src, fastLen);
    const s = ema(src, slowLen);
    const line = f.map((v, i) => v - s[i]);
    const signal = ema(line, sigLen);
    const hist = line.map((v, i) => v - signal[i]);
    return { line, signal, hist };
  }

  function bollinger(src, len, mult) {
    const basis = sma(src, len);
    const dev = stdev(src, len);
    return {
      basis,
      upper: basis.map((v, i) => v + mult * dev[i]),
      lower: basis.map((v, i) => v - mult * dev[i]),
    };
  }

  // ---------------------------------------------------------------------------
  // Market Cipher B -- line-for-line port of the user's Pine Script v6 source.
  // ---------------------------------------------------------------------------
  const MCB_DEFAULTS = Object.freeze({
    showBuySignal: true,
    showSellSignal: true,
    wt_emaLen: 9,
    wt_avgLen: 12,
    wt_maLen: 3,
    mfi_smaLen: 5,
    mfi_signLen: 60,
    rsi_len: 40,
    rsi_k: 2,
    stoch_len: 81,
    stoch_k: 2,
  });

  function marketCipherB(bars, params) {
    const p = Object.assign({}, MCB_DEFAULTS, params || {});
    const n = bars.length;
    const high = bars.map((b) => b.high);
    const low = bars.map((b) => b.low);
    const close = bars.map((b) => b.close);
    const src = hlc3(bars);

    // ===== Wave Calculation =====
    // s = request.security(syminfo.tickerid, timeframe.period, hlc3) -> hlc3
    const x = ema(src, p.wt_emaLen);
    const y = ema(
      src.map((s, i) => Math.abs(s - x[i])),
      p.wt_emaLen,
    );
    const z = src.map((s, i) => div(s - x[i], 0.015 * y[i]));
    const fast = ema(z, p.wt_avgLen);
    const slow = sma(fast, p.wt_maLen);
    const wtVwap = fast.map((v, i) => v - slow[i]);
    const buy = crossover(fast, slow);
    const sell = crossunder(fast, slow);

    // ===== Money Flow =====  (OC()/HL() are declared but unused in the source)
    const m = sma(src, p.mfi_smaLen);
    const f = sma(
      src.map((s, i) => Math.abs(s - m[i])),
      p.mfi_smaLen,
    );
    const mi = src.map((s, i) => div(s - m[i], 0.015 * f[i]));
    const mf = sma(mi, p.mfi_signLen);

    // ===== Stochastic =====
    const rsiLine = sma(stoch(close, high, low, p.rsi_len), p.rsi_k);
    const stochLine = sma(stoch(close, high, low, p.stoch_len), p.stoch_k);

    // ===== Additional Logic =====
    const buySignal = new Array(n);
    const sellSignal = new Array(n);
    for (let i = 0; i < n; i++) {
      buySignal[i] = buy[i] && fast[i] < -60;
      sellSignal[i] = sell[i] && fast[i] > 72;
    }

    return {
      params: p,
      fast,
      slow,
      vwap: wtVwap,
      buy,
      sell,
      mf,
      rsi: rsiLine,
      stoch: stochLine,
      buySignal,
      sellSignal,
    };
  }

  const api = {
    NA,
    isNa,
    div,
    sma,
    ema,
    rma,
    rsi,
    stoch,
    stdev,
    crossover,
    crossunder,
    hlc3,
    vwap,
    heikinAshi,
    macd,
    bollinger,
    marketCipherB,
    MCB_DEFAULTS,
  };

  global.PulseIndicators = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
