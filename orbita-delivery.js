/**
 * Módulo común de delivery Órbita:
 *   - Geofence Frutillar alto/bajo (bbox aproximado)
 *   - Validación de horario
 * Depende de orbita-supabase-sync.js (window.orbitaCostosFijos, window.orbitaHorario).
 */
(function () {
    // Bounding box aproximado que cubre Frutillar Alto + Frutillar Bajo + zonas intermedias.
    // Fuente: coords ~-41.12°S, -73.08°W. Margen ~5 km cada lado.
    var FRUTILLAR_BBOX = {
        latMin: -41.16,
        latMax: -41.08,
        lngMin: -73.13,
        lngMax: -73.00
    };

    function dentroDeFrutillar(lat, lng) {
        if (typeof lat !== "number" || typeof lng !== "number") return false;
        return lat >= FRUTILLAR_BBOX.latMin && lat <= FRUTILLAR_BBOX.latMax
            && lng >= FRUTILLAR_BBOX.lngMin && lng <= FRUTILLAR_BBOX.lngMax;
    }

    /**
     * Valida si el delivery está disponible ahora para el sitio dado.
     * Devuelve { ok: bool, motivo: 'horario' | null, horario: {inicio, fin} }.
     */
    async function puedeHacerDeliveryAhora(sitio) {
        if (!window.orbitaCostosFijos || !window.orbitaCostosFijos.leerHorarioDelivery) {
            return { ok: true, motivo: null, horario: null };
        }
        var h = await window.orbitaCostosFijos.leerHorarioDelivery(sitio);
        var enVentana = window.orbitaHorario && window.orbitaHorario.enVentana(h);
        return { ok: !!enVentana, motivo: enVentana ? null : "horario", horario: h };
    }

    window.orbitaDelivery = {
        FRUTILLAR_BBOX: FRUTILLAR_BBOX,
        dentroDeFrutillar: dentroDeFrutillar,
        puedeHacerDeliveryAhora: puedeHacerDeliveryAhora,
        mensajeFueraZona: "Solo hacemos delivery dentro de Frutillar alto/bajo. Tu ubicación está fuera de la zona.",
        mensajeFueraHorario: function (h) {
            if (!h) return "Delivery fuera de horario, disculpa.";
            var fmt = window.orbitaHorario && window.orbitaHorario.formatHHMM;
            if (!fmt) return "Delivery fuera de horario, disculpa.";
            return "Delivery fuera de horario, disculpa. Horario: " + fmt(h.inicio) + " a " + fmt(h.fin) + ".";
        }
    };
})();
