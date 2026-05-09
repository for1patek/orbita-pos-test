/**
 * orbita-pos.js — Lógica del Punto de Venta Órbita 300
 * Requiere: supabase-js → orbita-auth.js → orbita-productos.js → este archivo
 */

(function () {
    'use strict';

    // ─── Llave admin por URL (?k=orbita_8h3k2p_2026) ────────────────────────
    const POS_ADMIN_KEY = new URLSearchParams(window.location.search).get('k') === 'orbita_8h3k2p_2026';
    let posAdminDesbloqueado = false;

    if (POS_ADMIN_KEY) {
        // Mostrar banner al cargar
        const banner = document.createElement('div');
        banner.id = 'pos-admin-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 14px;font-family:DM Sans,sans-serif;font-size:0.88rem;text-align:center;background:rgba(17,17,17,0.96);color:#fff;border-bottom:2px solid #8B1A1A;';
        banner.innerHTML = 'Modo admin activo — <button onclick="abrirAdminLogin()" style="margin-left:8px;padding:4px 12px;background:var(--primary,#8B1A1A);border:none;border-radius:6px;color:#fff;font-size:0.82rem;cursor:pointer;font-family:DM Sans,sans-serif;font-weight:700;">Ingresar credenciales</button>';
        document.body.insertBefore(banner, document.body.firstChild);
        document.body.style.paddingTop = '44px';
    }

    window.abrirAdminLogin = function () {
        document.getElementById('admin-login-email').value = '';
        document.getElementById('admin-login-pass').value = '';
        document.getElementById('admin-login-error').style.display = 'none';
        document.getElementById('modal-admin-login').classList.remove('hidden');
        setTimeout(() => document.getElementById('admin-login-email').focus(), 100);
    };

    window.cerrarAdminLogin = function () {
        document.getElementById('modal-admin-login').classList.add('hidden');
    };

    window.verificarAdminLogin = async function () {
        const email    = document.getElementById('admin-login-email').value.trim();
        const password = document.getElementById('admin-login-pass').value;
        const errDiv   = document.getElementById('admin-login-error');
        errDiv.style.display = 'none';
        if (!email || !password) {
            errDiv.textContent = 'Ingresa email y contraseña.';
            errDiv.style.display = 'block';
            return;
        }
        try {
            const result = await window.orbitaAuth.signIn(email, password);
            if (!result || result.error) {
                errDiv.textContent = result?.error?.message || 'Credenciales incorrectas';
                errDiv.style.display = 'block';
                document.getElementById('admin-login-pass').value = '';
                return;
            }
            posAdminDesbloqueado = true;
            cerrarAdminLogin();
            // Actualizar banner
            const banner = document.getElementById('pos-admin-banner');
            if (banner) banner.innerHTML = '🔑 Modo admin activo';
            // Mostrar botón usuarios si ya hay sesión POS activa
            const btnUsr = document.getElementById('btn-usuarios');
            if (btnUsr) btnUsr.style.display = 'inline-block';
        } catch(e) {
            errDiv.textContent = e.message || 'Error al iniciar sesión';
            errDiv.style.display = 'block';
            document.getElementById('admin-login-pass').value = '';
        }
    };

    document.getElementById('modal-admin-login')?.addEventListener('click', function(e) {
        if (e.target === this) cerrarAdminLogin();
    });

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

        // Guardar sesión para sobrevivir F5
        sessionStorage.setItem('orbita_sesion', JSON.stringify({
            usuario:     data,
            local:       estado.local,
            turnoInicio: estado.turnoInicio.toISOString(),
        }));

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

        // Botones config y usuarios: solo visibles en modo admin (llave URL)
        const btnCfg = document.getElementById('btn-config');
        if (btnCfg) btnCfg.style.display = posAdminDesbloqueado ? 'inline-block' : 'none';
        const btnUsr = document.getElementById('btn-usuarios');
        if (btnUsr) btnUsr.style.display = posAdminDesbloqueado ? 'inline-block' : 'none';

        await cargarCatalogo();
        catActiva = CATS[estado.local][0].id;
        renderCatTabs();
        renderProductos();
        mostrarTabVenta();
        iniciarBgPolling(); // badge y sonido siempre activos
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
                // Cargar hand rolls del sitio handroll e incorporarlos a la fuente
                let handrolls = [];
                try {
                    const rawHR = await window.orbitaProductos.fetchJson(
                        window.orbitaProductos.SITIO_HANDROLL
                    );
                    const hrProds = Array.isArray(rawHR) ? rawHR : [];
                    handrolls = hrProds
                        .filter(p => p.activo !== false && (p.categoria === 'handroll' || p.cat === 'handroll'))
                        .map(p => ({ ...p, cat: 'handroll' }));
                } catch (e) {
                    console.error('Error cargando hand rolls para fuente:', e);
                }
                estado.catalogoFuente = [...prods, ...papasProd, ...handrolls];
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
            sitio:               estado.local,
            nombre:              nombre,
            total:               total,
            items_json:          items,
            estado:              'pagado',
            tipo_entrega:        tipo === 'local' ? 'local' : 'retiro',
            origen:              'fisico',
            cajero_id:           estado.usuario.id,
            metodo_pago_entrega: estado.metodoPago || 'efectivo',
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
    let autoRefreshInterval  = null;
    let bgPollingInterval = null; // polling liviano siempre activo

    // Polling de fondo: badge siempre, sonido solo cuando llega pedido nuevo
    async function bgPolling() {
        if (!estado.usuario || !estado.local) return;
        const { data } = await SB
            .from('pedidos')
            .select('id, estado')
            .eq('sitio', estado.local)
            .in('estado', ['pendiente', 'pagado', 'whatsapp', 'en_cocina', 'listo', 'en_camino']);

        if (!data) return;

        const activos = data.filter(p =>
            ['pendiente', 'pagado', 'whatsapp', 'en_cocina', 'listo'].includes(p.estado)
        );

        // Sonar solo si llega un pedido que no conocíamos (cualquier canal)
        let hayNuevo = false;
        data.forEach(p => {
            if (!pedidosConocidos.has(p.id)) {
                hayNuevo = true;
            }
            pedidosConocidos.add(p.id);
        });

        if (hayNuevo) notificarPedidoNuevo();
        actualizarBadgePendientes(activos.length);
    }

    function iniciarBgPolling() {
        if (bgPollingInterval) return;
        bgPolling(); // primera ejecución inmediata
        bgPollingInterval = setInterval(bgPolling, 8000);
    }

    window.mostrarTabPedidos = function () {
        document.getElementById('vista-venta').classList.add('hidden');
        document.getElementById('vista-pedidos').classList.remove('hidden');
        document.getElementById('btn-tab-pedidos').style.borderColor = 'var(--primary)';
        document.getElementById('btn-tab-venta').style.borderColor   = 'var(--border)';
        cargarPedidosWeb();
        // Auto-refresh completo (renderiza lista) solo cuando está en esta pestaña
        if (!autoRefreshInterval) {
            autoRefreshInterval = setInterval(cargarPedidosWeb, 8000);
        }
    };

    window.mostrarTabVenta = function () {
        document.getElementById('vista-venta').classList.remove('hidden');
        document.getElementById('vista-pedidos').classList.add('hidden');
        document.getElementById('btn-tab-venta').style.borderColor   = 'var(--primary)';
        document.getElementById('btn-tab-pedidos').style.borderColor = 'var(--border)';
        // Detener auto-refresh cuando no está en pedidos web
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    };

    // ─── PEDIDOS WEB ──────────────────────────────────────────────────────────
    // ─── Notificación pedido nuevo ───────────────────────────────────────────
    let pedidosConocidos = new Set();

    function notificarPedidoNuevo(p) {
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

    function actualizarBadgePendientes(total) {
        const badge = document.getElementById('badge-pendientes');
        if (!badge) return;
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
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
        // Contar pendientes activos
        const pendientesActivos = data.filter(p => ['pendiente','pagado','whatsapp','en_cocina','listo'].includes(p.estado)).length;
        actualizarBadgePendientes(pendientesActivos);

        data.forEach(p => {
            // bgPolling maneja sonido y badge — aquí solo registramos ids conocidos
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
                ${esDelivery && p.direccion_entrega ? `<div class="pedido-web-dir">📍 ${p.direccion_entrega}</div>` : ''}
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
                // Retiro en local -> modal para validar codigo y cobrar
                const btn = document.createElement('button');
                btn.className = 'btn-accion btn-confirmar';
                btn.textContent = '📦 Entregar';
                btn.onclick = () => abrirModalRetiro(p);
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
        // Disparar push notification al cliente (silencioso — no bloquea el flujo)
        try {
            fetch(`${window.orbitaAuth.url}/functions/v1/send-push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.orbitaAuth.anonKey}`
                },
                body: JSON.stringify({ pedido_id: id, estado_nuevo: estadoNuevo })
            }).catch(() => {}); // silencioso si falla
        } catch(e) {}
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
                    `📍 Dirección: ${p.direccion_entrega || 'Sin dirección'}\n\n` +
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

    // ─── HISTORIAL ────────────────────────────────────────────────────────────
    const ESTADO_LABEL = {
        pendiente:  'Pendiente',
        pagado:     'Pagado',
        whatsapp:   'WhatsApp',
        en_cocina:  'En cocina',
        listo:      'Listo',
        en_camino:  'En camino',
        recibido:   'Entregado ✅',
        rechazado:  'Rechazado ❌',
        anulado:    'Anulado ❌',
        fisico:     'Físico',
    };

    const ORIGEN_LABEL = {
        web:       '🌐 Web',
        whatsapp:  '💬 WhatsApp',
        fisico:    '🏠 Físico',
    };

    window.abrirHistorial = async function () {
        document.getElementById('modal-historial').classList.remove('hidden');
        const lista = document.getElementById('historial-lista');
        lista.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">Cargando…</div>';

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        const { data, error } = await SB
            .from('pedidos')
            .select('id, nombre, estado, origen, tipo_entrega, total, items_json, creado_at, metodo_pago_entrega')
            .eq('sitio', estado.local)
            .gte('creado_at', hoy.toISOString())
            .order('creado_at', { ascending: false });

        if (error || !data || data.length === 0) {
            lista.innerHTML = '<div style="color:var(--muted);text-align:center;padding:30px;">Sin pedidos hoy</div>';
            return;
        }

        lista.innerHTML = '';
        data.forEach(p => {
            const hora  = new Date(p.creado_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
            const estadoLabel  = ESTADO_LABEL[p.estado]  || p.estado;
            const origenLabel  = ORIGEN_LABEL[p.origen]  || p.origen;
            const estadoColor  = ['recibido'].includes(p.estado) ? 'var(--green)'
                               : ['anulado','rechazado'].includes(p.estado) ? 'var(--red)'
                               : 'var(--gold)';

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:10px;transition:background 0.15s;';
            row.innerHTML = `
                <div>
                    <div style="font-weight:700;font-size:0.9rem;">${p.nombre || '—'}</div>
                    <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">${hora} · ${origenLabel}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:1.1rem;color:var(--gold);">${fmt(p.total)}</div>
                    <div style="font-size:0.72rem;color:${estadoColor};font-weight:700;">${estadoLabel}</div>
                </div>
            `;
            row.onmouseenter = () => row.style.background = 'var(--surface)';
            row.onmouseleave = () => row.style.background = 'transparent';
            row.onclick = () => abrirDetallePedido(p);
            lista.appendChild(row);
        });
    };

    window.cerrarHistorial = function () {
        document.getElementById('modal-historial').classList.add('hidden');
    };

    window.abrirDetallePedido = function (p) {
        const hora  = new Date(p.creado_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        const items = Array.isArray(p.items_json)
            ? p.items_json.map(i => `
                <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.88rem;">
                    <span><span style="color:var(--muted);">${i.qty || 1}×</span> ${i.nombre}</span>
                    <span style="color:var(--gold);">${fmt((i.precio || 0) * (i.qty || 1))}</span>
                </div>`).join('')
            : '<div style="color:var(--muted);">Sin detalle</div>';

        const metodoPago = p.metodo_pago_entrega
            ? { efectivo: '💵 Efectivo', transferencia: '🏦 Transferencia', online: '🌐 Online' }[p.metodo_pago_entrega] || p.metodo_pago_entrega
            : '—';

        document.getElementById('detalle-pedido-contenido').innerHTML = `
            <div style="background:var(--surface);border-radius:12px;padding:16px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;">Cliente</span>
                    <span style="font-weight:700;">${p.nombre || '—'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;">Hora</span>
                    <span>${hora}</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;">Origen</span>
                    <span>${ORIGEN_LABEL[p.origen] || p.origen}</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;">Tipo</span>
                    <span>${p.tipo_entrega || '—'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;">Pago</span>
                    <span>${metodoPago}</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                    <span style="color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;">Estado</span>
                    <span style="font-weight:700;">${ESTADO_LABEL[p.estado] || p.estado}</span>
                </div>
            </div>
            <div style="margin-bottom:12px;">${items}</div>
            <div style="display:flex;justify-content:space-between;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--gold);padding-top:10px;border-top:1px solid var(--border);">
                <span>TOTAL</span>
                <span>${fmt(p.total)}</span>
            </div>
        `;
        document.getElementById('modal-detalle-pedido').classList.remove('hidden');
    };

    window.cerrarDetallePedido = function () {
        document.getElementById('modal-detalle-pedido').classList.add('hidden');
    };

    // Cerrar modales historial con click fuera
    document.getElementById('modal-historial').addEventListener('click', function(e) {
        if (e.target === this) cerrarHistorial();
    });
    document.getElementById('modal-detalle-pedido').addEventListener('click', function(e) {
        if (e.target === this) cerrarDetallePedido();
    });
    window.abrirCierreTurno = async function () {
        // Traer ventas del turno actual (desde turnoInicio)
        const desde = estado.turnoInicio.toISOString();
        const { data } = await SB
            .from('pedidos')
            .select('total, metodo_pago_entrega, estado, origen')
            .eq('sitio', estado.local)
            .gte('creado_at', desde);

        const ventas   = (data || []).filter(p => p.estado !== 'anulado');
        const anuladas = (data || []).filter(p => p.estado === 'anulado');

        // Efectivo: físicos + delivery pagado en efectivo al repartidor
        const efectivo = ventas.filter(p => p.metodo_pago_entrega === 'efectivo').reduce((s, p) => s + (p.total || 0), 0);
        // Tarjeta: físicos pagados con tarjeta en el local
        const tarjeta  = ventas.filter(p => p.origen === 'fisico' && p.metodo_pago_entrega === 'tarjeta').reduce((s, p) => s + (p.total || 0), 0);
        // Transferencia: físicos + delivery pagado por transferencia al repartidor
        const transfer = ventas.filter(p => p.metodo_pago_entrega === 'transferencia').reduce((s, p) => s + (p.total || 0), 0);
        // Online: pedidos web pagados con MercadoPago
        const online   = ventas.filter(p => p.origen === 'web' && p.metodo_pago_entrega === 'online').reduce((s, p) => s + (p.total || 0), 0);
        const totalGeneral = ventas.reduce((s, p) => s + (p.total || 0), 0);

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
            .select('total, metodo_pago_entrega, estado, origen')
            .eq('sitio', estado.local)
            .gte('creado_at', desde);

        const ventas   = (data || []).filter(p => p.estado !== 'anulado');
        const anuladas = (data || []).filter(p => p.estado === 'anulado');

        await SB.from('cierres_turno').insert({
            cajero_id:      estado.usuario.id,
            sitio:          estado.local,
            turno_inicio:   desde,
            turno_fin:      new Date().toISOString(),
            total_efectivo: ventas.filter(p => p.metodo_pago_entrega === 'efectivo').reduce((s, p) => s + (p.total || 0), 0),
            total_tarjeta:  ventas.filter(p => p.origen === 'fisico' && p.metodo_pago_entrega === 'tarjeta').reduce((s, p) => s + (p.total || 0), 0),
            total_transfer: ventas.filter(p => p.metodo_pago_entrega === 'transferencia').reduce((s, p) => s + (p.total || 0), 0),
            total_online:   ventas.filter(p => p.origen === 'web' && p.metodo_pago_entrega === 'online').reduce((s, p) => s + (p.total || 0), 0),
            total_ventas:   ventas.reduce((s, p) => s + (p.total || 0), 0),
            num_transacc:   ventas.length,
            num_anuladas:   anuladas.length,
        });

        cerrarModalCierre();
        toast('Turno cerrado correctamente ✅', 'ok');

        // Volver al login
        setTimeout(() => {
            sessionStorage.removeItem('orbita_sesion');
            if (bgPollingInterval) { clearInterval(bgPollingInterval); bgPollingInterval = null; }
            if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
            pedidosConocidos.clear();
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
        sessionStorage.removeItem('orbita_sesion');
        if (bgPollingInterval) { clearInterval(bgPollingInterval); bgPollingInterval = null; }
        if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
        pedidosConocidos.clear();
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
        // Restaurar sesión si el cajero hizo F5
        const sesionGuardada = sessionStorage.getItem('orbita_sesion');
        if (sesionGuardada) {
            try {
                const s = JSON.parse(sesionGuardada);
                estado.usuario     = s.usuario;
                estado.local       = s.local;
                estado.turnoInicio = new Date(s.turnoInicio);
                abrirPOS();
                return;
            } catch (e) {
                sessionStorage.removeItem('orbita_sesion');
            }
        }
        cargarUsuarios();
        // Comanda vacía inicial
        renderComanda();
    });


    // ─── MODAL RETIRO ─────────────────────────────────────────────────────────
    let pedidoRetiroActual = null;

    window.abrirModalRetiro = function (p) {
        pedidoRetiroActual = p;
        const esWeb = p.origen === 'web';

        document.getElementById('retiro-nombre').textContent = p.nombre;

        // Mostrar/ocultar sección de código según origen
        // Web: el cliente tiene código → cajero lo valida
        // Físico: no hay código, cajero solo confirma que el cliente retiró
        const codigoSection = document.getElementById('retiro-codigo-section');
        codigoSection.style.display = esWeb ? 'block' : 'none';
        document.getElementById('retiro-codigo').value = '';
        document.getElementById('retiro-codigo-error').style.display = 'none';

        document.getElementById('modal-retiro').classList.remove('hidden');
        if (esWeb) setTimeout(() => document.getElementById('retiro-codigo').focus(), 100);
    };

    window.cerrarModalRetiro = function () {
        document.getElementById('modal-retiro').classList.add('hidden');
        pedidoRetiroActual = null;
    };

    window.confirmarRetiro = async function () {
        if (!pedidoRetiroActual) return;
        const esWeb = pedidoRetiroActual.origen === 'web';

        // Solo validar código en pedidos web
        if (esWeb) {
            const codigoIngresado = document.getElementById('retiro-codigo').value.trim();
            const codigoCorrecto  = String(pedidoRetiroActual.codigo_entrega || '');
            const errEl           = document.getElementById('retiro-codigo-error');
            if (codigoIngresado !== codigoCorrecto) {
                errEl.style.display = 'block';
                document.getElementById('retiro-codigo').focus();
                return;
            }
            errEl.style.display = 'none';
        }

        const { error } = await SB.from('pedidos')
            .update({ estado: 'recibido' })
            .eq('id', pedidoRetiroActual.id);

        if (error) { toast('Error al confirmar retiro', 'err'); return; }

        toast('✅ Retirado', 'ok');
        cerrarModalRetiro();
        cargarPedidosWeb();
    };

    // Cerrar retiro con click fuera
    document.getElementById('modal-retiro')?.addEventListener('click', function(e) {
        if (e.target === this) cerrarModalRetiro();
    });

    // ─── CONFIGURACIÓN (admin) ────────────────────────────────────────────────
    window.abrirConfig = async function () {
        // Cargar valores actuales de pos_config
        const { data } = await SB.from('pos_config').select('clave, valor_text');
        if (data) {
            const map = {};
            data.forEach(r => { map[r.clave] = r.valor_text; });
            const r = document.getElementById('cfg-wsp-repartidor');
            const l = document.getElementById('cfg-wsp-local');
            const e = document.getElementById('cfg-email');
            if (r) r.value = map['wsp_repartidor'] || '';
            if (l) l.value = map['wsp_local']      || '';
            if (e) e.value = map['email_contacto'] || '';
        }
        document.getElementById('modal-config').classList.remove('hidden');
    };

    window.cerrarConfig = function () {
        document.getElementById('modal-config').classList.add('hidden');
    };

    window.guardarConfig = async function () {
        const campos = [
            { clave: 'wsp_repartidor', id: 'cfg-wsp-repartidor' },
            { clave: 'wsp_local',      id: 'cfg-wsp-local' },
            { clave: 'email_contacto', id: 'cfg-email' },
        ];

        for (const c of campos) {
            const val = document.getElementById(c.id)?.value.trim() || '';
            await SB.from('pos_config')
                .upsert({ clave: c.clave, valor_text: val }, { onConflict: 'clave' });
        }

        toast('Configuración guardada ✅', 'ok');
        cerrarConfig();
    };

    // Cerrar config con click fuera
    document.getElementById('modal-config')?.addEventListener('click', function(e) {
        if (e.target === this) cerrarConfig();
    });

    // ── GESTIÓN DE USUARIOS ──────────────────────────────────────────────────

    window.abrirUsuarios = async function () {
        document.getElementById('modal-usuarios').classList.remove('hidden');
        cancelarFormUsuario();
        await renderListaUsuarios();
    };

    window.cerrarUsuarios = function () {
        document.getElementById('modal-usuarios').classList.add('hidden');
    };

    async function renderListaUsuarios() {
        const lista = document.getElementById('usuarios-lista');
        lista.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:20px;">Cargando…</div>';
        try {
            const { data, error } = await SB
                .from('pos_usuarios')
                .select('id,nombre,rol,sitio,activo')
                .order('nombre');
            if (error) throw error;
            if (!data.length) {
                lista.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:20px;">Sin usuarios</div>';
                return;
            }
            lista.innerHTML = data.map(u => `
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:0.9rem;${!u.activo ? 'color:var(--muted);text-decoration:line-through;' : ''}">${u.nombre}</div>
                        <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">
                            ${u.rol === 'admin' ? '⭐ Admin' : '👤 Cajero'} · 
                            ${u.sitio === 'cafe' ? '☕ Café' : u.sitio === 'fuente' ? '🌭 Fuente' : '🔀 Ambos'}
                            ${!u.activo ? ' · <span style="color:var(--red);">Inactivo</span>' : ''}
                        </div>
                    </div>
                    <button onclick="editarUsuario('${u.id}','${u.nombre}','${u.rol}','${u.sitio}',${u.activo})"
                        style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--muted);font-size:0.75rem;cursor:pointer;">✏️</button>
                    <button onclick="toggleActivoUsuario('${u.id}',${u.activo})"
                        style="padding:6px 10px;border:1px solid ${u.activo ? 'var(--red)' : 'var(--green)'};border-radius:8px;background:var(--card);color:${u.activo ? 'var(--red)' : 'var(--green)'};font-size:0.75rem;cursor:pointer;">${u.activo ? '🚫' : '✅'}</button>
                    <button onclick="eliminarUsuario('${u.id}','${u.nombre}')"
                        style="padding:6px 10px;border:1px solid var(--red);border-radius:8px;background:var(--card);color:var(--red);font-size:0.75rem;cursor:pointer;">🗑️</button>
                </div>
            `).join('');
        } catch(e) {
            lista.innerHTML = '<div style="color:var(--red);font-size:0.85rem;text-align:center;padding:20px;">Error cargando usuarios</div>';
        }
    }

    window.nuevoUsuario = function () {
        document.getElementById('usr-id').value = '';
        document.getElementById('usr-nombre').value = '';
        document.getElementById('usr-rol').value = 'cajero';
        document.getElementById('usr-sitio').value = estado.local; // default al local actual
        document.getElementById('usr-pin').value = '';
        document.getElementById('usr-pin').placeholder = 'PIN (4 dígitos)';
        document.getElementById('usuarios-form-titulo').textContent = 'NUEVO USUARIO';
        document.getElementById('btn-nuevo-usuario').style.display = 'none';
        document.getElementById('usuarios-form').style.display = 'block';
        document.getElementById('usr-nombre').focus();
    };

    window.editarUsuario = function (id, nombre, rol, sitio, activo) {
        document.getElementById('usr-id').value = id;
        document.getElementById('usr-nombre').value = nombre;
        document.getElementById('usr-rol').value = rol;
        document.getElementById('usr-sitio').value = sitio;
        document.getElementById('usr-pin').value = '';
        document.getElementById('usr-pin').placeholder = 'Nuevo PIN (dejar vacío para no cambiar)';
        document.getElementById('usuarios-form-titulo').textContent = 'EDITAR USUARIO';
        document.getElementById('btn-nuevo-usuario').style.display = 'none';
        document.getElementById('usuarios-form').style.display = 'block';
        document.getElementById('usr-nombre').focus();
    };

    window.cancelarFormUsuario = function () {
        document.getElementById('usr-id').value = '';
        document.getElementById('usr-nombre').value = '';
        document.getElementById('usr-pin').value = '';
        document.getElementById('usuarios-form-titulo').textContent = 'NUEVO USUARIO';
        document.getElementById('btn-nuevo-usuario').style.display = 'block';
        document.getElementById('usuarios-form').style.display = 'none';
    };

    window.guardarUsuario = async function () {
        const id     = document.getElementById('usr-id').value;
        const nombre = document.getElementById('usr-nombre').value.trim();
        const rol    = document.getElementById('usr-rol').value;
        const sitio  = document.getElementById('usr-sitio').value;
        const pin    = document.getElementById('usr-pin').value.trim();

        if (!nombre) { toast('Ingresa un nombre', 'err'); return; }
        if (!id && (!pin || !/^\d{4}$/.test(pin))) { toast('PIN debe ser 4 dígitos numéricos', 'err'); return; }
        if (pin && !/^\d{4}$/.test(pin)) { toast('PIN debe ser 4 dígitos numéricos', 'err'); return; }

        try {
            let pin_hash = null;
            if (pin) {
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
                pin_hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
            }

            if (id) {
                // Editar
                const upd = { nombre, rol, sitio };
                if (pin_hash) upd.pin_hash = pin_hash;
                const { error } = await SB.from('pos_usuarios').update(upd).eq('id', id);
                if (error) throw error;
                toast('Usuario actualizado ✅', 'ok');
            } else {
                // Crear
                const { error } = await SB.from('pos_usuarios').insert({ nombre, rol, sitio, pin_hash, activo: true });
                if (error) throw error;
                toast('Usuario creado ✅', 'ok');
            }

            cancelarFormUsuario();
            await renderListaUsuarios();
        } catch(e) {
            toast('Error guardando usuario', 'err');
            console.error(e);
        }
    };

    window.toggleActivoUsuario = async function (id, activo) {
        try {
            const { error } = await SB.from('pos_usuarios').update({ activo: !activo }).eq('id', id);
            if (error) throw error;
            toast(activo ? 'Usuario desactivado' : 'Usuario activado ✅', activo ? 'err' : 'ok');
            await renderListaUsuarios();
        } catch(e) {
            toast('Error actualizando usuario', 'err');
        }
    };

    window.eliminarUsuario = async function (id, nombre) {
        if (!confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.`)) return;
        try {
            const { error } = await SB.from('pos_usuarios').delete().eq('id', id);
            if (error) throw error;
            toast('Usuario eliminado', 'ok');
            await renderListaUsuarios();
        } catch(e) {
            toast('Error eliminando usuario', 'err');
        }
    };

    // Cerrar modal usuarios con click fuera
    document.getElementById('modal-usuarios')?.addEventListener('click', function(e) {
        if (e.target === this) cerrarUsuarios();
    });

})();
