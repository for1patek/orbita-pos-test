/**
 * Catálogo en Supabase (tabla orbita_productos). Carga pública; guardado con JWT si hay sesión.
 * Requiere: supabase-js → orbita-auth.js → este archivo.
 */
(function () {
    var U = (window.orbitaAuth && window.orbitaAuth.url) || "https://uldqgxdmblhyqsnxenaz.supabase.co";
    var K_FALLBACK = (window.orbitaAuth && window.orbitaAuth.anonKey) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZHFneGRtYmxoeXFzbnhlbmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjY2NjUsImV4cCI6MjA5MDQwMjY2NX0.9o0GseD_yxXv-tf98w_1H2q_aJLSvyX3gh1KxIYLbMg";

    async function hdr() {
        if (window.orbitaAuth && typeof window.orbitaAuth.restHeaders === "function") {
            return await window.orbitaAuth.restHeaders();
        }
        var K = (window.orbitaAuth && window.orbitaAuth.anonKey) || K_FALLBACK;
        return { apikey: K, Authorization: "Bearer " + K };
    }

    async function fetchJson(sitio) {
        var h = await hdr();
        var res = await fetch(U + "/rest/v1/orbita_productos?sitio=eq." + encodeURIComponent(sitio) + "&select=productos_json", { headers: h });
        if (!res.ok) return null;
        var rows = await res.json();
        if (!Array.isArray(rows) || !rows[0]) return null;
        return rows[0].productos_json;
    }

    /**
     * Une defaults con lo guardado por id (nombre, precio, activo; y claves opcionales presentes en guardado).
     */
    function mergeById(defaults, stored) {
        if (!Array.isArray(defaults) || defaults.length === 0) return [];
        if (!Array.isArray(stored) || stored.length === 0) return defaults.map(function (d) { return Object.assign({}, d); });
        var map = {};
        stored.forEach(function (s) {
            if (s && s.id) map[s.id] = s;
        });
        return defaults.map(function (d) {
            var o = map[d.id];
            if (!o) return Object.assign({}, d);
            var out = Object.assign({}, d);
            // Campos editables desde admin: nombre/precio/activo/desc/grano/bebida/costo.
            // El `cat` y `categoria` NO se sobrescriben: son identidad del producto y un
            // valor incorrecto guardado antes (ej. salchipapa con cat distinto de 'extra')
            // dejaría el producto fuera de su columna y sin posibilidad de agregarlo.
            if (o.nombre !== undefined) out.nombre = o.nombre;
            if (typeof o.precio === "number") out.precio = o.precio;
            if (o.activo !== undefined) out.activo = !!o.activo;
            if (o.desc !== undefined) out.desc = o.desc;
            if (o.grano !== undefined) out.grano = o.grano;
            if (o.bebida !== undefined) out.bebida = o.bebida;
            if (typeof o.costo === "number") out.costo = o.costo;
            if (typeof o.cost === "number") out.costo = o.cost;
            if (typeof o.stock === "number") out.stock = o.stock;
            return out;
        });
    }

    function mergeFuente(defProd, defPapas, defBebidas, raw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return {
                productos: defProd.map(function (d) { return Object.assign({}, d); }),
                papas_tamanios: defPapas.map(function (d) { return Object.assign({}, d); }),
                bebidas: defBebidas.slice(),
                ingredientes: []
            };
        }
        var prod = mergeById(defProd, raw.productos);
        var papas = mergeById(defPapas, raw.papas_tamanios || raw.papas || []);
        var bebidas = Array.isArray(raw.bebidas) && raw.bebidas.length ? raw.bebidas.slice() : defBebidas.slice();
        var ingredientes = Array.isArray(raw.ingredientes) ? raw.ingredientes.slice() : [];
        return { productos: prod, papas_tamanios: papas, bebidas: bebidas, ingredientes: ingredientes };
    }

    async function upsert(sitio, jsonValue) {
        var h = await hdr();
        h["Content-Type"] = "application/json";
        h["Prefer"] = "return=minimal";
        var body = JSON.stringify({ productos_json: jsonValue, updated_at: new Date().toISOString() });
        var url = U + "/rest/v1/orbita_productos?sitio=eq." + encodeURIComponent(sitio);
        var res = await fetch(url, { method: "PATCH", headers: h, body: body });
        if (res.ok) return { ok: true };
        var txt = await res.text();
        if (res.status === 404 || res.status === 406) {
            var res2 = await fetch(U + "/rest/v1/orbita_productos", {
                method: "POST",
                headers: h,
                body: JSON.stringify({ sitio: sitio, productos_json: jsonValue })
            });
            return res2.ok ? { ok: true } : { ok: false, error: txt || "POST falló" };
        }
        return { ok: false, error: txt || ("HTTP " + res.status) };
    }

    window.orbitaProductos = {
        SITIO_HANDROLL: "handroll",
        SITIO_CAFE: "cafe",
        SITIO_FUENTE: "fuente",
        fetchJson: fetchJson,
        mergeById: mergeById,
        mergeFuente: mergeFuente,
        upsert: upsert
    };
})();
