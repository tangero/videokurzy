// Checkout interactivity: ARES lookup (debounce 400 ms) + clipboard copy.
// Loaded with `defer` from CheckoutSelect a PaymentDetails views.
// CSP-friendly: žádný inline onclick.

(function () {
  // ─── ARES lookup ──────────────────────────────────────────────
  const billingEnabled = document.getElementById("billingEnabled");
  const billingFields = document.getElementById("billing-fields");
  const icoInput = document.getElementById("of-ico");
  const nameInput = document.getElementById("of-company");
  const nameSearchBtn = document.getElementById("of-name-search");
  const status = document.getElementById("of-ares-status");
  const results = document.getElementById("of-name-results");

  if (billingEnabled && billingFields) {
    billingEnabled.addEventListener("change", () => {
      billingFields.classList.toggle("hidden", !billingEnabled.checked);
    });

    const fill = (c) => {
      if (c.company_name) document.getElementById("of-company").value = c.company_name;
      if (c.ico) icoInput.value = c.ico;
      if (c.dic) document.getElementById("of-dic").value = c.dic;
      if (c.address) document.getElementById("of-address").value = c.address;
      if (c.city) document.getElementById("of-city").value = c.city;
      if (c.zip) document.getElementById("of-zip").value = c.zip;
    };

    const setStatus = (text, kind) => {
      if (!status) return;
      status.textContent = text;
      // kind: "ok" / "err" / "muted" / ""
      status.classList.remove("text-green-700", "text-red-700", "text-gray-700");
      if (kind === "ok") status.classList.add("text-green-700");
      else if (kind === "err") status.classList.add("text-red-700");
      else status.classList.add("text-gray-700");
    };

    let icoTimer = null;
    icoInput && icoInput.addEventListener("input", () => {
      if (icoTimer) clearTimeout(icoTimer);
      const v = icoInput.value.trim().replace(/\s/g, "");
      if (!/^\d{7,8}$/.test(v)) { setStatus("", ""); return; }
      icoTimer = setTimeout(async () => {
        setStatus("Načítám…", "muted");
        try {
          const r = await fetch("/api/ares-lookup?ico=" + encodeURIComponent(v));
          const data = await r.json();
          if (data.results && data.results.length === 1) {
            fill(data.results[0]);
            setStatus("✓ ARES", "ok");
          } else {
            setStatus("Nenalezeno", "err");
          }
        } catch (e) {
          setStatus("Chyba ARES", "err");
        }
      }, 400);
    });

    nameSearchBtn && nameSearchBtn.addEventListener("click", async () => {
      const q = (nameInput?.value ?? "").trim();
      if (q.length < 3) { setStatus("Min. 3 znaky", "err"); return; }
      setStatus("Hledám…", "muted");
      try {
        const r = await fetch("/api/ares-lookup?name=" + encodeURIComponent(q));
        const data = await r.json();
        const arr = data.results || [];
        results.innerHTML = "";
        if (arr.length === 0) {
          setStatus("Nic", "err");
          results.classList.add("hidden");
          return;
        }
        setStatus(arr.length + " výsledků", "muted");
        arr.forEach((c) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "w-full text-left px-3 py-3 hover:bg-gray-50 text-sm min-h-[44px]";
          const strong = document.createElement("strong");
          strong.textContent = c.company_name || "?";
          const br = document.createElement("br");
          const meta = document.createElement("span");
          meta.className = "text-xs text-gray-600";
          meta.textContent = "IČO " + (c.ico || "") + (c.city ? ", " + c.city : "");
          btn.append(strong, br, meta);
          btn.addEventListener("click", () => {
            fill(c);
            results.classList.add("hidden");
            setStatus("✓ Vybráno", "ok");
          });
          results.appendChild(btn);
        });
        results.classList.remove("hidden");
      } catch (e) {
        setStatus("Chyba", "err");
      }
    });
  }

  // ─── Clipboard copy ────────────────────────────────────────────
  // PaymentRow buttons mají data-copy="<text>"; po kliknutí krátké "OK".
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.getAttribute("data-copy") ?? "";
      const original = btn.textContent;
      navigator.clipboard.writeText(value).then(() => {
        btn.textContent = "OK";
        setTimeout(() => { btn.textContent = original; }, 1500);
      });
    });
  });

  // ─── Disclosure rotation ──────────────────────────────────────
  document.querySelectorAll("details > summary[data-chevron]").forEach((s) => {
    const update = () => {
      const open = s.parentElement?.hasAttribute("open");
      const ch = s.querySelector("[data-chevron-icon]");
      if (ch) ch.style.transform = open ? "rotate(90deg)" : "rotate(0deg)";
    };
    s.parentElement?.addEventListener("toggle", update);
    update();
  });
})();
