/**
 * orbita-stock.js — Módulo de stock Órbita 300
 * Conecta el POS y la web con la Edge Function descontar-stock.
 *
 * Requiere: orbita-auth.js (para SUPABASE_URL y anonKey)
 *
 * Expone: window.orbitaStock
 *   · verificarStock(sitio, items)         → { ok, alertas }
 *   · descontarStock(sitio, items, pedidoId) → { ok, alertas }
 *   · registrarEvento(tipo, sitio, productoId, productoNombre, cantidadPedida, cantidadDisponible)
 *   · registrarBusqueda(sitio, query, sinResultado)
 *   · stockDisponible(sitio, productoId)   → número (para bloqueo en web)
 */

(function () {
    'use strict';

    // ─── Config ──────────────────────────────────────────────────────────────
    // Usa la misma URL que orbita-auth.js para no duplicar credenciales
    function getBase() {
        return window.orbitaAuth?.url || 'https://ftyxipxsyzldofdyamqt.supabase.co';
    }
    function getKey() {
        return window.orbitaAuth?.anonKey || '';
    }
    function headers() {
        return {
            'Content-Type': 'application/json',
            'apikey': getKey(),
            'Authorization': 'Bearer ' + getKey(),
        };
    }

    const EDGE_URL = () => getBase() + '/functions/v1/descontar-stock';
    const REST_URL = () => getBase() + '/rest/v1/';

    // ─── Verificar stock SIN descontar (pre-validación) ──────────────────────
    // Llama a la edge function en modo "verificar" — no toca la base de datos.
    // Devuelve { ok: bool, alertas: [{ producto_id, nombre, pedido, disponible, tipo }] }
    //
    // items = [{ producto_id, nombre, cantidad, ingredientes? }]
    //   · producto_id: el id limpio del producto (sin timestamp)
    //   · ingredientes: array opcional si el cliente personalizó el pedido
    async function verificarStock(sitio, items) {
        try {
            const res = await fetch(EDGE_URL(), {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    accion: 'verificar',
                    sitio,
                    items,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                console.error('[orbitaStock] verificarStock error:', data);
                // Supabase respondió con error — avisamos pero no bloqueamos la venta
                return { ok: true, alertas: [], advertencia: 'No se pudo verificar el stock. Si la venta se completa, ajusta el stock manualmente.' };
            }
            return data; // { ok, alertas }
        } catch (e) {
            // Sin conexión o Supabase caído — avisamos al cajero, no bloqueamos
            console.error('[orbitaStock] verificarStock excepción:', e);
            return { ok: true, alertas: [], advertencia: 'Sin conexión al verificar stock. Si la venta se completa, ajusta el stock manualmente.' };
        }
    }

    // ─── Descontar stock (post-pago confirmado) ───────────────────────────────
    // Llama a la edge function en modo "descontar" — ejecuta el FOR UPDATE atómico.
    // Devuelve { ok: bool, alertas: [] }
    async function descontarStock(sitio, items, pedidoId) {
        try {
            const res = await fetch(EDGE_URL(), {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    accion: 'descontar',
                    sitio,
                    pedido_id: pedidoId || null,
                    items,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                console.error('[orbitaStock] descontarStock error:', data);
                return { ok: false, alertas: [] };
            }
            return data;
        } catch (e) {
            console.error('[orbitaStock] descontarStock excepción:', e);
            return { ok: false, alertas: [] };
        }
    }

    // ─── Consultar stock disponible de un producto (para web) ─────────────────
    // Devuelve número (0 si no hay, -1 si error).
    async function stockDisponible(sitio, productoId) {
        try {
            const res = await fetch(
                REST_URL() + `stock_local?sitio=eq.${sitio}&producto_id=eq.${encodeURIComponent(productoId)}&select=cantidad`,
                { headers: headers() }
            );
            const data = await res.json();
            if (!res.ok || !data?.length) return 0;
            return data[0].cantidad ?? 0;
        } catch (e) {
            return -1;
        }
    }

    // ─── Consultar stock de VARIOS productos en una sola petición (para web) ──
    // En vez de preguntar producto por producto (20 fetches), trae todo de una.
    // Devuelve un Map: { producto_id → cantidad }
    // Uso: const stock = await orbitaStock.stockVariosProductos('fuente', ids);
    //      const quedan = stock.get('mechada_italiana') ?? 0;
    async function stockVariosProductos(sitio, ids) {
        const mapa = new Map();
        if (!ids?.length) return mapa;
        try {
            const lista = ids.map(id => encodeURIComponent(id)).join(',');
            const res = await fetch(
                REST_URL() + `stock_local?sitio=eq.${sitio}&producto_id=in.(${lista})&select=producto_id,cantidad`,
                { headers: headers() }
            );
            const data = await res.json();
            if (!res.ok || !Array.isArray(data)) return mapa;
            data.forEach(row => mapa.set(row.producto_id, row.cantidad ?? 0));
        } catch (e) {
            console.error('[orbitaStock] stockVariosProductos error:', e);
        }
        return mapa;
    }

    // ─── Registrar evento de demanda no satisfecha ───────────────────────────
    // Se llama desde la web cuando:
    //   · El cliente ve un producto agotado (tipo = 'agotado')
    //   · El cliente pide más de lo disponible (tipo = 'insuficiente')
    // Se llama desde el POS cuando el cajero recibe aviso de stock bajo (tipo = 'insuficiente')
    async function registrarEvento(tipo, sitio, productoId, productoNombre, cantidadPedida, cantidadDisponible) {
        try {
            await fetch(REST_URL() + 'stock_eventos_cliente', {
                method: 'POST',
                headers: { ...headers(), 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    tipo,
                    sitio,
                    producto_id:         productoId   || null,
                    producto_nombre:     productoNombre || null,
                    cantidad_pedida:     cantidadPedida    ?? null,
                    cantidad_disponible: cantidadDisponible ?? null,
                    creado_at:           new Date().toISOString(),
                }),
            });
        } catch (e) {
            // Silencioso — no bloquear el flujo por un registro de evento
        }
    }

    // ─── Registrar búsqueda en barra de búsqueda ─────────────────────────────
    // Se llama desde fuente.html / cafe.html / index.html cuando el cliente busca.
    // tipo = 'busqueda' | 'busqueda_sin_resultado'
    // Usa debounce de 800ms para no registrar cada letra.
    let _busquedaTimer = null;
    function registrarBusqueda(sitio, query, sinResultado) {
        if (!query || query.trim().length < 2) return;
        clearTimeout(_busquedaTimer);
        _busquedaTimer = setTimeout(async () => {
            try {
                await fetch(REST_URL() + 'stock_eventos_cliente', {
                    method: 'POST',
                    headers: { ...headers(), 'Prefer': 'return=minimal' },
                    body: JSON.stringify({
                        tipo:            sinResultado ? 'busqueda_sin_resultado' : 'busqueda',
                        sitio,
                        producto_nombre: query.trim().toLowerCase(),
                        creado_at:       new Date().toISOString(),
                    }),
                });
            } catch (e) {}
        }, 800);
    }

    // ─── Construir items para la edge function desde la comanda del POS ──────
    // Recibe el array estado.comanda y devuelve el formato que espera la edge function.
    // Cada item de la comanda debe tener producto_id (el id limpio sin timestamp).
    function comandaAItems(comanda) {
        return comanda.map(item => ({
            producto_id: item.producto_id || item.id,  // producto_id limpio primero
            nombre:      item.nombre,
            cantidad:    item.qty || item.cantidad || 1,
            // Si el item tiene ingredientes personalizados (pedido web con opciones),
            // se envían para descuento preciso. El POS envía la receta base.
            ingredientes: item.ingredientes || null,
        }));
    }

    // ─── Mensaje de alerta legible para el cajero ────────────────────────────
    // Convierte el array de alertas de la edge function en un string claro.
    function mensajeAlertas(alertas) {
        if (!alertas?.length) return '';
        return alertas.map(a => {
            if (a.tipo === 'agotado') {
                return `• ${a.nombre}: AGOTADO`;
            }
            if (a.tipo === 'insuficiente_unidades') {
                return `• ${a.nombre}: pediste ${a.pedido}, solo quedan ${a.disponible}`;
            }
            if (a.tipo === 'insuficiente_gramos') {
                return `• ${a.nombre}: stock bajo (margen 80% no alcanza)`;
            }
            return `• ${a.nombre}: stock insuficiente`;
        }).join('\n');
    }

    // ─── API pública ─────────────────────────────────────────────────────────
    window.orbitaStock = {
        verificarStock,
        descontarStock,
        stockDisponible,
        stockVariosProductos,
        registrarEvento,
        registrarBusqueda,
        comandaAItems,
        mensajeAlertas,
    };

})();
