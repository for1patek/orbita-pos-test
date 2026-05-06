(function () {
  const SUPABASE_URL = "https://ftyxipxsyzldofdyamqt.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0eXhpcHhzeXpsZG9mZHlhbXF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5Mzc0NzMsImV4cCI6MjA5MzUxMzQ3M30.3gGtHUhd5MnU0al6CO6g789-EPPtwfGZ9RI0K-iLCD0";
  const MP_EDGE_URL = SUPABASE_URL + "/functions/v1/hyper-worker";
  const TABLA_PEDIDOS = "pedidos";

  function headers(extra = {}) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function insertarPedido(pedidoBody) {
    try {
      const res = await fetch(
        SUPABASE_URL + "/rest/v1/" + TABLA_PEDIDOS,
        {
          method: "POST",
          headers: headers({ Prefer: "return=minimal" }),
          body: JSON.stringify(pedidoBody),
        },
      );
      return res.ok;
    } catch (e) {
      console.error("insertarPedido falló:", e);
      return false;
    }
  }

  function abrirBannerResena() {
    const banner = document.getElementById("banner-resena");
    const link = document.getElementById("banner-resena-link");
    if (banner) {
      if (link) link.href = (window.LINK_RESENA || "resenas.html");
      banner.classList.add("open");
    }
  }

  function toast(msg, tipo = "info") {
    const bg = tipo === "error" ? "#c1121f" : tipo === "success" ? "#25d366" : "#333";
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;" +
      "background:" + bg + ";color:#fff;padding:12px 20px;border-radius:12px;" +
      "font-family:'DM Sans',sans-serif;font-size:0.9rem;font-weight:600;" +
      "box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:90vw;text-align:center;";
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity 0.4s";
      el.style.opacity = "0";
    }, 3000);
    setTimeout(() => el.remove(), 3500);
  }

  async function iniciarPagoMP(opts) {
    const { sitio, items, pedidoBody, onError, wspNumber } = opts;
    try {
      const res = await fetch(MP_EDGE_URL, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "create_preference",
          sitio,
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.init_point) {
        console.error("MP pref error:", data);
        if (onError) onError(data);
        return false;
      }

      const enriched = {
        ...pedidoBody,
        sitio,
        estado: "pendiente",
        mp_preference_id: data.preference_id || null,
        mp_external_reference: data.external_reference || null,
      };
      await insertarPedido(enriched);

      try {
        localStorage.setItem(
          "orbita_pago_pendiente",
          JSON.stringify({
            ref: data.external_reference,
            sitio,
            ts: Date.now(),
            tipo_entrega: pedidoBody && pedidoBody.tipo_entrega,
            direccion_entrega: pedidoBody && pedidoBody.direccion_entrega,
            nombre: pedidoBody && pedidoBody.nombre,
            total: pedidoBody && pedidoBody.total,
            wspNumber: wspNumber || null,
          }),
        );
        // Limpiar marca de WSP para no mezclar flujos
        localStorage.removeItem("orbita_wsp_enviado");
      } catch (e) {}

      window.location.href = data.init_point;
      return true;
    } catch (e) {
      console.error("iniciarPagoMP falló:", e);
      if (onError) onError(e);
      return false;
    }
  }

  async function marcarPago(ref, status) {
    try {
      const res = await fetch(MP_EDGE_URL, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "mark_payment",
          external_reference: ref,
          status,
          payment_id: new URLSearchParams(window.location.search).get("payment_id") || null,
        }),
      });
      return res.ok;
    } catch (e) {
      console.error("marcarPago falló:", e);
      return false;
    }
  }

  function limpiarUrl() {
    try {
      const url = new URL(window.location.href);
      ["status", "ref", "payment_id", "collection_id", "collection_status",
       "external_reference", "preference_id", "merchant_order_id", "processing_mode",
       "merchant_account_id", "site_id"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""));
    } catch (e) {}
  }

  // Muestra un CTA para que el cliente envíe su ubicación al local via
  // WhatsApp cuando pagó online con delivery. El pedido (con la URL de
  // Google Maps) ya se guardó en la tabla `pedidos`, este paso es un
  // canal redundante para que el local no dependa solo del panel.
  function mostrarCtaUbicacionDelivery(pendiente) {
    if (!pendiente) return;
    if (pendiente.tipo_entrega !== "delivery") return;
    if (!pendiente.direccion_entrega || !pendiente.wspNumber) return;

    const mensaje =
      `📍 UBICACIÓN PARA DELIVERY\n` +
      `Nombre: ${pendiente.nombre || ""}\n` +
      `Total: $${(pendiente.total || 0).toLocaleString("es-CL")}\n` +
      `Ref: ${pendiente.ref}\n` +
      `Ubicación: ${pendiente.direccion_entrega}`;
    const url = "https://wa.me/" + pendiente.wspNumber + "?text=" + encodeURIComponent(mensaje);

    const prev = document.getElementById("orbita-cta-ubicacion");
    if (prev) prev.remove();

    const el = document.createElement("div");
    el.id = "orbita-cta-ubicacion";
    el.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
      "background:#25d366;color:#ffffff;border-radius:50px;padding:14px 22px;" +
      "font-family:'DM Sans',sans-serif;font-size:0.95rem;font-weight:700;" +
      "box-shadow:0 8px 28px rgba(0,0,0,0.45);z-index:99999;cursor:pointer;" +
      "max-width:90vw;text-align:center;border:2px solid #ffffff;";
    el.innerHTML = "📍 Enviar mi ubicación al local (WhatsApp)";
    el.addEventListener("click", () => {
      window.open(url, "_blank");
    });
    document.body.appendChild(el);
    // Auto-hide después de 30s (no es destructivo si el user ya lo tocó)
    setTimeout(() => { const x = document.getElementById("orbita-cta-ubicacion"); if (x) x.remove(); }, 30000);
  }

  async function detectarRetorno() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status") || params.get("collection_status");
    const ref = params.get("ref") || params.get("external_reference");

    if (!status || !ref) return null;

    const normalized =
      status === "approved" ? "approved"
      : status === "rejected" || status === "failure" ? "failure"
      : status === "in_process" || status === "pending" ? "pending"
      : null;

    if (!normalized) return null;

    // Recuperar info del pedido antes de limpiar
    let pendiente = null;
    try {
      const raw = localStorage.getItem("orbita_pago_pendiente");
      if (raw) pendiente = JSON.parse(raw);
    } catch (e) {}

    await marcarPago(ref, normalized);

    if (normalized === "approved") {
      toast("¡Pago recibido! Gracias por tu pedido 🎉", "success");
      setTimeout(abrirBannerResena, 1500);
      // Si fue delivery, ofrecer enviar ubicación al local por WSP
      if (pendiente && pendiente.tipo_entrega === "delivery") {
        setTimeout(() => mostrarCtaUbicacionDelivery({ ...pendiente, ref }), 1800);
      }
    } else if (normalized === "failure") {
      toast("El pago fue rechazado. Puedes intentar de nuevo o pedir por WhatsApp.", "error");
    } else {
      toast("Tu pago está pendiente. Te avisamos cuando se confirme.", "info");
    }

    try { localStorage.removeItem("orbita_pago_pendiente"); } catch (e) {}
    limpiarUrl();
    return normalized;
  }

  async function registrarWhatsapp(opts) {
    const { sitio, pedidoBody, wspNumber, mensaje } = opts;
    window.open(
      "https://wa.me/" + wspNumber + "?text=" + encodeURIComponent(mensaje),
      "_blank",
    );

    const enriched = {
      ...pedidoBody,
      sitio,
      estado: "whatsapp",
    };
    await insertarPedido(enriched);

    // Marcar que hay un pedido WSP recién enviado. El banner se abrirá
    // cuando el usuario vuelva a la pestaña (tras enviar el mensaje real),
    // no inmediatamente al hacer click.
    try {
      localStorage.setItem("orbita_wsp_enviado", JSON.stringify({
        sitio,
        ts: Date.now(),
      }));
    } catch (e) {}
  }

  // Al volver a la pestaña después de pasar por WSP, mostrar el banner.
  // Delay mínimo de 6s desde el click (evita mostrarlo si el usuario
  // solo miró y volvió sin enviar).
  function _checkRetornoWsp() {
    try {
      const raw = localStorage.getItem("orbita_wsp_enviado");
      if (!raw) return;
      const mark = JSON.parse(raw);
      if (!mark || !mark.ts) return;
      const elapsed = Date.now() - mark.ts;
      // Entre 6s y 30 min después del click → mostrar banner (y limpiar marca)
      if (elapsed >= 6000 && elapsed <= 30 * 60 * 1000) {
        localStorage.removeItem("orbita_wsp_enviado");
        setTimeout(abrirBannerResena, 400);
      } else if (elapsed > 30 * 60 * 1000) {
        localStorage.removeItem("orbita_wsp_enviado");
      }
    } catch (e) {}
  }

  // Captura el texto original del botón MP al cargar la página,
  // antes de que el click lo cambie a "Generando pago…".
  function _snapshotMpBtnOriginal() {
    const btn = document.getElementById("btn-mp");
    if (!btn) return;
    if (!btn.dataset.originalText && !btn.disabled) {
      btn.dataset.originalText = btn.textContent;
    }
  }

  // Resetea el botón "Pagar en línea" si el usuario volvió de MP sin
  // completar el pago (bfcache, back, cerró MP). Funciona en los 3 locales
  // buscando el botón por id #btn-mp.
  function _resetMpButtonIfNeeded() {
    const btn = document.getElementById("btn-mp");
    if (!btn) return;
    const txt = (btn.textContent || "").toLowerCase();
    const enLoading = btn.disabled && (txt.includes("generando") || txt.includes("⏳"));
    if (!enLoading) return;

    const params = new URLSearchParams(window.location.search);
    const hasMpReturn = params.has("status") || params.has("collection_status");
    // Si volvimos a la página SIN params de retorno → cancelado/abandonado
    if (!hasMpReturn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || "💳 PAGAR EN LÍNEA";
      // Limpiar el pendiente para que no se reutilice por error
      try { localStorage.removeItem("orbita_pago_pendiente"); } catch (e) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _snapshotMpBtnOriginal);
  } else {
    _snapshotMpBtnOriginal();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      _checkRetornoWsp();
      _resetMpButtonIfNeeded();
    }
  });
  window.addEventListener("pageshow", (e) => {
    _checkRetornoWsp();
    // pageshow con persisted=true = bfcache (back desde MP)
    _resetMpButtonIfNeeded();
  });

  // Scroll al elemento con highlight de error (pulso rojo) y toast opcional.
  // Uso: orbitaPagoFlow.flashError(el, "Elige bebida primero") → scroll + pulse rojo + toast.
  function flashError(el, mensaje) {
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      el.classList.add("orbita-pulse-error");
      setTimeout(() => el.classList.remove("orbita-pulse-error"), 2000);
    }
    if (mensaje) toast(mensaje, "error");
  }
  function flashOk(el, mensaje) {
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      el.classList.add("orbita-pulse");
      setTimeout(() => el.classList.remove("orbita-pulse"), 1800);
    }
    if (mensaje) toast(mensaje, "success");
  }

  window.orbitaPagoFlow = {
    flashError: flashError,
    flashOk: flashOk,
    iniciarPagoMP,
    detectarRetorno,
    registrarWhatsapp,
    abrirBannerResena,
    toast,
    SUPABASE_URL,
    SUPABASE_KEY,
    MP_EDGE_URL,
  };
})();
