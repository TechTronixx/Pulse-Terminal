// js/vpvr-view.js -- VPVR rendering + chart integration for Lightweight Charts v5.
// Depends on global `VPVR` (vpvr.js) and `LightweightCharts`. Exposes global `VPVRView`.
//
// TradingView-VRVP style: right-anchored semi-transparent horizontal bars drawn on an
// overlay canvas (pointer-events:none so chart pan/zoom pass through), POC/VAH/VAL as
// native price lines, value-area shading, and Total / Buy-Sell / Delta modes.
//
// Performance: the profile (bins) is recomputed (debounced) only when the visible
// candle set changes; the redraw runs on requestAnimationFrame and just re-maps bin
// prices to current y via priceToCoordinate, so bars stay glued to the price axis
// during pan without re-binning every frame.
(function (global) {
  "use strict";

  const DEFAULTS = {
    enabled: false,
    rows: 24,
    vaPct: 0.70,
    widthPx: 130,
    mode: "total", // "total" | "buysell" | "delta"
    showPOC: true,
    showVAHVAL: true,
    showVA: true,
    opacity: 0.55,
  };

  const RECOMPUTE_DELAY = 80; // ms debounce on viewport change

  function create(chart, mainSeries, getCandles) {
    const wrapper = document.getElementById("chart-wrapper");
    const chartEl = document.getElementById("chart");
    if (!wrapper || !chartEl || !chart || !mainSeries) return null;

    const state = {
      chart, series: mainSeries, getCandles,
      settings: Object.assign({}, DEFAULTS),
      profile: null,
      canvas: null, ctx: null, dpr: 1, cssW: 0, cssH: 0,
      priceLines: [],
      rafId: 0, recomputeTimer: 0, dirty: false,
      lastSig: "",
      theme: readTheme(),
      ro: null, rangeSub: null, pointerHandler: null, pointerLeaveHandler: null,
      tooltip: null,
      destroyed: false,
    };

    // --- overlay canvas (pointer-events:none so chart stays interactive) ---
    const canvas = document.createElement("canvas");
    canvas.id = "vpvr-canvas";
    canvas.style.cssText =
      "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    wrapper.appendChild(canvas);
    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");

    // --- tooltip ---
    const tooltip = document.createElement("div");
    tooltip.id = "vpvr-tooltip";
    tooltip.className = "vpvr-tooltip";
    wrapper.appendChild(tooltip);
    state.tooltip = tooltip;

    resizeCanvas();

    // --- viewport subscription: recompute (debounced) + redraw (rAF) ---
    state.rangeSub = chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      scheduleRecompute();
      scheduleRedraw();
    });

    // --- resize ---
    state.ro = new ResizeObserver(() => { resizeCanvas(); scheduleRedraw(); });
    state.ro.observe(wrapper);

    // --- pointer tooltip ---
    state.pointerHandler = (e) => onPointerMove(e, state);
    state.pointerLeaveHandler = () => hideTooltip(state);
    wrapper.addEventListener("pointermove", state.pointerHandler);
    wrapper.addEventListener("pointerleave", state.pointerLeaveHandler);

    // public handle
    return {
      setSettings(partial) {
        Object.assign(state.settings, partial);
        state.lastSig = ""; // force recompute on any setting change
        scheduleRecompute();
        scheduleRedraw();
      },
      getSettings() { return Object.assign({}, state.settings); },
      update() { // data changed (live tick / new history)
        state.dirty = true;
        scheduleRecompute();
        scheduleRedraw();
      },
      refreshTheme() {
        state.theme = readTheme();
        applyPriceLines(state); // recreate with refreshed colors
        scheduleRedraw();
      },
      destroy() { destroy(state); },
      recomputeNow() { recompute(state); scheduleRedraw(); },
    };

    // ---------- internals ----------

    function resizeCanvas() {
      const w = wrapper.clientWidth, h = wrapper.clientHeight;
      if (w <= 0 || h <= 0) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      state.dpr = dpr; state.cssW = w; state.cssH = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function scheduleRecompute() {
      if (state.destroyed) return;
      if (state.recomputeTimer) clearTimeout(state.recomputeTimer);
      state.recomputeTimer = setTimeout(() => { state.recomputeTimer = 0; recompute(state); scheduleRedraw(); }, RECOMPUTE_DELAY);
    }

    function scheduleRedraw() {
      if (state.destroyed) return;
      if (state.rafId) return;
      state.rafId = requestAnimationFrame(() => { state.rafId = 0; redraw(state); });
    }

    function visibleCandles() {
      const arr = state.getCandles() || [];
      if (!arr.length) return arr;
      let range = null;
      try { range = state.chart.timeScale().getVisibleRange(); } catch (e) { range = null; }
      if (range && range.from != null && range.to != null) {
        const from = +range.from, to = +range.to;
        return arr.filter((c) => c.time >= from && c.time <= to);
      }
      return arr;
    }

    function recompute(st) {
      if (st.destroyed) return;
      if (!st.settings.enabled) { st.profile = null; applyPriceLines(st); return; }
      const vis = visibleCandles();
      const s = st.settings;
      const sig = vis.length + ":" + (vis.length ? vis[0].time + ":" + vis[vis.length - 1].time + ":" + vis[vis.length - 1].volume + ":" + vis[vis.length - 1].close : "") + ":" + s.rows + ":" + s.vaPct;
      if (sig === st.lastSig && st.profile) { st.dirty = false; return; } // memoized
      st.lastSig = sig;
      st.profile = global.VPVR.computeProfile(vis, { rows: s.rows, vaPct: s.vaPct });
      st.dirty = false;
      applyPriceLines(st);
    }

    function applyPriceLines(st) {
      // remove existing
      for (const pl of st.priceLines) { try { st.series.removePriceLine(pl); } catch (e) {} }
      st.priceLines = [];
      if (!st.settings.enabled || !st.profile || !st.profile.bins.length) return;
      const p = st.profile, t = st.theme, s = st.settings;
      const dash = global.LightweightCharts && global.LightweightCharts.LineStyle ? global.LightweightCharts.LineStyle.Dashed : 2;
      try {
        if (s.showPOC && p.pocPrice != null) {
          st.priceLines.push(st.series.createPriceLine({ price: p.pocPrice, color: t.accent, lineWidth: 1, lineStyle: dash, axisLabelVisible: true, axisLabelTextColor: t.onAccent, title: "POC" }));
        }
        if (s.showVAHVAL) {
          if (p.vah != null) st.priceLines.push(st.series.createPriceLine({ price: p.vah, color: t.muted, lineWidth: 1, lineStyle: dash, axisLabelVisible: true, axisLabelTextColor: t.labelText, title: "VAH" }));
          if (p.val != null) st.priceLines.push(st.series.createPriceLine({ price: p.val, color: t.muted, lineWidth: 1, lineStyle: dash, axisLabelVisible: true, axisLabelTextColor: t.labelText, title: "VAL" }));
        }
      } catch (e) { /* priceLine API guard */ }
    }

    function redraw(st) {
      const ctx = st.ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, st.cssW, st.cssH);
      if (!st.settings.enabled || !st.profile || !st.profile.bins.length) return;
      const p = st.profile, t = st.theme, s = st.settings;

      // plot geometry: exclude right price scale; clip to the price pane (pane 0)
      let psW = 0, paneH = 0;
      try { psW = st.chart.priceScale("right", 0).width(); } catch (e) {}
      try { paneH = st.chart.panes()[0].getHeight(); } catch (e) {}
      const plotRight = st.cssW - psW - 2;
      const plotBottom = paneH || st.cssH;
      if (plotRight <= 0 || plotBottom <= 0) return;

      let maxVol = 0;
      for (const b of p.bins) if (b.total > maxVol) maxVol = b.total;
      if (!(maxVol > 0)) return;

      const widthPx = s.widthPx;

      // --- value area shading band (drawn first, under bars) ---
      if (s.showVA && p.vah != null && p.val != null) {
        const yTop = toY(st, p.vah);
        const yBot = toY(st, p.val);
        if (yTop != null && yBot != null) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = t.accentSubtle;
          ctx.fillRect(0, yTop, plotRight, Math.max(1, yBot - yTop));
        }
      }

      // --- bars ---
      for (const b of p.bins) {
        if (b.total <= 0) continue;
        const yHi = toY(st, b.priceHigh);
        const yLo = toY(st, b.priceLow);
        if (yHi == null || yLo == null) continue;
        let top = yHi, h = yLo - yHi;
        if (h < 1) h = 1; // min 1px so flat/single-bin rows still render
        if (top < -1 || top > plotBottom) continue;
        if (top + h > plotBottom) h = plotBottom - top;
        if (h <= 0) continue;

        if (s.mode === "buysell" && p.hasTaker) {
          const totalW = (b.total / maxVol) * widthPx;
          const buyFrac = b.total > 0 ? b.buy / b.total : 0;
          const sellW = totalW * (1 - buyFrac);
          const buyW = totalW * buyFrac;
          // sell (red) on the left, buy (green) toward the price axis (right)
          ctx.globalAlpha = s.opacity;
          ctx.fillStyle = t.downColor;
          ctx.fillRect(plotRight - totalW, top, Math.max(0, sellW), h);
          ctx.fillStyle = t.upColor;
          ctx.fillRect(plotRight - buyW, top, Math.max(0, buyW), h);
        } else if (s.mode === "delta" && p.hasTaker) {
          const w = (b.total / maxVol) * widthPx;
          ctx.globalAlpha = s.opacity;
          ctx.fillStyle = b.delta > 0 ? t.upColor : b.delta < 0 ? t.downColor : t.muted;
          ctx.fillRect(plotRight - w, top, Math.max(0, w), h);
        } else {
          const w = (b.total / maxVol) * widthPx;
          ctx.globalAlpha = b.isPOC ? Math.min(0.95, s.opacity + 0.35) : s.opacity;
          ctx.fillStyle = b.isPOC ? t.accent : (b.inValueArea ? t.accent : t.muted);
          ctx.fillRect(plotRight - w, top, Math.max(0, w), h);
        }

        // POC emphasis stroke
        if (b.isPOC) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = t.accent;
          ctx.fillRect(plotRight - 2, top, 2, h);
        }
      }
      ctx.globalAlpha = 1;
    }

    function toY(st, price) {
      if (!Number.isFinite(+price)) return null;
      try {
        const y = st.series.priceToCoordinate(+price);
        return Number.isFinite(y) ? y : null;
      } catch (e) { return null; }
    }

    // ---------- tooltip ----------

    function onPointerMove(e, st) {
      if (!st.settings.enabled || !st.profile || !st.profile.bins.length) { hideTooltip(st); return; }
      const rect = wrapper.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = e.clientX - rect.left;
      let paneH = 0;
      try { paneH = st.chart.panes()[0].getHeight(); } catch (err) {}
      if (paneH && y > paneH) { hideTooltip(st); return; }
      let price = null;
      try { price = st.series.coordinateToPrice(y); } catch (err) { price = null; }
      if (!Number.isFinite(+price)) { hideTooltip(st); return; }

      const bins = st.profile.bins;
      let hit = null;
      for (const b of bins) {
        if (+price >= b.priceLow && +price <= b.priceHigh) { hit = b; break; }
      }
      // POC takes priority if the cursor is near its mid
      if (!hit) {
        for (const b of bins) if (b.isPOC) { hit = b; break; }
      }
      if (!hit) { hideTooltip(st); return; }

      const p = st.profile, V = global.VPVR;
      const rows = [];
      rows.push(row("Price", V.formatPrice(hit.priceMid, p.pricePrecision)));
      rows.push(row("Range", V.formatPrice(hit.priceLow, p.pricePrecision) + " - " + V.formatPrice(hit.priceHigh, p.pricePrecision)));
      rows.push(row("Volume", V.formatVolume(hit.total)));
      rows.push(row("% Visible", hit.pctOfTotal.toFixed(2) + "%"));
      if (p.hasTaker) {
        rows.push(row("Buy", V.formatVolume(hit.buy)));
        rows.push(row("Sell", V.formatVolume(hit.sell)));
        rows.push(row("Delta", (hit.delta >= 0 ? "+" : "") + V.formatVolume(hit.delta)));
        rows.push(row("Delta %", hit.deltaPct.toFixed(2) + "%"));
      }
      rows.push(row("Value Area", hit.inValueArea ? "yes" : "no"));
      if (hit.isPOC) rows.push(row("POC", "yes"));

      let html = '<div class="vpvr-tip-title">Volume Profile</div>';
      html += '<table class="vpvr-tip-table">' + rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join("") + "</table>";
      if (p.pocPrice != null) html += '<div class="vpvr-tip-foot">POC ' + V.formatPrice(p.pocPrice, p.pricePrecision) + ' &middot; VA ' + (p.valueAreaVolume / p.totalVolume * 100).toFixed(0) + '%</div>';

      st.tooltip.innerHTML = html;
      st.tooltip.style.display = "block";
      // place near cursor, keep inside wrapper
      const tw = st.tooltip.offsetWidth, th = st.tooltip.offsetHeight;
      let tx = x + 14, ty = y + 14;
      if (tx + tw > st.cssW - 6) tx = x - tw - 14;
      if (ty + th > st.cssH - 6) ty = y - th - 14;
      st.tooltip.style.left = Math.max(4, tx) + "px";
      st.tooltip.style.top = Math.max(4, ty) + "px";
    }

    function row(label, val) { return [label, val]; }

    function hideTooltip(st) { if (st.tooltip) st.tooltip.style.display = "none"; }

    function destroy(st) {
      st.destroyed = true;
      if (st.rafId) cancelAnimationFrame(st.rafId);
      if (st.recomputeTimer) clearTimeout(st.recomputeTimer);
      try { if (state.rangeSub) st.chart.timeScale().unsubscribeVisibleLogicalRangeChange(state.rangeSub); } catch (e) {}
      if (st.ro) st.ro.disconnect();
      wrapper.removeEventListener("pointermove", st.pointerHandler);
      wrapper.removeEventListener("pointerleave", st.pointerLeaveHandler);
      for (const pl of st.priceLines) { try { st.series.removePriceLine(pl); } catch (e) {} }
      st.priceLines = [];
      if (st.canvas && st.canvas.parentNode) st.canvas.parentNode.removeChild(st.canvas);
      if (st.tooltip && st.tooltip.parentNode) st.tooltip.parentNode.removeChild(st.tooltip);
      st.ctx && st.ctx.clearRect(0, 0, st.cssW, st.cssH);
    }
  }

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const get = (v) => cs.getPropertyValue(v).trim();
    return {
      upColor: get("--trading-up") || "#0ecb81",
      downColor: get("--trading-down") || "#f6465d",
      accent: get("--accent") || "#fcd535",
      accentSubtle: get("--accent-subtle") || "rgba(252,213,53,0.12)",
      muted: get("--muted") || "#8b7b6b",
      ink: get("--ink") || "#1c100a",
      surfaceStrong: get("--surface-strong") || "#ecd8c4",
      hairline: get("--hairline") || "#ecd8c4",
      onAccent: get("--on-accent") || "#140904",
      labelText: get("--vpvr-label-text") || "#ffffff",
    };
  }

  global.VPVRView = { create, DEFAULTS };
})(typeof window !== "undefined" ? window : globalThis);
