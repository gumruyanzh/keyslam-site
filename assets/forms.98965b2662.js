// First-party forms: notify me, contact, lost-key recovery. Posts JSON to the license Worker.
(() => {
  const api = (window.KS_FORMS || {}).api;
  for (const form of document.querySelectorAll("form[data-ks-form]")) {
    const kind = form.dataset.ksForm;
    const status = form.querySelector(".ks-status");
    const say = (text, tone) => { if (status) { status.textContent = text; status.dataset.tone = tone || ""; } };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return say("Please enter a valid email address.", "error");
      if (kind === "notify") { data.source = form.dataset.source || location.pathname; data.kind = data.mac ? "send-to-mac" : "launch"; }
      const button = form.querySelector("button[type=submit]");
      if (button) button.disabled = true;
      say("Sending…");
      try {
        const r = await fetch(api + "/" + kind, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || "Something went wrong. Please try again.");
        if (kind === "recover" && out.key) {
          const area = form.querySelector(".ks-key");
          area.value = out.key; area.hidden = false; area.select();
          say("Found it. Copy the key into Keyslam › I have a license key.", "ok");
        } else {
          say(kind === "notify" ? "Thanks! We'll email you once, when the download is ready." : "Thanks, your message is in. We'll reply by email.", "ok");
          form.reset();
        }
      } catch (err) { say(err.message, "error"); }
      finally { if (button) button.disabled = false; }
    });
  }
})();
