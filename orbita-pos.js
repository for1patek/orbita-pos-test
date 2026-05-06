/**
 * orbita-pos.js — Lógica del Punto de Venta Órbita 300
 * Requiere: supabase-js → orbita-auth.js → orbita-productos.js → este archivo
 */

(function () {
    'use strict';

    // ─── Supabase ────────────────────────────────────────────────────────────
    const SB = supabase.createClient(
        window.orbitaAuth.url,
        window.orbitaAuth.anonKey
    );

    // ─── Estado global ───────────────────────────────────────────────────────
    let estado = {
        local:       'cafe',       // 'cafe' | 'fuente'
        usuario:     null,         // { id, nombre, rol }
        turnoInicio: null,         // Date
        comanda:     [],           // [{ id, nombre, precio, costo, qty }]
        metodoPago:  'efectivo',
        pedidoAnularId: null,
        catalogoCafe:   [],
        catalogoFuente: [],
    };

    // ─── Categorías por local ─────────────────────────────────────────────────
    const CATS = {
        cafe: [
            { id: 'cafe',   label: '☕ Cafés' },
            { id: 'pastel', label: '🍰 Pastelería' },
            { id: 'jugo',   label: '🥤 Jugos' },
            { id: 'bebida', label: '🥤 Bebidas/Aguas' },
        ],
        fuente: [
            { id: 'sandwich', label: '🍔 Sándwiches' },
            { id: 'handroll', label: '🍣 Hand Roll' },
            { id: 'completo', label: '🌭 Completos' },
            { id: 'extra',    label: '🍟 Papas' },
            { id: 'jugo',     label: '🍹 Jugos' },
            { id: 'bebida',   label: '🥤 Bebidas/Aguas' },
        ],
    };
    let catActiva = 'cafe';

    // ─── Temas de color por local ─────────────────────────────────────────────
    const TEMAS = {
        cafe:   { primary: '#8B1A1A', accent: '#A0522D', activeBg: '#2a0808' },
        fuente: { primary: '#b8860b', accent: '#8B6914', activeBg: '#2a1e00' },
    };

    function aplicarTemaLocal(local) {
        const t = TEMAS[local] || TEMAS.cafe;
        const r = document.documentElement.style;
        r.setProperty('--primary',   t.primary);
        r.setProperty('--accent',    t.accent);
        r.setProperty('--local-bg',  t.activeBg);
    }

    // ─── Utilidades ──────────────────────────────────────────────────────────
    function fmt(n) { return '$' + Math.round(n).toLocaleString('es-CL'); }

    function toast(msg, tipo = 'ok') {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.className = 'toast show ' + tipo;
        setTimeout(() => { el.className = 'toast'; }, 2800);
    }

    async function sha256(str) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ─── LOGIN ───────────────────────────────────────────────────────────────
    let pinBuffer = '';
    let usuarioSeleccionado = null;

    function seleccionarLocal(local, btn) {
        estado.local = local;
        aplicarTemaLocal(local);
        document.querySelectorAll('.local-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cargarUsuarios();
    }

    async function cargarUsuarios() {
        const grid = document.getElementById('usuario-grid');
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:0.82rem;padding:10px;">Cargando…</div>';
        usuarioSeleccionado = null;
        pinBuffer = '';
        actualizarPinDisplay();

        const { data, error } = await SB
            .from('pos_usuarios')
            .select('id, nombre, rol')
            .eq('activo', true)
            .or(`sitio.eq.${estado.local},sitio.eq.ambos`)
            .order('nombre');

        if (error || !data || data.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:0.82rem;padding:10px;">Sin usuarios registrados.<br>Agrégalos desde el panel admin.</div>';
            return;
        }

        grid.innerHTML = '';
        data.forEach(u => {
            const btn = document.createElement('button');
            btn.className = 'usuario-btn';
            btn.textContent = u.nombre + (u.rol === 'admin' ? ' ⭐' : '');
            btn.onclick = () => {
                document.querySelectorAll('.usuario-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                usuarioSeleccionado = u;
                pinBuffer = '';
                actualizarPinDisplay();
                document.getElementById('login-error').textContent = '';
            };
            grid.appendChild(btn);
        });
    }

    function actualizarPinDisplay() {
        const el = document.getElementById('pin-display');
        if (pinBuffer.length === 0) { el.textContent = '·  ·  ·  ·'; return; }
        el.textContent = '●  '.repeat(pinBuffer.length).trim();
    }

    // ─── Teclado físico para PIN ─────────────────────────────────────────────
    document.addEventListener('keydown', function(e) {
        const loginVisible = document.getElementById('pantalla-login').style.display !== 'none'
            && !document.getElementById('pantalla-login').style.display; // visible por defecto
        const enLogin = document.getElementById('pantalla-pos').style.display === 'none'
            || !document.getElementById('pantalla-pos').style.display;
        if (!enLogin) return;
        if (e.key >= '0' && e.key <= '9') { window.pinDigit(e.key); }
        else if (e.key === 'Backspace')    { window.pinDel(); }
        else if (e.key === 'Enter')        { window.pinEnter(); }
    });

    window.pinDigit = function (d) {
        if (pinBuffer.length >= 4) return;
        pinBuffer += d;
        actualizarPinDisplay();
        if (pinBuffer.length === 4) pinEnter();
    };

    window.pinDel = function () {
        pinBuffer = pinBuffer.slice(0, -1);
        actualizarPinDisplay();
    };

    window.pinEnter = async function () {
        const errEl = document.getElementById('login-error');
        if (!usuarioSeleccionado) { errEl.textContent = 'Selecciona tu nombre primero.'; return; }
        if (pinBuffer.length < 4)  { errEl.textContent = 'Ingresa los 4 dígitos.'; return; }

        const hash = await sha256(pinBuffer);
        const { data, error } = await SB
            .from('pos_usuarios')
            .select('id, nombre, rol')
            .eq('id', usuarioSeleccionado.id)
            .eq('pin_hash', hash)
            .eq('activo', true)
            .single();

        pinBuffer = '';
        actualizarPinDisplay();

        if (error || !data) {
            errEl.textContent = 'PIN incorrecto. Intenta de nuevo.';
            return;
        }

        estado.usuario     = data;
        estado.turnoInicio = new Date();
        errEl.textContent  = '';
        abrirPOS();
    };

    window.seleccionarLocal = seleccionarLocal;

    // Aplicar tema café por defecto al cargar
    (function initLocal() {
        const btnCafe = document.querySelector('.local-btn[data-local="cafe"]');
        if (btnCafe) {
            aplicarTemaLocal('cafe');
            btnCafe.classList.add('active');
        }
    })();

    // ─── ABRIR POS ───────────────────────────────────────────────────────────
    async function abrirPOS() {
        document.getElementById('pantalla-login').style.display = 'none';
        aplicarTemaLocal(estado.local);
        document.getElementById('pantalla-pos').style.display   = 'flex';
        document.getElementById('header-local').textContent =
            estado.local === 'cafe' ? '☕ Café' : '🌭 Fuente de Soda';
        document.getElementById('header-usuario').textContent =
            estado.usuario.nombre + (estado.usuario.rol === 'admin' ? ' ⭐' : '');

        await cargarCatalogo();
        catActiva = CATS[estado.local][0].id;
        renderCatTabs();
        renderProductos();
        mostrarTabVenta();
    }

    // ─── CATÁLOGO ────────────────────────────────────────────────────────────
    async function cargarCatalogo() {
        try {
            const raw = await window.orbitaProductos.fetchJson(
                estado.local === 'cafe'
                    ? window.orbitaProductos.SITIO_CAFE
                    : window.orbitaProductos.SITIO_FUENTE
            );

            if (estado.local === 'cafe') {
                estado.catalogoCafe = Array.isArray(raw) ? raw : [];
            } else {
                // Fuente retorna objeto con .productos y .papas_tamanios
                const prods = raw && raw.productos ? raw.productos : [];
                const papas = raw && raw.papas_tamanios ? raw.papas_tamanios : [];
                // Agregar papas como productos con cat='extra' para el POS
                const papasProd = papas.map(p => ({
                    id: p.id, nombre: p.nombre, precio: p.precio,
                    costo: p.costo || 0, activo: p.activo !== false, cat: 'extra'
                }));
                estado.catalogoFuente = [...prods, ...papasProd];
            }
        } catch (e) {
            console.error('Error cargando catálogo:', e);
        }
    }

    function getCatalogo() {
        return estado.local === 'cafe' ? estado.catalogoCafe : estado.catalogoFuente;
    }

    // ─── RENDER CATEGORÍAS ───────────────────────────────────────────────────
    function renderCatTabs() {
        const tabs = document.getElementById('cat-tabs');
        tabs.innerHTML = '';
        CATS[estado.local].forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'cat-tab' + (cat.id === catActiva ? ' active' : '');
            btn.textContent = cat.label;
            btn.onclick = () => {
                catActiva = cat.id;
                document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderProductos();
            };
            tabs.appendChild(btn);
        });
    }

    // ─── RENDER PRODUCTOS ────────────────────────────────────────────────────
    function renderProductos() {
        const grid = document.getElementById('productos-grid');
        const catIds = [catActiva];
        if (catActiva === 'bebida') catIds.push('agua');
        const cat  = getCatalogo().filter(p => p.activo !== false && catIds.includes(p.cat));

        if (cat.length === 0) {
            grid.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:20px;">Sin productos en esta categoría.</div>';
            return;
        }

        grid.innerHTML = '';
        cat.forEach(p => {
            const card = document.createElement('button');
            card.className = 'producto-card';
            const sinPrecio = !p.precio || p.precio === 0;
            card.innerHTML = `
                <div class="prod-nombre">${p.nombre}</div>
                ${p.desc ? `<div class="prod-desc">${p.desc}</div>` : ''}
                <div class="prod-precio ${sinPrecio ? 'sin-precio' : ''}">${sinPrecio ? 'Sin precio' : fmt(p.precio)}</div>
            `;
            if (!sinPrecio) {
                card.onclick = () => agregarAComanda(p);
            } else {
                card.style.opacity = '0.5';
                card.style.cursor  = 'not-allowed';
                card.title = 'Configura el precio desde el panel admin';
            }
            grid.appendChild(card);
        });
    }

    // ─── COMANDA ─────────────────────────────────────────────────────────────
    function agregarAComanda(prod) {
        const existing = estado.comanda.find(i => i.id === prod.id);
        if (existing) {
            existing.qty++;
        } else {
            estado.comanda.push({ id: prod.id, nombre: prod.nombre, precio: prod.precio, costo: prod.costo || 0, qty: 1 });
        }
        renderComanda();
    }

    function renderComanda() {
        const el = document.getElementById('comanda-items');
        if (estado.comanda.length === 0) {
            el.innerHTML = '<div class="comanda-vacia">Sin productos</div>';
            document.getElementById('total-monto').textContent = '$0';
            document.getElementById('btn-cobrar').disabled = true;
            return;
        }

        el.innerHTML = '';
        let total = 0;
        estado.comanda.forEach((item, idx) => {
            const sub = item.precio * item.qty;
            total += sub;
            const row = document.createElement('div');
            row.className = 'comanda-item';
            row.innerHTML = `
                <div class="item-qty-ctrl">
                    <button class="qty-btn" onclick="cambiarQty(${idx},-1)">−</button>
                    <span class="qty-num">${item.qty}</span>
                    <button class="qty-btn" onclick="cambiarQty(${idx},1)">+</button>
                </div>
                <div class="item-info">
                    <div class="item-nombre">${item.nombre}</div>
                </div>
                <div class="item-subtotal">${fmt(sub)}</div>
            `;
            el.appendChild(row);
        });

        document.getElementById('total-monto').textContent = fmt(total);
        document.getElementById('btn-cobrar').disabled = false;
    }

    window.cambiarQty = function (idx, delta) {
        estado.comanda[idx].qty += delta;
        if (estado.comanda[idx].qty <= 0) estado.comanda.splice(idx, 1);
        renderComanda();
    };

    window.limpiarComanda = function () {
        if (estado.comanda.length === 0) return;
        if (!confirm('¿Limpiar la comanda actual?')) return;
        estado.comanda = [];
        document.getElementById('campo-nombre').value = '';
        document.getElementById('campo-tipo').value   = 'local';
        renderComanda();
    };

    // ─── MÉTODO DE PAGO ───────────────────────────────────────────────────────
    window.seleccionarPago = function (mp, btn) {
        estado.metodoPago = mp;
        document.querySelectorAll('.mp-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };

    // ─── MODAL COBRO ──────────────────────────────────────────────────────────
    window.abrirModalCobro = function () {
        const nombre = document.getElementById('campo-nombre').value.trim();
        if (!nombre) {
            document.getElementById('campo-nombre').focus();
            toast('Ingresa el nombre del cliente', 'err');
            return;
        }
        if (estado.comanda.length === 0) { toast('Agrega productos primero', 'err'); return; }

        const total = estado.comanda.reduce((s, i) => s + i.precio * i.qty, 0);
        document.getElementById('modal-cliente-nombre').textContent = nombre;
        document.getElementById('modal-monto').textContent = fmt(total);
        document.getElementById('modal-metodo').textContent = estado.metodoPago.toUpperCase();
        document.getElementById('modal-cobro').classList.remove('hidden');
    };

    window.cerrarModalCobro = function () {
        document.getElementById('modal-cobro').classList.add('hidden');
    };

    window.confirmarCobro = async function () {
        const nombre = document.getElementById('campo-nombre').value.trim();
        const tipo   = document.getElementById('campo-tipo').value;
        const total  = estado.comanda.reduce((s, i) => s + i.precio * i.qty, 0);
        const costo  = estado.comanda.reduce((s, i) => s + (i.costo || 0) * i.qty, 0);

        const items = estado.comanda.map(i => ({ id: i.id, nombre: i.nombre, precio: i.precio, qty: i.qty }));

        const { error } = await SB.from('pedidos').insert({
            sitio:        estado.local,
            nombre:       nombre,
            total:        total,
            costo_total:  costo,
            items_json:   items,
            estado:       'pagado',
            tipo_entrega: tipo,
            metodo_pago:  estado.metodoPago,
            origen:       'pos',
            cajero_id:    estado.usuario.id,
        });

        cerrarModalCobro();

        if (error) {
            console.error(error);
            toast('Error al guardar la venta', 'err');
            return;
        }

        toast(`✅ Venta de ${fmt(total)} registrada`, 'ok');
        estado.comanda = [];
        document.getElementById('campo-nombre').value = '';
        document.getElementById('campo-tipo').value   = 'local';
        renderComanda();
    };

    // ─── VISTA TABS ───────────────────────────────────────────────────────────
    window.mostrarTabVenta = function () {
        document.getElementById('vista-venta').classList.remove('hidden');
        document.getElementById('vista-pedidos').classList.add('hidden');
        document.getElementById('btn-tab-venta').style.borderColor = 'var(--primary)';
        document.getElementById('btn-tab-pedidos').style.borderColor = 'var(--border)';
    };

    window.mostrarTabPedidos = function () {
        document.getElementById('vista-venta').classList.add('hidden');
        document.getElementById('vista-pedidos').classList.remove('hidden');
        document.getElementById('btn-tab-pedidos').style.borderColor = 'var(--primary)';
        document.getElementById('btn-tab-venta').style.borderColor   = 'var(--border)';
        cargarPedidosWeb();
    };

    // ─── PEDIDOS WEB ──────────────────────────────────────────────────────────
    // ─── Notificación pedido nuevo ───────────────────────────────────────────
    let pedidosConocidos = new Set();

    function notificarPedidoNuevo(p) {
        // Toast especial
        const esDelivery = p.tipo_entrega === 'delivery';
        const el = document.getElementById('toast');
        el.textContent = esDelivery ? `🛵 Nuevo delivery — ${p.nombre}` : `📦 Nuevo pedido retiro — ${p.nombre}`;
        el.className = 'toast show ok';
        el.style.fontSize = '1rem';
        el.style.padding = '14px 20px';
        setTimeout(() => { el.className = 'toast'; el.style = ''; }, 4000);
        // Sonido
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [523, 659, 784].forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.value = freq;
                o.type = 'sine';
                g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
                o.start(ctx.currentTime + i * 0.15);
                o.stop(ctx.currentTime + i * 0.15 + 0.3);
            });
        } catch(e) {}
    }

    window.cargarPedidosWeb = async function () {
        const lista = document.getElementById('pedidos-web-list');
        lista.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:20px;text-align:center;">Cargando…</div>';

        const { data, error } = await SB
            .from('pedidos')
            .select('*')
            .eq('sitio', estado.local)
            .in('estado', ['pendiente', 'pagado', 'whatsapp', 'en_cocina', 'listo', 'en_camino'])
            .order('creado_at', { ascending: true });

        if (error || !data || data.length === 0) {
            lista.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:40px;text-align:center;">Sin pedidos pendientes ✅</div>';
            return;
        }

        lista.innerHTML = '';
        data.forEach(p => {
            // Notificar si es un pedido que no conocíamos
            if (!pedidosConocidos.has(p.id) && pedidosConocidos.size > 0) {
                if (['pendiente','pagado','whatsapp'].includes(p.estado)) notificarPedidoNuevo(p);
            }
            pedidosConocidos.add(p.id);
            const items = Array.isArray(p.items_json)
                ? p.items_json.map(i => `${i.qty ?? i.cantidad ?? '?'}x ${i.nombre}`).join(', ')
                : '—';
            const badgeClass = {
                pagado:     'badge-pagado',
                whatsapp:   'badge-whatsapp',
                en_cocina:  'badge-en-cocina',
                listo:      'badge-listo',
                en_camino:  'badge-en-camino',
                pendiente:  'badge-pendiente',
            }[p.estado] || 'badge-pendiente';
            const badgeLabel = {
                pagado:    'Pagado',
                whatsapp:  'WhatsApp',
                en_cocina: 'En cocina 🍳',
                listo:     'Listo ✅',
                en_camino: 'En camino 🛵',
                pendiente: 'Pendiente',
            }[p.estado] || p.estado;

            const esDelivery = p.tipo_entrega === 'delivery';
            const hora = new Date(p.creado_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

            const card = document.createElement('div');
            card.className = 'pedido-web-card';
            card.innerHTML = `
                <div class="pedido-web-header">
                    <span class="pedido-web-nombre">${p.nombre} · ${hora}</span>
                    <span class="badge-estado ${badgeClass}">${badgeLabel}</span>
                </div>
                <div class="pedido-web-items">${items}</div>
                ${esDelivery && p.direccion ? `<div class="pedido-web-dir">📍 ${p.direccion}</div>` : ''}
                <div class="pedido-web-total">${fmt(p.total)}</div>
                <div class="pedido-web-actions" id="acciones-${p.id}"></div>
            `;
            lista.appendChild(card);
            renderAccionesPedido(p, card.querySelector(`#acciones-${p.id}`));
        });
    };

    function renderAccionesPedido(p, container) {
        container.innerHTML = '';
        const esDelivery = p.tipo_entrega === 'delivery';

        // Estado: pendiente o whatsapp → pasar a En Cocina
        if (p.estado === 'pendiente' || p.estado === 'whatsapp' || p.estado === 'pagado') {
            const btn = document.createElement('button');
            btn.className = 'btn-accion btn-despachar';
            btn.textContent = '🍳 En cocina';
            btn.onclick = () => cambiarEstadoPedido(p.id, 'en_cocina', true);
            container.appendChild(btn);
        }

        // Estado: en_cocina → marcar Listo (dispara WhatsApp al repartidor si es delivery)
        if (p.estado === 'en_cocina') {
            const btn = document.createElement('button');
            btn.className = 'btn-accion btn-confirmar';
            btn.style.background = '#b8860b';
            btn.textContent = '✅ Listo';
            btn.onclick = () => marcarListo(p);
            container.appendChild(btn);
        }

        // Estado: listo → En camino (dispara WhatsApp al cliente)
        if (p.estado === 'listo') {
            if (esDelivery) {
                const btn = document.createElement('button');
                btn.className = 'btn-accion btn-despachar';
                btn.textContent = '🛵 En camino';
                btn.onclick = () => marcarEnCamino(p);
                container.appendChild(btn);
            } else {
                // Retiro en local → entregado directo
                const btn = document.createElement('button');
                btn.className = 'btn-accion btn-confirmar';
                btn.textContent = '✅ Entregado';
                btn.onclick = () => cambiarEstadoPedido(p.id, 'recibido', true);
                container.appendChild(btn);
            }
        }

        // Estado: en_camino → esperando repartidor
        if (p.estado === 'en_camino') {
            const info = document.createElement('span');
            info.style.cssText = 'font-size:0.8rem;color:var(--blue);padding:10px 0;display:block;';
            info.textContent = '🛵 Esperando confirmación del repartidor…';
            container.appendChild(info);
        }

        // Anular disponible en todos los estados activos
        if (!['recibido','anulado'].includes(p.estado)) {
            const btnAnul = document.createElement('button');
            btnAnul.className = 'btn-accion btn-anular-web';
            btnAnul.textContent = '✕ Anular';
            btnAnul.onclick = () => abrirModalAnular(p.id, p.nombre);
            container.appendChild(btnAnul);
        }
    }

    async function cambiarEstadoPedido(id, estadoNuevo, recargar = false) {
        const { error } = await SB.from('pedidos').update({ estado: estadoNuevo }).eq('id', id);
        if (error) { toast('Error al actualizar pedido', 'err'); return; }
        toast('Pedido actualizado ✅', 'ok');
        if (recargar) cargarPedidosWeb();
    }

    // Genera código de 4 dígitos
    function generarCodigo() {
        return String(Math.floor(1000 + Math.random() * 9000));
    }

    // Cajero marca "Listo" → WhatsApp al repartidor si es delivery
    async function marcarListo(p) {
        // Generar y guardar código si es delivery
        let codigo = p.codigo_entrega;
        if (p.tipo_entrega === 'delivery' && !codigo) {
            codigo = generarCodigo();
            await SB.from('pedidos').update({ codigo_entrega: codigo }).eq('id', p.id);
        }
        await cambiarEstadoPedido(p.id, 'listo');

        if (p.tipo_entrega === 'delivery') {
            // WhatsApp al repartidor
            const { data } = await SB.from('pos_config').select('valor_text').eq('clave', 'wsp_repartidor').single();
            const numRepartidor = data?.valor_text || '';
            if (!numRepartidor || numRepartidor === '+56900000000') {
                toast('Configura el número del repartidor en el panel admin', 'err');
            } else {
                const localNombre = estado.local === 'cafe' ? 'CAFÉ ÓRBITA' : 'FUENTE DE SODA ÓRBITA';
                const items = Array.isArray(p.items_json)
                    ? p.items_json.map(i => `• ${i.qty ?? i.cantidad ?? '?'}x ${i.nombre}`).join('\n')
                    : '—';
                const linkEntrega = `${window.location.origin}/entrega.html?id=${p.id}`;
                const msg = encodeURIComponent(
                    `🛵 PEDIDO LISTO — ${localNombre}\n\n` +
                    `👤 Cliente: ${p.nombre}\n` +
                    `📍 Dirección: ${p.direccion || p.direccion_entrega || 'Sin dirección'}\n\n` +
                    `📋 Pedido:\n${items}\n\n` +
                    `💰 Total: ${fmt(p.total)}\n` +
                    `🔑 Código de entrega: ${codigo}\n\n` +
                    `✅ Confirmar entrega → ${linkEntrega}`
                );
                window.open(`https://wa.me/${numRepartidor.replace(/\D/g, '')}?text=${msg}`, '_blank');
            }
        }
        cargarPedidosWeb();
    }

    // Cajero marca "En camino" → WhatsApp al cliente
    async function marcarEnCamino(p) {
        await cambiarEstadoPedido(p.id, 'en_camino');

        // WhatsApp al cliente si tiene teléfono
        const telefono = p.telefono || p.telefono_cliente || '';
        if (telefono) {
            const items = Array.isArray(p.items_json)
                ? p.items_json.map(i => `• ${i.qty ?? i.cantidad ?? '?'}x ${i.nombre}`).join('\n')
                : '—';
            const msg = encodeURIComponent(
                `🛵 ¡Tu pedido está en camino!\n\n` +
                `📋 ${items}\n` +
                `💰 Total: ${fmt(p.total)}\n\n` +
                `🔑 Código de entrega: ${p.codigo_entrega}\n` +
                `(Muéstraselo al repartidor al recibir tu pedido)`
            );
            window.open(`https://wa.me/${telefono.replace(/\D/g, '')}?text=${msg}`, '_blank');
        }
        cargarPedidosWeb();
    }

    // ─── ANULAR ───────────────────────────────────────────────────────────────
    window.abrirModalAnular = function (id, nombre) {
        estado.pedidoAnularId = id;
        document.getElementById('anular-cliente').textContent = nombre;
        document.getElementById('modal-anular').classList.remove('hidden');
    };

    window.cerrarModalAnular = function () {
        document.getElementById('modal-anular').classList.add('hidden');
        estado.pedidoAnularId = null;
    };

    window.confirmarAnulacion = async function () {
        if (!estado.pedidoAnularId) return;
        await cambiarEstadoPedido(estado.pedidoAnularId, 'anulado', true);
        cerrarModalAnular();
    };

    // ─── CIERRE DE TURNO ──────────────────────────────────────────────────────
    window.abrirCierreTurno = async function () {
        // Traer ventas del turno actual (desde turnoInicio)
        const desde = estado.turnoInicio.toISOString();
        const { data } = await SB
            .from('pedidos')
            .select('total, metodo_pago, estado, origen')
            .eq('sitio', estado.local)
            .gte('creado_at', desde);

        const ventas   = (data || []).filter(p => p.estado !== 'anulado');
        const anuladas = (data || []).filter(p => p.estado === 'anulado');

        const sum = (mp) => ventas.filter(p => p.metodo_pago === mp || (mp === 'online' && p.origen === 'web' && p.estado === 'pagado')).reduce((s, p) => s + (p.total || 0), 0);

        const efectivo    = sum('efectivo');
        const tarjeta     = sum('tarjeta');
        const transfer    = sum('transferencia');
        const online      = ventas.filter(p => p.origen === 'web').reduce((s, p) => s + (p.total || 0), 0);
        const totalGeneral = efectivo + tarjeta + transfer + online;

        document.getElementById('cierre-cajero').textContent     = estado.usuario.nombre;
        document.getElementById('cierre-total-monto').textContent = fmt(totalGeneral);
        document.getElementById('cierre-efectivo').textContent    = fmt(efectivo);
        document.getElementById('cierre-tarjeta').textContent     = fmt(tarjeta);
        document.getElementById('cierre-transfer').textContent    = fmt(transfer);
        document.getElementById('cierre-online').textContent      = fmt(online);
        document.getElementById('cierre-num-trans').textContent   = ventas.length;
        document.getElementById('cierre-num-anul').textContent    = anuladas.length;

        document.getElementById('modal-cierre').classList.remove('hidden');
    };

    window.cerrarModalCierre = function () {
        document.getElementById('modal-cierre').classList.add('hidden');
    };

    window.confirmarCierre = async function () {
        const desde = estado.turnoInicio.toISOString();
        const { data } = await SB
            .from('pedidos')
            .select('total, metodo_pago, estado, origen')
            .eq('sitio', estado.local)
            .gte('creado_at', desde);

        const ventas   = (data || []).filter(p => p.estado !== 'anulado');
        const anuladas = (data || []).filter(p => p.estado === 'anulado');
        const sum = (mp) => ventas.filter(p => p.metodo_pago === mp).reduce((s, p) => s + (p.total || 0), 0);

        await SB.from('cierres_turno').insert({
            cajero_id:      estado.usuario.id,
            sitio:          estado.local,
            turno_inicio:   desde,
            turno_fin:      new Date().toISOString(),
            total_efectivo: sum('efectivo'),
            total_tarjeta:  sum('tarjeta'),
            total_transfer: sum('transferencia'),
            total_online:   ventas.filter(p => p.origen === 'web').reduce((s, p) => s + (p.total || 0), 0),
            total_ventas:   ventas.reduce((s, p) => s + (p.total || 0), 0),
            num_transacc:   ventas.length,
            num_anuladas:   anuladas.length,
        });

        cerrarModalCierre();
        toast('Turno cerrado correctamente ✅', 'ok');

        // Volver al login
        setTimeout(() => {
            estado.usuario     = null;
            estado.turnoInicio = null;
            estado.comanda     = [];
            document.getElementById('pantalla-pos').style.display   = 'none';
            document.getElementById('pantalla-login').style.display = 'flex';
            pinBuffer = '';
            actualizarPinDisplay();
            cargarUsuarios();
        }, 1500);
    };

    // ─── CERRAR SESIÓN ────────────────────────────────────────────────────────
    window.cerrarSesionPOS = function () {
        if (!confirm('¿Cerrar sesión? El turno no se guardará.')) return;
        estado.usuario     = null;
        estado.turnoInicio = null;
        estado.comanda     = [];
        document.getElementById('pantalla-pos').style.display   = 'none';
        document.getElementById('pantalla-login').style.display = 'flex';
        pinBuffer = '';
        actualizarPinDisplay();
        cargarUsuarios();
    };

    // ─── INIT ─────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        cargarUsuarios();
        // Comanda vacía inicial
        renderComanda();
    });

})();
