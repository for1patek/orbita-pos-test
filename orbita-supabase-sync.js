/**
 * Costos fijos (orbita_config). Con RLS estricto, hace falta sesión Supabase Auth (JWT).
 * Carga: supabase.min.js → orbita-auth.js → este archivo.
 */
(function () {
    var U = (window.orbitaAuth && window.orbitaAuth.url) || "https://ftyxipxsyzldofdyamqt.supabase.co";
    var K = (window.orbitaAuth && window.orbitaAuth.anonKey) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZHFneGRtYmxoeXFzbnhlbmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjY2NjUsImV4cCI6MjA5MDQwMjY2NX0.9o0GseD_yxXv-tf98w_1H2q_aJLSvyX3gh1KxIYLbMg";
    var T = "orbita_config";
    var CLAVES_FIJOS = ["costo_fijo_handroll", "costo_fijo_cafe", "costo_fijo_fuente"];
    var CLAVES_DELIVERY = ["costo_delivery_handroll", "costo_delivery_cafe", "costo_delivery_fuente"];
    var CLAVES_HORARIO = [
        "delivery_hora_inicio_handroll", "delivery_hora_fin_handroll",
        "delivery_hora_inicio_cafe", "delivery_hora_fin_cafe",
        "delivery_hora_inicio_fuente", "delivery_hora_fin_fuente"
    ];
    var DEFAULT_DELIVERY = 2000;
    var DEFAULTS_HORARIO = {
        delivery_hora_inicio_handroll: 720, delivery_hora_fin_handroll: 1260,
        delivery_hora_inicio_cafe: 540,     delivery_hora_fin_cafe: 1140,
        delivery_hora_inicio_fuente: 720,   delivery_hora_fin_fuente: 1320
    };
    var LS_LEGACY = {
        costo_fijo_handroll: "orbita_costo_fijo_handroll",
        costo_fijo_cafe: "orbita_costo_fijo_cafe",
        costo_fijo_fuente: "orbita_costo_fijo_fuente",
        costo_delivery_handroll: "orbita_costo_delivery_handroll",
        costo_delivery_cafe: "orbita_costo_delivery_cafe",
        costo_delivery_fuente: "orbita_costo_delivery_fuente"
    };

    function baseOut() {
        var base = {
            costo_fijo_handroll: 0,
            costo_fijo_cafe: 0,
            costo_fijo_fuente: 0,
            costo_delivery_handroll: DEFAULT_DELIVERY,
            costo_delivery_cafe: DEFAULT_DELIVERY,
            costo_delivery_fuente: DEFAULT_DELIVERY
        };
        Object.keys(DEFAULTS_HORARIO).forEach(function (k) { base[k] = DEFAULTS_HORARIO[k]; });
        return base;
    }

    function mergeLegacy(out) {
        Object.keys(LS_LEGACY).forEach(function (c) {
            try {
                var ls = localStorage.getItem(LS_LEGACY[c]);
                if (ls == null) return;
                var v = parseInt(ls, 10);
                if (!isNaN(v) && v >= 0) out[c] = v;
            } catch (e) {}
        });
    }

    async function hdr() {
        if (window.orbitaAuth && typeof window.orbitaAuth.restHeaders === "function") {
            return await window.orbitaAuth.restHeaders();
        }
        return { apikey: K, Authorization: "Bearer " + K };
    }

    async function fetchAll() {
        var headers = await hdr();
        var res = await fetch(U + "/rest/v1/" + T + "?select=clave,valor", { headers: headers });
        if (res.status === 401 || res.status === 403) throw new Error("auth");
        if (!res.ok) throw new Error("http_" + res.status);
        var rows = await res.json();
        if (!Array.isArray(rows)) throw new Error("bad_json");
        var out = baseOut();
        rows.forEach(function (r) {
            if (r && r.clave in out) out[r.clave] = Number(r.valor) || 0;
        });
        return out;
    }

    // Upsert genérico (usa anon + RLS si aplica; con RLS estricto requiere auth).
    async function upsertClave(clave, valor) {
        var n = Math.max(0, Math.floor(parseInt(String(valor), 10) || 0));
        var headers = await hdr();
        headers["Content-Type"] = "application/json";
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal";
        var res = await fetch(U + "/rest/v1/" + T, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ clave: clave, valor: n, updated_at: new Date().toISOString() })
        });
        try { localStorage.setItem(LS_LEGACY[clave] || ("orbita_cfg_" + clave), String(n)); } catch (err) {}
        if (res.status === 401 || res.status === 403) {
            return { ok: false, error: "Sesión requerida: inicia sesión con el usuario de Supabase (Auth)." };
        }
        if (!res.ok) {
            return { ok: false, error: "No se pudo guardar (código " + res.status + ")." };
        }
        return { ok: true };
    }

    window.orbitaCostosFijos = {
        claveHandroll: "costo_fijo_handroll",
        claveCafe: "costo_fijo_cafe",
        claveFuente: "costo_fijo_fuente",

        // Claves de delivery por sitio
        claveDeliveryHandroll: "costo_delivery_handroll",
        claveDeliveryCafe: "costo_delivery_cafe",
        claveDeliveryFuente: "costo_delivery_fuente",
        DEFAULT_DELIVERY: DEFAULT_DELIVERY,

        leer: async function () {
            try {
                var out = await fetchAll();
                mergeLegacy(out);
                return out;
            } catch (e) {
                var out2 = baseOut();
                mergeLegacy(out2);
                out2._sinTabla = true;
                if (e && e.message === "auth") out2._necesitaLogin = true;
                return out2;
            }
        },

        // Lee UN costo de delivery por sitio con fallback a default (2000).
        // Pensado para usarse sin autenticación (solo select).
        leerCostoDelivery: async function (sitio) {
            var clave = "costo_delivery_" + sitio;
            try {
                var out = await fetchAll();
                var v = Number(out[clave]);
                return isFinite(v) && v >= 0 ? v : DEFAULT_DELIVERY;
            } catch (e) {
                try {
                    var ls = localStorage.getItem(LS_LEGACY[clave] || ("orbita_cfg_" + clave));
                    var n = parseInt(ls, 10);
                    if (!isNaN(n) && n >= 0) return n;
                } catch (err) {}
                return DEFAULT_DELIVERY;
            }
        },

        guardar: async function (clave, valor) {
            var todas = CLAVES_FIJOS.concat(CLAVES_DELIVERY).concat(CLAVES_HORARIO);
            if (todas.indexOf(clave) === -1) return { ok: false, error: "Clave inválida." };
            return await upsertClave(clave, valor);
        },

        // Lee horario de delivery { inicio, fin } en minutos desde medianoche para un sitio.
        leerHorarioDelivery: async function (sitio) {
            var keyIni = "delivery_hora_inicio_" + sitio;
            var keyFin = "delivery_hora_fin_" + sitio;
            try {
                var out = await fetchAll();
                return {
                    inicio: Number(out[keyIni]) >= 0 ? Number(out[keyIni]) : DEFAULTS_HORARIO[keyIni],
                    fin: Number(out[keyFin]) >= 0 ? Number(out[keyFin]) : DEFAULTS_HORARIO[keyFin]
                };
            } catch (e) {
                return { inicio: DEFAULTS_HORARIO[keyIni], fin: DEFAULTS_HORARIO[keyFin] };
            }
        }
    };

    // Helper público: ¿ahora está dentro del horario de delivery?
    window.orbitaHorario = {
        enVentana: function (horario) {
            if (!horario) return false;
            var ini = Number(horario.inicio) || 0;
            var fin = Number(horario.fin) || 0;
            if (ini >= fin) return false; // marcado como cerrado
            var now = new Date();
            var min = now.getHours() * 60 + now.getMinutes();
            return min >= ini && min < fin;
        },
        formatHHMM: function (min) {
            var m = Math.max(0, Math.min(1440, Number(min) || 0));
            var h = Math.floor(m / 60);
            var mm = m % 60;
            return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
        },
        parseHHMM: function (s) {
            if (!s) return null;
            var m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
            if (!m) return null;
            var h = Math.max(0, Math.min(23, Number(m[1])));
            var mm = Math.max(0, Math.min(59, Number(m[2])));
            return h * 60 + mm;
        }
    };
})();
