/* FinOps Value Map — interactive renderer */
(() => {
  const LAYER_ORDER = { L1: 0, L2: 1, L3: 2, L4: 3, L5: 4, L6: 5 };
  const NUM_LAYERS = 6;
  const PAD_V = 18;
  const PAD_H = 28;

  // Computed dynamically after canvas measurement
  let computedRowHeight = 120;

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

  const tooltip = document.getElementById("tooltip");

  function layerY(layerId) {
    return PAD_V + LAYER_ORDER[layerId] * computedRowHeight + computedRowHeight / 2;
  }

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
          "font-size": 14,
          "font-weight": 700,
          "font-family": "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, Roboto, sans-serif",
          "text-wrap": "wrap",
          "text-max-width": 110,
          "padding-left": 12,
          "padding-right": 12,
          "padding-top": 10,
          "padding-bottom": 10,
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
          opacity: 0.8,
          "transition-property": "line-color, width, opacity",
          "transition-duration": "180ms",
        },
      },

      // Dimmed (non-selected) state
      { selector: "node.dimmed", style: { opacity: 0.18 } },
      { selector: "edge.dimmed", style: { opacity: 0.06 } },

      // Highlighted nodes
      {
        selector: "node.highlighted",
        style: {
          "border-width": 3,
          "background-color": "#FFFFFF",
        },
      },

      // Selected (the clicked) node
      {
        selector: "node.selected",
        style: {
          "border-width": 4,
          "background-color": "#0B1220",
          color: "#F8FAFC",
        },
      },

      // Forward mode highlight
      {
        selector: "edge.path-forward",
        style: {
          "line-color": ACCENT.forward.line,
          width: 2.6,
          opacity: 1,
        },
      },
      {
        selector: "node.highlighted.path-forward",
        style: {
          "border-color": ACCENT.forward.line,
          "background-color": "#ECFEF8",
          color: "#064E3B",
        },
      },
      {
        selector: "node.selected.path-forward",
        style: {
          "background-color": ACCENT.forward.line,
          "border-color": "#0B1220",
          color: "#FFFFFF",
        },
      },

      // Reverse mode highlight
      {
        selector: "edge.path-reverse",
        style: {
          "line-color": ACCENT.reverse.line,
          width: 2.6,
          opacity: 1,
        },
      },
      {
        selector: "node.highlighted.path-reverse",
        style: {
          "border-color": ACCENT.reverse.line,
          "background-color": "#FFF7E6",
          color: "#78350F",
        },
      },
      {
        selector: "node.selected.path-reverse",
        style: {
          "background-color": ACCENT.reverse.line,
          "border-color": "#0B1220",
          color: "#FFFFFF",
        },
      },
    ];
  }

  // Lay out nodes in screen-space so the 6 layers fill the canvas height
  // and nodes spread evenly across the canvas width. Uses dagre's relative
  // X ordering (which minimizes edge crossings) but rescales to fit the
  // actual container dimensions.
  function layoutFillCanvas() {
    const container = cy.container();
    const cH = container.clientHeight;
    const cW = container.clientWidth;
    if (!cH || !cW) return;

    // Pin zoom first so width/height measurements are at 1:1
    cy.zoom(1);
    cy.pan({ x: 0, y: 0 });

    const usableH = Math.max(60, cH - 2 * PAD_V);
    computedRowHeight = usableH / NUM_LAYERS;

    // Group nodes by layer
    const byLayer = {};
    cy.nodes().forEach((n) => {
      const layer = n.data("layer");
      (byLayer[layer] = byLayer[layer] || []).push(n);
    });

    // Find max node width across all rows to inset from edges
    let maxNodeW = 0;
    cy.nodes().forEach((n) => {
      const w = n.outerWidth();
      if (w > maxNodeW) maxNodeW = w;
    });
    if (!maxNodeW) maxNodeW = 130; // safety fallback

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

    const containerHeight = bandsContainer.clientHeight;
    if (!containerHeight) return;

    const rowH = (containerHeight - 2 * PAD_V) / NUM_LAYERS;

    Object.entries(LAYER_ORDER).forEach(([layerId, order]) => {
      const top = PAD_V + order * rowH;

      const band = document.createElement("div");
      band.className = "layer-band";
      band.style.top = `${top}px`;
      band.style.height = `${rowH}px`;
      band.style.background = layersById[layerId]?.tint || "transparent";
      bandsContainer.appendChild(band);

      const label = document.createElement("div");
      label.className = "layer-band-label";
      label.style.top = `${top + rowH / 2 - 16}px`;
      label.textContent = layersById[layerId]?.name || layerId;
      bandsContainer.appendChild(label);
    });
  }

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

    // Re-apply highlighting in new mode if there's a selection
    if (currentSelection) {
      const node = cy.getElementById(currentSelection);
      if (node && node.length) highlight(node);
    }
  }

  function attachInteractions() {
    cy.on("tap", "node", (evt) => {
      highlight(evt.target);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) clearHighlight();
    });

    cy.on("mouseover", "node", (evt) => {
      const n = evt.target;
      const layer = layersById[n.data("layer")];
      tooltip.textContent = `${n.data("label")} — ${layer?.name || ""}`;
      tooltip.hidden = false;
    });
    cy.on("mouseout", "node", () => {
      tooltip.hidden = true;
    });
    document.addEventListener("mousemove", (e) => {
      if (tooltip.hidden) return;
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY}px`;
    });

    cy.on("pan zoom resize", () => drawLayerBands());

    document.getElementById("mode-forward").addEventListener("click", () => setMode("forward"));
    document.getElementById("mode-reverse").addEventListener("click", () => setMode("reverse"));
    document.getElementById("reset-btn").addEventListener("click", () => clearHighlight());
  }

  async function init() {
    if (typeof cytoscape === "undefined") {
      console.error("Cytoscape not loaded");
      return;
    }
    // Register dagre layout
    if (typeof cytoscapeDagre !== "undefined") {
      cytoscape.use(cytoscapeDagre);
    }

    const map = await loadMap();
    document.title = map.title ? `${map.title} — FinOps Value Map` : "FinOps Value Map";

    cy = cytoscape({
      container: document.getElementById("cy"),
      elements: buildElements(map),
      style: styleSpec(),
      layout: {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 28,
        edgeSep: 12,
        rankSep: 60,
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
      });
    });

    attachInteractions();
    setMode("forward");

    window.addEventListener("resize", () => {
      layoutFillCanvas();
      drawLayerBands();
    });
  }

  init().catch((err) => {
    console.error(err);
    document.getElementById("cy").innerHTML =
      `<div style="padding:24px;color:#B91C1C">Failed to load map data: ${err.message}</div>`;
  });
})();
