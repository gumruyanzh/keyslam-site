(() => {
  "use strict";

  // Injected per page by scripts/site/build.py.
  const CONFIG = Object.assign({ downloadURL: "", buyURL: "", price: "$3.99", defaultPack: "mx-blue", base: "", preload: false }, window.KS_CONFIG || {});

  const ORDER = ["mx-blue", "mx-brown", "mx-red", "mx-black", "gateron-red", "topre", "leopold", "whitefox", "rainy-75", "unicomp", "model-f", "vintage-technics", "laptop", "selectric", "olivetti"];
  const TINT = {
    "mx-blue": "#2f6fe8", "mx-brown": "#8f5b2e", "mx-red": "#e0392d", "topre": "#9d9c96", "leopold": "#22365e",
    "whitefox": "#aeb2bb", "vintage-technics": "#c9ae73", "laptop": "#44464c", "selectric": "#4e7239", "olivetti": "#8a8e95",
    // 1.0.1 packs, matched to their keycaps (scripts/render-keycaps.swift).
    "mx-black": "#5a5c66", "gateron-red": "#b0223a", "rainy-75": "#9a8fd1", "unicomp": "#8e9bb0", "model-f": "#a89f88",
  };
  const dataEl = document.getElementById("pack-data");
  const PACKS = dataEl ? JSON.parse(dataEl.textContent).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)) : [];
  if (!PACKS.length) return;
  const byId = Object.fromEntries(PACKS.map((p) => [p.id, p]));
  const TIERS = ["soft", "medium", "hard", "slam"];
  const TIER_NAMES = ["Soft", "Medium", "Hard", "Slam"];
  const CENTERS = [0.4, 1, 2.2, 4]; // same as the Mac app
  const STEP_GAIN = 1.6;
  const MODES = { soft: 0.4, medium: 1, hard: 2.2, slam: 4 };
  const $ = (id) => document.getElementById(id);
  const keyImage = (id) => `${CONFIG.base}assets/keys/${id}.webp`;

  const state = {
    pack: byId[CONFIG.defaultPack] ? CONFIG.defaultPack : PACKS[0].id, mode: "natural", volume: 0.9, muted: false,
    ctx: null, master: null, loaded: new Map(), loading: new Map(), down: new Map(), lastKeydown: 0,
  };

  // Approximate key positions (MacBook ANSI, key units) for stereo placement.
  const keyX = new Map();
  [["`1234567890-=", 0.5], ["qwertyuiop[]\\", 2.0], ["asdfghjkl;'", 2.25], ["zxcvbnm,./", 2.75]].forEach(([row, start]) => {
    const names = { "`": "Backquote", "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash",
      ";": "Semicolon", "'": "Quote", ",": "Comma", ".": "Period", "/": "Slash" };
    [...row].forEach((ch, i) => keyX.set(/[a-z]/.test(ch) ? "Key" + ch.toUpperCase() : /\d/.test(ch) ? "Digit" + ch : names[ch], start + i));
  });
  Object.entries({ Backspace: 14, Tab: 0.75, CapsLock: 0.9, Enter: 14, ShiftLeft: 1.2, ShiftRight: 13.9, Space: 7.25,
    MetaLeft: 3.75, MetaRight: 10.75, AltLeft: 2.5, AltRight: 12, ControlLeft: 1.5, ArrowLeft: 12.9, ArrowRight: 14.6 })
    .forEach(([code, x]) => keyX.set(code, x));
  const panFor = (code) => (((keyX.get(code) ?? 7.25) / 14.5) - 0.5) * 2 * 0.3;

  // ---- Audio ----
  function audio() {
    if (!state.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { state.ctx = new AC({ latencyHint: "interactive" }); } catch { state.ctx = new AC(); }
      state.master = state.ctx.createGain();
      state.master.gain.value = state.muted ? 0 : state.volume;
      state.master.connect(state.ctx.destination);
    }
    return state.ctx;
  }
  function unlock() { const c = audio(); if (c && c.state !== "running") c.resume().catch(() => {}); }
  function setGain() { if (state.master) state.master.gain.setTargetAtTime(state.muted ? 0 : state.volume, state.ctx.currentTime, 0.015); }
  function decode(ctx, data) {
    return new Promise((resolve, reject) => {
      const r = ctx.decodeAudioData(data, resolve, reject);
      if (r && typeof r.then === "function") r.then(resolve, reject);
    });
  }
  function loadPack(id) {
    if (state.loaded.has(id)) return Promise.resolve(state.loaded.get(id));
    if (state.loading.has(id)) return state.loading.get(id);
    const job = (async () => {
      const ctx = audio();
      if (!ctx) throw new Error("this browser has no Web Audio");
      const [meta, data] = await Promise.all([
        fetch(`${CONFIG.base}sounds/${id}.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        fetch(`${CONFIG.base}sounds/${byId[id].audio}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
      ]);
      const pack = { meta, buffer: await decode(ctx, data) };
      state.loaded.set(id, pack);
      return pack;
    })();
    state.loading.set(id, job);
    job.catch(() => {}).finally(() => state.loading.delete(id));
    return job;
  }

  const groupFor = (code) => code === "Space" ? "space" : (code === "Enter" || code === "NumpadEnter") ? "enter"
    : (code === "Backspace" || code === "Delete") ? "backspace" : /^(Shift|Control|Alt|Meta|CapsLock|Tab|Fn)/.test(code) ? "modifier" : "alpha";
  function hash(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function positionFor(r) {
    const logs = CENTERS.map(Math.log2), x = Math.log2(Math.max(r, 1e-4));
    if (x <= logs[0]) return 0;
    if (x >= logs[3]) return 3;
    for (let i = 0; i < 3; i++) if (x < logs[i + 1]) return i + (x - logs[i]) / (logs[i + 1] - logs[i]);
    return 3;
  }
  function blend(p) {
    p = Math.min(3, Math.max(0, p));
    const lo = Math.floor(p), f = p - lo;
    if (lo >= 3 || f < 1e-4) return [[Math.min(lo, 3), 1]];
    return [[lo, Math.cos(f * Math.PI / 2)], [lo + 1, Math.sin(f * Math.PI / 2)]];
  }
  const edgeGain = (r) => r < 0.4 ? Math.max(0.45, Math.sqrt(r / 0.4)) : r > 4 ? Math.min(1.25, Math.pow(r / 4, 0.25)) : 1;
  function takes(pack, group, tier) {
    const down = (pack.meta.groups[group] || pack.meta.groups.alpha).down;
    if (down[TIERS[tier]]?.length) return { list: down[TIERS[tier]], gain: 1 };
    for (let d = 1; d < 4; d++) for (const s of [tier - d, tier + d]) {
      if (s >= 0 && s < 4 && down[TIERS[s]]?.length) return { list: down[TIERS[s]], gain: Math.pow(STEP_GAIN, tier - s) };
    }
    return null;
  }
  function voice(buffer, seg, gain, pan, rate) {
    const ctx = state.ctx, src = ctx.createBufferSource(), amp = ctx.createGain();
    src.buffer = buffer; src.playbackRate.value = rate; amp.gain.value = gain; src.connect(amp);
    let out = amp;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; amp.connect(p); out = p; }
    out.connect(state.master);
    src.onended = () => { src.disconnect(); out.disconnect(); };
    src.start(ctx.currentTime, seg[0], seg[1]);
  }
  function relativeFor(group) {
    if (state.mode === "natural") return Math.exp(gauss() * 0.33) * ((group === "space" || group === "enter") ? 1.35 : 1);
    return MODES[state.mode] * Math.exp(gauss() * 0.06);
  }

  function strike(code, forced) {
    unlock();
    const group = groupFor(code);
    const relative = forced ?? relativeFor(group);
    const position = positionFor(relative);
    react(position, relative);
    state.down.set(code, relative);
    const pack = state.loaded.get(state.pack);
    if (!pack) { loadPack(state.pack).catch(() => {}); return; }
    if (!state.ctx) return;
    const h = hash(code);
    const rate = (1 + ((((h >>> 8) % 2001) - 1000) / 1000) * 0.012) * (1 + (Math.random() * 2 - 1) * 0.004);
    const jitter = 1 + (Math.random() * 2 - 1) * 0.06;
    for (const [tier, w] of blend(position)) {
      const t = takes(pack, group, tier);
      if (t) voice(pack.buffer, t.list[h % t.list.length], w * t.gain * edgeGain(relative) * jitter, panFor(code), rate);
    }
  }
  function release(code) {
    const relative = state.down.get(code);
    state.down.delete(code);
    const pack = state.loaded.get(state.pack);
    if (relative === undefined || !pack || !state.ctx) return;
    const g = pack.meta.groups[groupFor(code)] || pack.meta.groups.alpha;
    const ups = (g.up?.length ? g.up : pack.meta.groups.alpha.up) || [];
    if (!ups.length) return;
    const h = hash(code);
    voice(pack.buffer, ups[h % ups.length], 0.8 * Math.min(1.3, Math.max(0.5, Math.sqrt(relative))) * (1 + (Math.random() * 2 - 1) * 0.05), panFor(code), 1);
  }
  function tap(code, forced, hold = 80) { strike(code, forced); setTimeout(() => release(code), hold); }

  // ---- Visual reaction ----
  const stage = $("stage");
  const clusterMain = () => document.querySelector("#cluster .main");
  const meterBars = [...document.querySelectorAll("#meter i")];
  const meterText = $("meter-text");
  let hitTimer;
  function react(position, relative) {
    const tier = Math.round(position);
    meterBars.forEach((b, i) => b.style.setProperty("--fill", `${Math.round(Math.max(0, Math.min(1, position - i + 1)) * 100)}%`));
    if (meterText) meterText.textContent = `${TIER_NAMES[tier]} · ${relative.toFixed(1)}× typical`;
    for (const el of [stage, clusterMain()]) el?.classList.add("hit");
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => { stage?.classList.remove("hit"); clusterMain()?.classList.remove("hit"); }, 70);
    if (stage && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const ring = document.createElement("span");
      ring.className = "ring";
      ring.style.setProperty("--ring", `var(--${TIERS[tier]})`);
      ring.style.setProperty("--grow", (1.05 + position * 0.22).toFixed(2));
      ring.addEventListener("animationend", () => ring.remove());
      stage.appendChild(ring);
    }
  }

  // ---- Packs UI ----
  const note = $("note");
  const defaultNote = note?.textContent || "";

  function buildTiles() {
    const tiles = $("tiles");
    if (!tiles) return;
    if (tiles.children.length) { // rendered by build.py
      for (const b of tiles.querySelectorAll("[data-pack]")) b.addEventListener("click", () => selectPack(b.dataset.pack, true));
      return;
    }
    for (const pack of PACKS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tile"; b.dataset.pack = pack.id;
      b.innerHTML = `<img alt="" width="92" height="92" decoding="async"><strong></strong><span></span>`;
      b.querySelector("img").src = keyImage(pack.id);
      b.querySelector("img").alt = `${pack.name} keycap`;
      b.querySelector("strong").textContent = pack.name;
      b.querySelector("span").textContent = pack.kind;
      b.addEventListener("click", () => selectPack(pack.id, true));
      tiles.appendChild(b);
    }
  }

  function buildCredits() {
    const credits = $("credits-list");
    if (!credits || credits.children.length) return;
    for (const pack of PACKS) for (const s of pack.sources) {
      const li = document.createElement("li");
      li.innerHTML = `<b></b>: <a target="_blank" rel="noopener"></a> by <span></span> (CC0)`;
      li.querySelector("b").textContent = pack.name;
      const a = li.querySelector("a"); a.href = s.url; a.textContent = `“${s.title}”`;
      li.querySelector("span").textContent = s.user;
      credits.appendChild(li);
    }
  }

  function buildCluster() {
    const cluster = $("cluster");
    if (!cluster) return;
    if (cluster.children.length) { // rendered by build.py
      cluster.querySelector(".main")?.addEventListener("click", () => tap("KeyK"));
      for (const b of cluster.querySelectorAll("[data-cluster]")) b.addEventListener("click", () => selectPack(b.dataset.cluster, true));
      return;
    }
    const others = ["mx-red", "topre", "olivetti", "laptop", "selectric"].filter((id) => byId[id] && id !== state.pack);
    const main = document.createElement("button");
    main.type = "button"; main.className = "main"; main.setAttribute("aria-label", "Play the selected keyboard");
    main.innerHTML = `<img alt="" width="260" height="260">`;
    main.addEventListener("click", () => tap("KeyK"));
    cluster.appendChild(main);
    others.slice(0, 5).forEach((id, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "s" + (i + 1); b.dataset.cluster = id;
      b.setAttribute("aria-label", `Play ${byId[id].name}`);
      b.innerHTML = `<img alt="" width="140" height="140" decoding="async">`;
      b.querySelector("img").src = keyImage(id);
      b.addEventListener("click", () => selectPack(id, true));
      cluster.appendChild(b);
    });
  }

  function showPack() {
    const pack = byId[state.pack];
    document.documentElement.style.setProperty("--pack", TINT[pack.id] || "var(--accent)");
    for (const id of ["stage-img", "strike-img"]) { const img = $(id); if (img) { img.src = keyImage(pack.id); img.alt = `${pack.name} keycap`; } }
    const main = clusterMain()?.querySelector("img");
    if (main) { main.src = keyImage(pack.id); main.alt = `${pack.name} keycap`; }
    if ($("who-name")) $("who-name").textContent = pack.name;
    if ($("who-summary")) $("who-summary").textContent = `${pack.kind} · ${pack.summary}`;
    const src = $("who-source");
    if (src) { src.href = pack.sources[0].url; src.textContent = `Recorded by ${pack.sources[0].user} · ${pack.takes} takes ↗`; }
    for (const el of document.querySelectorAll("[data-pack]")) el.setAttribute("aria-pressed", String(el.dataset.pack === state.pack));
  }

  async function selectPack(id, audition) {
    state.pack = id;
    showPack();
    unlock();
    try {
      await loadPack(id);
      if (note) { note.textContent = defaultNote; note.removeAttribute("data-tone"); }
      if (audition && state.pack === id) phrase();
    } catch (error) {
      if (note) { note.textContent = `This board couldn't load (${error.message}). Reload the page to try again.`; note.dataset.tone = "error"; }
    }
  }

  let phraseTimers = [];
  function phrase() {
    phraseTimers.forEach(clearTimeout); phraseTimers = [];
    let t = 0;
    for (const ch of "thock click clack") {
      const code = ch === " " ? "Space" : "Key" + ch.toUpperCase();
      phraseTimers.push(setTimeout(() => tap(code, undefined, 70), t));
      t += ch === " " ? 170 : 95 + Math.random() * 55;
    }
  }

  // Any element with data-play-pack plays that board (articles, the sound test, cards).
  for (const el of document.querySelectorAll("[data-play-pack]")) {
    el.addEventListener("click", (e) => { e.preventDefault(); selectPack(el.dataset.playPack, true); });
  }

  // ---- Keyboard input (anywhere on the page, including the type box) ----
  const typebox = $("typebox");
  // Any field marked data-keyslam-type plays sounds like the tester's type box.
  const soundField = (t) => t === typebox || (t instanceof HTMLElement && !!t.closest("[data-keyslam-type]"));
  const hasTester = !!(stage || typebox || document.querySelector("[data-keyslam-type]"));
  function otherField(target) {
    return !soundField(target) && target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }
  if (hasTester) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || otherField(e.target) || !e.code || e.metaKey || e.ctrlKey) return;
      const activating = e.target instanceof HTMLElement && e.target.closest("button, a, summary, [role='button']");
      if (activating && (e.code === "Space" || e.code === "Enter")) return;
      if (!soundField(e.target) && !activating && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
      state.lastKeydown = performance.now();
      strike(e.code);
    });
    window.addEventListener("keyup", (e) => {
      if (otherField(e.target)) return;
      release(e.code);
      if (e.key === "Meta") for (const code of [...state.down.keys()]) release(code);
    });
    window.addEventListener("blur", () => { for (const code of [...state.down.keys()]) release(code); });
  }
  // Phone keyboards often skip keydown details; fall back to input events.
  document.addEventListener("input", (e) => {
    if (!soundField(e.target) || performance.now() - state.lastKeydown < 80) return;
    const code = e.inputType === "deleteContentBackward" ? "Backspace" : e.inputType === "insertLineBreak" ? "Enter"
      : e.data === " " ? "Space" : "Key" + (((e.data || "k").slice(-1).toUpperCase().match(/[A-Z]/) || ["K"])[0]);
    tap(code, undefined, 60);
  });
  stage?.addEventListener("pointerdown", (e) => { e.preventDefault(); tap("KeyK"); });

  // ---- Controls ----
  for (const input of document.querySelectorAll('input[name="mode"]')) input.addEventListener("change", () => { state.mode = input.value; });
  $("volume")?.addEventListener("input", (e) => { state.volume = Number(e.target.value); setGain(); });
  const soundBtn = $("sound");
  soundBtn?.addEventListener("click", () => {
    state.muted = !state.muted;
    soundBtn.setAttribute("aria-pressed", String(!state.muted));
    soundBtn.textContent = state.muted ? "🔇 Sound off" : "🔊 Sound on";
    unlock(); setGain();
  });

  // ---- Force chart ----
  const chart = $("chart");
  if (chart) {
    const NS = "http://www.w3.org/2000/svg";
    const P = { x0: 52, x1: 620, y0: 40, y1: 226, lmin: -2, lmax: 3 };
    const sx = (l) => P.x0 + ((l - P.lmin) / (P.lmax - P.lmin)) * (P.x1 - P.x0);
    const sy = (w) => P.y1 - w * (P.y1 - P.y0);
    const svg = (tag, attrs, text) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text !== undefined) el.textContent = text;
      chart.appendChild(el);
      return el;
    };
    const weightAt = (tier, l) => { for (const [t, w] of blend(positionFor(Math.pow(2, l)))) if (t === tier) return w; return 0; };
    svg("line", { class: "axis", x1: P.x0, x2: P.x1, y1: P.y1, y2: P.y1 });
    svg("line", { class: "axis", x1: P.x0, x2: P.x1, y1: P.y0, y2: P.y0, "stroke-dasharray": "2 4" });
    svg("text", { class: "tick", x: P.x0 - 8, y: P.y1 + 4, "text-anchor": "end" }, "0%");
    svg("text", { class: "tick", x: P.x0 - 8, y: P.y0 + 4, "text-anchor": "end" }, "100%");
    for (const [l, label] of [[-2, "¼×"], [-1, "½×"], [0, "1×"], [1, "2×"], [2, "4×"], [3, "8×"]]) {
      svg("line", { class: "axis", x1: sx(l), x2: sx(l), y1: P.y1, y2: P.y1 + 5 });
      svg("text", { class: "tick", x: sx(l), y: P.y1 + 20, "text-anchor": "middle" }, label);
    }
    svg("text", { class: "tick", x: (P.x0 + P.x1) / 2, y: P.y1 + 44, "text-anchor": "middle" }, "Impact, relative to your typical keystroke");
    for (let tier = 0; tier < 4; tier++) {
      const pts = [];
      for (let l = P.lmin; l <= P.lmax + 1e-9; l += 0.025) pts.push(`${sx(l).toFixed(1)},${sy(weightAt(tier, l)).toFixed(1)}`);
      svg("polyline", { points: pts.join(" "), fill: "none", stroke: `var(--${TIERS[tier]})`, "stroke-width": 2.75, "stroke-linejoin": "round", "stroke-linecap": "round" });
      svg("text", { class: "tier", x: sx(Math.log2(CENTERS[tier])), y: P.y0 - 14, "text-anchor": "middle", fill: `var(--${TIERS[tier]})` }, TIER_NAMES[tier].toUpperCase());
    }
    const marker = svg("line", { class: "marker", x1: sx(0), x2: sx(0), y1: P.y0 - 4, y2: P.y1 });
    const dots = [0, 1, 2, 3].map((tier) => svg("circle", { r: 5.5, fill: `var(--${TIERS[tier]})`, cx: sx(0), cy: sy(0) }));
    const slider = $("force-slider");
    const readout = $("readout");
    const updateLab = () => {
      const l = Number(slider?.value || 0), mix = [];
      marker.setAttribute("x1", sx(l)); marker.setAttribute("x2", sx(l));
      dots.forEach((dot, tier) => {
        const w = weightAt(tier, l);
        dot.setAttribute("cx", sx(l)); dot.setAttribute("cy", sy(w));
        dot.style.opacity = w > 0.001 ? "1" : "0";
        if (w > 0.001) mix.push(`${TIER_NAMES[tier]} ${Math.round(w * w * 100)}%`);
      });
      if (readout) readout.textContent = `${Math.pow(2, l).toFixed(l < -1 ? 2 : 1)}× a typical keystroke · ${mix.join(" + ")}`;
    };
    slider?.addEventListener("input", updateLab);
    $("strike")?.addEventListener("click", () => tap("KeyK", Math.pow(2, Number(slider?.value || 0)), 90));
    updateLab();
  }

  // ---- Links ----
  for (const a of document.querySelectorAll("[data-download]")) {
    if (a.hasAttribute("data-prelaunch")) continue; // already says "launching soon" and links to the notify form
    if (CONFIG.downloadURL) a.href = CONFIG.downloadURL;
    else if (!a.querySelector("small")) { a.setAttribute("aria-disabled", "true"); a.insertAdjacentHTML("beforeend", " <small>· at launch</small>"); }
  }
  for (const a of document.querySelectorAll("[data-buy]")) {
    if (CONFIG.buyURL) a.href = CONFIG.buyURL;
    else if (!a.querySelector("small")) { a.setAttribute("aria-disabled", "true"); a.insertAdjacentHTML("beforeend", " <small>· at launch</small>"); }
  }

  // Small public API for page widgets (typing test, demos): window.Keyslam.
  window.Keyslam = {
    strike, release, tap, selectPack, unlock,
    setMode: (m) => { state.mode = m; }, setVolume: (v) => { state.volume = v; setGain(); },
    get pack() { return state.pack; }, packs: () => PACKS.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
  };
  document.dispatchEvent(new CustomEvent("keyslam:ready"));

  buildCluster();
  buildTiles();
  buildCredits();
  showPack();
  // Sounds load on the first sign of interest (pointer, key, focus, or the tester scrolling
  // into view), not on page load, so they never compete with the page's first paint.
  const warm = () => loadPack(state.pack).catch((error) => { if (note) { note.textContent = `Sounds couldn't load (${error.message}).`; note.dataset.tone = "error"; } });
  if (CONFIG.preload) warm();
  else if (hasTester || document.querySelector("[data-play-pack]")) {
    let done = false;
    const once = () => { if (done) return; done = true; warm(); for (const ev of ["pointerdown", "keydown", "focusin", "pointerover", "touchstart"]) window.removeEventListener(ev, once, true); };
    for (const ev of ["pointerdown", "keydown", "focusin", "pointerover", "touchstart"]) window.addEventListener(ev, once, { capture: true, passive: true });
    const tryEl = $("try") || document.querySelector("[data-keyslam-type]");
    if (tryEl && "IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); once(); } }, { rootMargin: "300px" });
      io.observe(tryEl);
    }
  }
})();
