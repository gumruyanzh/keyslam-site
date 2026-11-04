// Google Analytics 4 events and the analytics choice banner for keyslam.com.
// The consent defaults and the gtag loader are inline in <head> (scripts/site/build.py,
// analytics_head). This file adds:
//   - events: begin_checkout (Stripe buy links), file_download (the DMG),
//     select_content (a sound pack tried in the browser), purchase (/thanks/)
//   - a small Allow / No thanks banner for visitors in a European time zone, where
//     analytics storage starts denied (GA then sends cookieless pings only)
//   - [data-ks-analytics="off|on"] buttons, used on /privacy/ to change the choice
// The Mac app itself has no analytics and makes no network connections.
(function () {
  "use strict";
  const KEY = "ks-analytics";
  const PRICE = 3.99;
  const ITEM = { item_id: "keyslam-lifetime", item_name: "Keyslam lifetime license", price: PRICE, quantity: 1 };
  const send = (...args) => { if (typeof window.gtag === "function") window.gtag(...args); };
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: choice lasts this page only */ } },
  };

  function european() {
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* ignore */ }
    return /^(Europe|Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe))\//.test(tz);
  }
  // What this browser is set to now: a saved choice, else the default for its region.
  function state() {
    const saved = store.get();
    if (saved) return saved === "on" ? "on" : "off";
    return european() ? "off (until you allow it)" : "on";
  }

  function choose(value) {
    store.set(value);
    send("consent", "update", { analytics_storage: value === "on" ? "granted" : "denied" });
    const bar = document.getElementById("ks-consent");
    if (bar) bar.remove();
    for (const el of document.querySelectorAll("[data-ks-analytics-state]")) el.textContent = state();
  }

  // ---- events
  let lastPack = "";
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const a = t.closest("a[href]");
    if (a) {
      const href = a.getAttribute("href") || "";
      if (href.includes("buy.stripe.com")) {
        send("event", "begin_checkout", { currency: "USD", value: PRICE, items: [ITEM], link_page: location.pathname });
      } else if (/\.dmg(\?|#|$)/i.test(href)) {
        send("event", "file_download", { file_name: "Keyslam.dmg", file_extension: "dmg", link_url: a.href, link_page: location.pathname });
      }
    }
    const pick = t.closest("[data-pack],[data-cluster],[data-play-pack]");
    if (pick) {
      const id = pick.dataset.pack || pick.dataset.cluster || pick.dataset.playPack;
      if (id && id !== lastPack) {
        lastPack = id;
        send("event", "select_content", { content_type: "sound_pack", content_id: id, link_page: location.pathname });
      }
    }
    const toggle = t.closest("[data-ks-analytics]");
    if (toggle) choose(toggle.dataset.ksAnalytics === "on" ? "on" : "off");
  });

  // ---- purchase, once per Stripe session (the session id is a Stripe checkout id, not personal data)
  if (location.pathname.replace(/\/+$/, "") === "/thanks") {
    const session = new URLSearchParams(location.search).get("session_id");
    if (session && /^cs_[A-Za-z0-9_]+$/.test(session)) {
      const seen = "ks-purchase-" + session;
      let done = false;
      try { done = sessionStorage.getItem(seen) === "1"; sessionStorage.setItem(seen, "1"); } catch (e) { /* ignore */ }
      if (!done) send("event", "purchase", { transaction_id: session, currency: "USD", value: PRICE, items: [ITEM] });
    }
  }

  // ---- choice banner (European time zones only; everyone else can change it on /privacy/)
  function banner() {
    if (!european() || store.get()) return;
    const bar = document.createElement("div");
    bar.id = "ks-consent";
    bar.className = "consent";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Analytics choice");
    const privacy = ((window.KS_CONFIG && window.KS_CONFIG.base) || "/") + "privacy/";
    bar.innerHTML = '<p>We use Google Analytics to count visits to this website. Allow analytics cookies? '
      + '<a href="' + privacy + '">Privacy</a>. The Mac app has no analytics.</p>'
      + '<div class="consent-actions"><button type="button" class="btn outline" data-ks-analytics="off">No thanks</button>'
      + '<button type="button" class="btn" data-ks-analytics="on">Allow</button></div>';
    document.body.appendChild(bar);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner); else banner();
  for (const el of document.querySelectorAll("[data-ks-analytics-state]")) el.textContent = state();
})();
