/* FinOps Value Map — interactive renderer (v2: waste + efficiency dials) */
(() => {
  const LAYER_ORDER = { L1: 0, L2: 1, L3: 2, L4: 3, L5: 4, L6: 5 };
  const NUM_LAYERS = 6;
  const NUM_HANDOVERS = 5;
  const PAD_V = 18;
  const PAD_H = 28;
  const HANDOVER_HEIGHT = 52; // px, vertical slot for each handover strip

  // Computed dynamically after canvas measurement
  let computedRowHeight = 80;

  const ACCENT = {
    forward: { line: "#0D9488", glow: "#5EEAD4" },
    reverse: { line: "#B45309", glow: "#FCD34D" },
  };

  const LAYER_BORDER = {
    L1: "#DC2626",
    L2: "#EA580C",
    L3: "#CA8A04",
    L4: "#16A34A",
    L5: "#2563EB",
    L6: "#7C3AED",
  };

  let cy;
  let mode = "forward";
  let nodesById = {};
  let layersById = {};
  let currentSelection = null;

  // v2 state
  let mapData = null;
  let handovers = []; // [{ id, fromLayer, toLayer, label, defaultEfficiency }]
  let efficiencies = {}; // { "H6-5": 0.70, ... } — current slider values

  const tooltip = document.getElementById("tooltip");

  // ---------- Layout helpers ----------

  function bandTop(order) {
    return PAD_V + order * (computedRowHeight + HANDOVER_HEIGHT);
  }
  function bandCenter(order) {
    return bandTop(order) + computedRowHeight / 2;
  }
  function stripTop(stripIndex) {
    // strip i sits between band i and band i+1
    return bandTop(stripIndex) + computedRowHeight;
  }
  function layerY(layerId) {
    return bandCenter(LAYER_ORDER[layerId]);
  }

  // ---------- Formatting helpers ----------

  function formatMoney(amount) {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
    return `$${amount.toFixed(0)}`;
  }
  function formatPct(frac) {
    return `${Math.round(frac * 100)}%`;
  }

  // ---------- Data loading ----------

  async function loadMap(url = "data/marketplace.json") {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return res.json();
  }

  function buildElements(map) {
    nodesById = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
    layersById = Object.fromEntries(map.layers.map((l) => [l.id, l]));

    const nodes = map.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.label,
        layer: n.layer,
        description: n.description || "",
        examples: n.examples || "",
      },
      classes: `layer-${n.layer}`,
    }));

    const edges = map.edges.map((e, i) => ({
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        note: e.note || "",
      },
    }));

    return [...nodes, ...edges];
  }

  // ---------- Cytoscape style ----------

  function styleSpec() {
    return [
      {
        selector: "node",
        style: {
          shape: "round-rectangle",
          "background-color": "#FFFFFF",
          "border-width": 2,
          "border-color": (ele) => LAYER_BORDER[ele.data("layer")] || "#94A3B8",
          label: "data(label)",
          "text-valign": "center",
          "text-halign": "center",
          color: "#0B1220",
          "font-size": 13,
          "font-weight": 700,
          "font-family": "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, Roboto, sans-serif",
          "text-wrap": "wrap",
          "text-max-width": 100,
          "padding-left": 10,
          "padding-right": 10,
          "padding-top": 8,
          "padding-bottom": 8,
          width: "label",
          height: "label",
          "transition-property": "background-color, border-color, opacity, border-width",
          "transition-duration": "180ms",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.6,
          "line-color": "#64748B",
          "curve-style": "bezier",
          "target-arrow-shape": "none",
          "source-arrow-shape": "none",
          opacity: 0.75,
          "transition-property": "line-color, width, opacity",
          "transition-duration": "180ms",
        },
      },
      { selector: "node.dimmed", style: { opacity: 0.18 } },
      { selector: "edge.dimmed", style: { opacity: 0.06 } },
      { selector: "node.highlighted", style: { "border-width": 3, "background-color": "#FFFFFF" } },
      { selector: "node.selected", style: { "border-width": 4, "background-color": "#0B1220", color: "#F8FAFC" } },
      { selector: "edge.path-forward", style: { "line-color": ACCENT.forward.line, width: 2.6, opacity: 1 } },
      { selector: "node.highlighted.path-forward", style: { "border-color": ACCENT.forward.line, "background-color": "#ECFEF8", color: "#064E3B" } },
      { selector: "node.selected.path-forward", style: { "background-color": ACCENT.forward.line, "border-color": "#0B1220", color: "#FFFFFF" } },
      { selector: "edge.path-reverse", style: { "line-color": ACCENT.reverse.line, width: 2.6, opacity: 1 } },
      { selector: "node.highlighted.path-reverse", style: { "border-color": ACCENT.reverse.line, "background-color": "#FFF7E6", color: "#78350F" } },
      { selector: "node.selected.path-reverse", style: { "background-color": ACCENT.reverse.line, "border-color": "#0B1220", color: "#FFFFFF" } },
    ];
  }

  // ---------- Canvas layout (fills full height with 6 bands + 5 handover strips) ----------

  function layoutFillCanvas() {
    const container = cy.container();
    const cH = container.clientHeight;
    const cW = container.clientWidth;
    if (!cH || !cW) return;

    cy.zoom(1);
    cy.pan({ x: 0, y: 0 });

    const usableH = Math.max(60, cH - 2 * PAD_V);
    const totalStripH = NUM_HANDOVERS * HANDOVER_HEIGHT;
    computedRowHeight = Math.max(50, (usableH - totalStripH) / NUM_LAYERS);

    const byLayer = {};
    cy.nodes().forEach((n) => {
      const layer = n.data("layer");
      (byLayer[layer] = byLayer[layer] || []).push(n);
    });

    let maxNodeW = 0;
    cy.nodes().forEach((n) => {
      const w = n.outerWidth();
      if (w > maxNodeW) maxNodeW = w;
    });
    if (!maxNodeW) maxNodeW = 120;

    const insetX = Math.max(PAD_H, maxNodeW / 2 + 6);
    const spreadW = Math.max(1, cW - 2 * insetX);

    cy.batch(() => {
      Object.entries(byLayer).forEach(([layerId, nodes]) => {
        nodes.sort((a, b) => a.position("x") - b.position("x"));
        const count = nodes.length;
        const y = layerY(layerId);
        nodes.forEach((n, i) => {
          const t = count === 1 ? 0.5 : i / (count - 1);
          const x = insetX + t * spreadW;
          n.position({ x, y });
        });
      });
    });
  }

  function drawLayerBands() {
    const bandsContainer = document.getElementById("layer-bands-bg");
    if (!bandsContainer) return;
    bandsContainer.innerHTML = "";

    const cH = bandsContainer.clientHeight;
    if (!cH) return;

    Object.entries(LAYER_ORDER).forEach(([layerId, order]) => {
      const top = bandTop(order);

      const band = document.createElement("div");
      band.className = "layer-band";
      band.style.top = `${top}px`;
      band.style.height = `${computedRowHeight}px`;
      band.style.background = layersById[layerId]?.tint || "transparent";
      bandsContainer.appendChild(band);

      const label = document.createElement("div");
      label.className = "layer-band-label";
      label.style.top = `${top + computedRowHeight / 2 - 16}px`;
      label.textContent = layersById[layerId]?.name || layerId;
      bandsContainer.appendChild(label);
    });
  }

  // ---------- Handover strips: dial + slider + waste figure ----------

  function dialSVG(efficiency) {
    // Half-circle gauge, 0% = red left, 100% = green right
    const r = 24;
    const cx = 32, cy = 32;
    const startAngle = Math.PI;        // 180° (left)
    const endAngle = 2 * Math.PI;      // 360° (right) → top half arc
    const angle = startAngle + efficiency * (endAngle - startAngle);

    function polar(a, rad) {
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    }

    const [bx1, by1] = polar(startAngle, r);
    const [bx2, by2] = polar(endAngle, r);
    const trackD = `M ${bx1} ${by1} A ${r} ${r} 0 0 1 ${bx2} ${by2}`;

    const [fx, fy] = polar(angle, r);
    const largeArc = (angle - startAngle) > Math.PI ? 1 : 0;
    const fillD = `M ${bx1} ${by1} A ${r} ${r} 0 ${largeArc} 1 ${fx} ${fy}`;

    const color =
      efficiency >= 0.85 ? "#16A34A" :
      efficiency >= 0.6 ? "#F59E0B" :
      "#DC2626";

    return `
      <svg width="64" height="36" viewBox="0 0 64 36" xmlns="http://www.w3.org/2000/svg">
        <path d="${trackD}" stroke="#E2E8F0" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="${fillD}" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>
      </svg>
    `;
  }

  function drawHandoverStrips() {
    const container = document.getElementById("handover-strips");
    if (!container) return;
    container.innerHTML = "";

    handovers.forEach((h) => {
      const eff = efficiencies[h.id];
      // Strip sits between band(toLayer) on top and band(fromLayer) below.
      // Index = order of the upper band (the layer the value is going to).
      const stripIndex = LAYER_ORDER[h.toLayer];
      const top = stripTop(stripIndex);

      const strip = document.createElement("div");
      strip.className = "handover-strip";
      strip.dataset.handoverId = h.id;
      strip.style.top = `${top}px`;
      strip.style.height = `${HANDOVER_HEIGHT}px`;

      strip.innerHTML = `
        <div class="handover-label">
          ${h.label.split(" → ")[0]} → ${h.label.split(" → ")[1]}
          <small>handover efficiency</small>
        </div>
        <div class="handover-dial" id="dial-${h.id}">${dialSVG(eff)}</div>
        <div class="handover-pct" id="pct-${h.id}">${formatPct(eff)}</div>
        <div class="handover-slider-wrap">
          <input class="handover-slider" type="range" min="0" max="100" step="1"
                 value="${Math.round(eff * 100)}" data-handover-id="${h.id}"
                 aria-label="${h.label} efficiency"/>
        </div>
        <div class="handover-waste" id="waste-${h.id}">
          <span class="waste-amt">${formatMoney(0)}</span>
          <small>leaks here</small>
        </div>
      `;

      container.appendChild(strip);
    });

    // Wire up sliders
    container.querySelectorAll(".handover-slider").forEach((slider) => {
      slider.addEventListener("input", (e) => {
        const id = e.target.dataset.handoverId;
        const val = parseInt(e.target.value, 10) / 100;
        efficiencies[id] = val;
        updateSingleHandover(id);
        updateSummaryBanner();
      });
    });

    updateAllHandovers();
    updateSummaryBanner();
  }

  function updateSingleHandover(handoverId) {
    const eff = efficiencies[handoverId];
    const dial = document.getElementById(`dial-${handoverId}`);
    const pct = document.getElementById(`pct-${handoverId}`);
    if (dial) dial.innerHTML = dialSVG(eff);
    if (pct) pct.textContent = formatPct(eff);
  }

  function updateAllHandovers() {
    // Compute waste $ that "leaks" at each handover. Money flowing into a
    // handover equals topLine × product of efficiencies BELOW it (in the
    // bottoms-up flow). The handovers list is ordered L6→L5 first, so
    // handover[0] receives the full $10M; handover[1] receives 10M*e0; etc.
    const topLine = mapData.topLineInvestment || 0;
    let flowingIn = topLine;
    handovers.forEach((h) => {
      const eff = efficiencies[h.id];
      const leaks = flowingIn * (1 - eff);
      const wasteEl = document.querySelector(`#waste-${h.id} .waste-amt`);
      if (wasteEl) wasteEl.textContent = formatMoney(leaks);
      flowingIn = flowingIn * eff;
    });
  }

  function updateSummaryBanner() {
    const topLine = mapData.topLineInvestment || 0;
    const totalEff = handovers.reduce((acc, h) => acc * efficiencies[h.id], 1);
    const effectiveSpend = topLine * totalEff;
    const wasted = topLine - effectiveSpend;

    document.getElementById("sb-spend").textContent = formatMoney(topLine);
    document.getElementById("sb-eff").textContent = formatPct(totalEff);
    document.getElementById("sb-effective").textContent = formatMoney(effectiveSpend);
    document.getElementById("sb-waste").textContent = formatMoney(wasted);

    updateAllHandovers();
  }

  // ---------- URL params (shareable scenarios) ----------

  function loadEfficienciesFromURL() {
    const params = new URLSearchParams(window.location.search);
    handovers.forEach((h) => {
      const raw = params.get(h.id);
      let val = h.defaultEfficiency;
      if (raw !== null) {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) val = parsed;
      }
      efficiencies[h.id] = val;
    });
  }

  function buildShareURL() {
    const url = new URL(window.location.href);
    url.search = "";
    handovers.forEach((h) => {
      url.searchParams.set(h.id, efficiencies[h.id].toFixed(2));
    });
    return url.toString();
  }

  async function copyShareURL() {
    const url = buildShareURL();
    try {
      await navigator.clipboard.writeText(url);
      flashShareButton("Copied!");
    } catch {
      // Fallback: prompt
      window.prompt("Copy this URL to share your scenario:", url);
    }
  }

  function flashShareButton(text) {
    const btn = document.getElementById("share-btn");
    const original = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1300);
  }

  function resetScenario() {
    handovers.forEach((h) => {
      efficiencies[h.id] = h.defaultEfficiency;
      const slider = document.querySelector(`.handover-slider[data-handover-id="${h.id}"]`);
      if (slider) slider.value = Math.round(h.defaultEfficiency * 100);
    });
    handovers.forEach((h) => updateSingleHandover(h.id));
    updateSummaryBanner();
    clearHighlight();
  }

  // ---------- Highlighting (v1, unchanged) ----------

  function highlight(node) {
    cy.elements().removeClass("highlighted selected path-forward path-reverse dimmed");

    const ancestors = node.predecessors("node");
    const descendants = node.successors("node");
    const ancestorsEdges = node.predecessors("edge");
    const descendantsEdges = node.successors("edge");

    const upClass = `path-${mode}`;
    const highlightedNodes = node.union(ancestors).union(descendants);
    const highlightedEdges = ancestorsEdges.union(descendantsEdges);

    cy.elements().difference(highlightedNodes.union(highlightedEdges)).addClass("dimmed");
    highlightedNodes.addClass("highlighted");
    highlightedEdges.addClass(upClass);
    highlightedNodes.not(node).addClass(upClass);
    node.addClass("selected").addClass(upClass);

    currentSelection = node.id();
    updateSidePanel(node, ancestors, descendants);
  }

  function clearHighlight() {
    cy.elements().removeClass("highlighted selected path-forward path-reverse dimmed");
    currentSelection = null;
    showEmptySidePanel();
  }

  function showEmptySidePanel() {
    document.querySelector(".side-empty").hidden = false;
    document.querySelector(".side-detail").hidden = true;
    document.getElementById("side-panel").classList.add("empty");
  }

  function updateSidePanel(node, ancestors, descendants) {
    document.querySelector(".side-empty").hidden = true;
    document.querySelector(".side-detail").hidden = false;
    document.getElementById("side-panel").classList.remove("empty");

    const data = node.data();
    const layer = layersById[data.layer];

    document.getElementById("detail-title").textContent = data.label;
    document.getElementById("detail-layer").textContent = layer?.name || data.layer;
    document.getElementById("detail-desc").textContent = data.description;

    const examplesWrap = document.getElementById("detail-examples-wrap");
    if (data.examples) {
      examplesWrap.hidden = false;
      document.getElementById("detail-examples").textContent = data.examples;
    } else {
      examplesWrap.hidden = true;
    }

    // v2: waste taxonomy for the node's layer
    const wasteWrap = document.getElementById("detail-waste-wrap");
    const wasteList = document.getElementById("detail-waste-list");
    const wasteForms = layer?.wasteForms || [];
    if (wasteForms.length) {
      wasteList.innerHTML = "";
      wasteForms.forEach((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        wasteList.appendChild(li);
      });
      wasteWrap.hidden = false;
    } else {
      wasteWrap.hidden = true;
    }

    const narrative = buildNarrative(data, layer, ancestors.length, descendants.length);
    document.getElementById("detail-narrative").innerHTML = narrative;

    const upList = document.getElementById("chain-up");
    const downList = document.getElementById("chain-down");
    upList.innerHTML = "";
    downList.innerHTML = "";

    ancestors.sort((a, b) => LAYER_ORDER[a.data("layer")] - LAYER_ORDER[b.data("layer")]);
    descendants.sort((a, b) => LAYER_ORDER[a.data("layer")] - LAYER_ORDER[b.data("layer")]);

    ancestors.forEach((n) => {
      const li = document.createElement("li");
      li.textContent = `${layersById[n.data("layer")]?.name?.split(" / ")[0] || ""} · ${n.data("label")}`;
      upList.appendChild(li);
    });
    descendants.forEach((n) => {
      const li = document.createElement("li");
      li.textContent = `${layersById[n.data("layer")]?.name?.split(" / ")[0] || ""} · ${n.data("label")}`;
      downList.appendChild(li);
    });

    document.getElementById("chain-up-count").textContent = ancestors.length;
    document.getElementById("chain-down-count").textContent = descendants.length;
  }

  function buildNarrative(data, layer, upCount, downCount) {
    if (mode === "forward") {
      if (downCount === 0) {
        return `<strong>${data.label}</strong> is a foundation resource — every business outcome above it is built on top of resources like this.`;
      }
      if (upCount === 0) {
        return `<strong>${data.label}</strong> sits at the top of the value chain. <strong>${downCount}</strong> tech components below contribute to delivering it.`;
      }
      return `<strong>Forward view:</strong> using <strong>${data.label}</strong> contributes to <strong>${upCount}</strong> upstream value drivers and depends on <strong>${downCount}</strong> components below.`;
    } else {
      if (downCount === 0) {
        return `<strong>Reverse view:</strong> if <strong>${data.label}</strong> degrades, every business outcome shown above is at risk.`;
      }
      if (upCount === 0) {
        return `<strong>Reverse view:</strong> if any of the <strong>${downCount}</strong> tech components below fails or is removed, <strong>${data.label}</strong> is at risk.`;
      }
      return `<strong>Reverse view:</strong> a problem at <strong>${data.label}</strong> can break <strong>${upCount}</strong> upstream value drivers and depends on <strong>${downCount}</strong> components below staying healthy.`;
    }
  }

  function setMode(newMode) {
    mode = newMode;
    document.body.classList.toggle("mode-reverse", mode === "reverse");
    document.body.classList.toggle("mode-forward", mode === "forward");
    document.getElementById("mode-forward").classList.toggle("active", mode === "forward");
    document.getElementById("mode-reverse").classList.toggle("active", mode === "reverse");
    document.getElementById("mode-forward").setAttribute("aria-selected", mode === "forward");
    document.getElementById("mode-reverse").setAttribute("aria-selected", mode === "reverse");

    if (currentSelection) {
      const node = cy.getElementById(currentSelection);
      if (node && node.length) highlight(node);
    }
  }

  function attachInteractions() {
    cy.on("tap", "node", (evt) => highlight(evt.target));
    cy.on("tap", (evt) => { if (evt.target === cy) clearHighlight(); });

    cy.on("mouseover", "node", (evt) => {
      const n = evt.target;
      const layer = layersById[n.data("layer")];
      tooltip.textContent = `${n.data("label")} — ${layer?.name || ""}`;
      tooltip.hidden = false;
    });
    cy.on("mouseout", "node", () => { tooltip.hidden = true; });
    document.addEventListener("mousemove", (e) => {
      if (tooltip.hidden) return;
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY}px`;
    });

    document.getElementById("mode-forward").addEventListener("click", () => setMode("forward"));
    document.getElementById("mode-reverse").addEventListener("click", () => setMode("reverse"));
    document.getElementById("reset-btn").addEventListener("click", () => resetScenario());
    document.getElementById("share-btn").addEventListener("click", () => copyShareURL());
  }

  // ---------- Init ----------

  async function init() {
    if (typeof cytoscape === "undefined") {
      console.error("Cytoscape not loaded");
      return;
    }
    if (typeof cytoscapeDagre !== "undefined") {
      cytoscape.use(cytoscapeDagre);
    }

    mapData = await loadMap();
    handovers = mapData.handovers || [];
    loadEfficienciesFromURL();

    document.title = mapData.title ? `${mapData.title} — FinOps Value Map` : "FinOps Value Map";

    cy = cytoscape({
      container: document.getElementById("cy"),
      elements: buildElements(mapData),
      style: styleSpec(),
      layout: {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 24,
        edgeSep: 10,
        rankSep: 50,
        ranker: "network-simplex",
        animate: false,
      },
      userPanningEnabled: false,
      userZoomingEnabled: false,
      autoungrabify: true,
      boxSelectionEnabled: false,
    });

    cy.ready(() => {
      requestAnimationFrame(() => {
        layoutFillCanvas();
        drawLayerBands();
        drawHandoverStrips();
      });
    });

    attachInteractions();
    setMode("forward");

    window.addEventListener("resize", () => {
      layoutFillCanvas();
      drawLayerBands();
      drawHandoverStrips();
    });
  }

  init().catch((err) => {
    console.error(err);
    document.getElementById("cy").innerHTML =
      `<div style="padding:24px;color:#B91C1C">Failed to load map data: ${err.message}</div>`;
  });
})();
