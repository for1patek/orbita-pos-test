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
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 14px;font-family:DM Sans,sans-serif;font-size:0.95rem;text-align:center;background:rgba(17,17,17,0.96);color:#fff;border-bottom:2px solid #C4922A;';
        banner.innerHTML = 'Modo admin activo — <button onclick="abrirAdminLogin()" style="margin-left:8px;padding:4px 12px;background:#C4922A;border:none;border-radius:6px;color:#fff;font-size:0.85rem;cursor:pointer;font-family:DM Sans,sans-serif;font-weight:700;">Ingresar credenciales</button>';
        document.body.insertBefore(banner, document.body.firstChild);
        document.body.style.paddingTop = '54px';
        // Ajustar altura del POS para que no quede cortado por el banner
        const posEl = document.getElementById('pantalla-pos');
        if (posEl) posEl.style.height = 'calc(100dvh - 54px)';
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
            if (banner) banner.innerHTML = '🔑 Modo admin activo — <button onclick="abrirUsuarios()" style="margin-left:8px;padding:4px 12px;background:#C4922A;border:none;border-radius:6px;color:#fff;font-size:0.82rem;cursor:pointer;font-family:DM Sans,sans-serif;font-weight:700;">Gestionar usuarios</button>';
            // Mostrar botones ⚙️ y 🔑 si ya hay sesión POS activa
            const btnCfg2 = document.getElementById('btn-config');
            if (btnCfg2) btnCfg2.style.display = 'inline-block';
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
            { id: 'pasteleria', label: '🍰 Pastelería' },
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
            btn.onclick = async () => {
                document.querySelectorAll('.usuario-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                usuarioSeleccionado = u;
                pinBuffer = '';
                actualizarPinDisplay();
                document.getElementById('login-error').textContent = '';
                // En modo admin, entra directo sin PIN
                if (posAdminDesbloqueado) {
                    estado.usuario = u;
                    estado.turnoInicio = new Date();
                    sessionStorage.setItem('orbita_sesion', JSON.stringify({
                        usuario: u,
                        local: estado.local,
                        turnoInicio: estado.turnoInicio.toISOString(),
                    }));
                    await abrirPOS();
                }
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
                card.onclick = () => clickProducto(p);
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
            estado.comanda.push({ id: prod.id, producto_id: prod.id, nombre: prod.nombre, precio: prod.precio, costo: prod.costo || 0, qty: 1 });
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
                    ${item.detalle ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">${item.detalle}</div>` : ''}
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

        const items = estado.comanda.map(i => ({ id: i.id, nombre: i.nombre, detalle: i.detalle || null, precio: i.precio, qty: i.qty }));

        // ─── Verificación de stock ────────────────────────────────────────────
        // Convierte la comanda al formato que espera orbitaStock
        if (window.orbitaStock) {
            const stockItems = window.orbitaStock.comandaAItems(estado.comanda);
            const { ok, alertas, advertencia } = await window.orbitaStock.verificarStock(estado.local, stockItems);

            // Si Supabase no respondió — avisar al cajero pero dejar continuar
            if (advertencia) {
                toast('⚠️ ' + advertencia, 'warn');
            }

            // Si hay alertas de stock — mostrar al cajero y pedirle confirmación
            if (alertas?.length) {
                const msg = window.orbitaStock.mensajeAlertas(alertas);

                // Registrar evento de demanda no satisfecha para cada alerta
                for (const a of alertas) {
                    window.orbitaStock.registrarEvento(
                        'insuficiente', estado.local,
                        a.producto_id, a.nombre,
                        a.pedido, a.disponible
                    );
                }

                // Si el stock no alcanza — el cajero decide si igual cobra
                if (!ok) {
                    const continuar = confirm(
                        '⚠️ Stock insuficiente:\n\n' + msg +
                        '\n\n¿Deseas continuar con la venta de todas formas?'
                    );
                    if (!continuar) return; // Cajero canceló — no se cobra
                }
                // Si ok=true pero hay alertas — solo informamos (stock bajo pero dentro del 80%)
                else {
                    toast('⚠️ Stock bajo en algunos productos', 'warn');
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        const { data: pedidoData, error } = await SB.from('pedidos').insert({
            sitio:               estado.local,
            nombre:              nombre,
            total:               total,
            items_json:          items,
            estado:              'pagado',
            tipo_entrega:        tipo,
            origen:              'fisico',
            metodo_pago_entrega: estado.metodoPago || 'efectivo',
        }).select('id').single();

        cerrarModalCobro();

        if (error) {
            console.error(error);
            toast('Error al guardar la venta', 'err');
            return;
        }

        // ─── Descontar stock post-pago ────────────────────────────────────────
        // El pedido ya está registrado — ahora descontamos el stock atómicamente
        if (window.orbitaStock && pedidoData?.id) {
            const stockItems = window.orbitaStock.comandaAItems(estado.comanda);
            window.orbitaStock.descontarStock(estado.local, stockItems, pedidoData.id);
            // No esperamos el resultado para no bloquear la UI — el descuento es async
        }
        // ─────────────────────────────────────────────────────────────────────

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
                en_camino: 'Despachado 🛵',
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
            btn.textContent = '🍳 Enviar a cocina';
            btn.onclick = () => cambiarEstadoPedido(p.id, 'en_cocina', true);
            container.appendChild(btn);
        }

        // Estado: en_cocina → marcar Listo (dispara WhatsApp al repartidor si es delivery)
        if (p.estado === 'en_cocina') {
            const btn = document.createElement('button');
            btn.className = 'btn-accion btn-confirmar';
            btn.style.background = '#b8860b';
            btn.textContent = '✅ Marcar como listo';
            btn.onclick = () => marcarListo(p);
            container.appendChild(btn);
        }

        // Estado: listo → En camino (dispara WhatsApp al cliente)
        if (p.estado === 'listo') {
            if (esDelivery) {
                const btn = document.createElement('button');
                btn.className = 'btn-accion btn-despachar';
                btn.textContent = '🛵 Despachar';
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

        // Editar disponible en pendiente, pagado, whatsapp, en_cocina
        if (['pendiente','pagado','whatsapp','en_cocina'].includes(p.estado)) {
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-accion';
            btnEdit.style.cssText = 'background:var(--surface);border:1px solid var(--border);color:var(--text);';
            btnEdit.textContent = '✏️ Editar';
            btnEdit.onclick = () => abrirEditarPedido(p);
            container.appendChild(btnEdit);
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
        en_camino:  'Despachado',
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

        // Stock bajo al cierre — consulta stock_local del local con join a stock_items
        try {
            const { data: stockData } = await SB
                .from('stock_local')
                .select('cantidad, alerta_min, stock_items(nombre, unidad)')
                .eq('sitio', estado.local);

            const bajos = (stockData || []).filter(r => r.cantidad <= (r.alerta_min ?? 5));

            const contenedor = document.getElementById('cierre-stock-alertas');
            const lista      = document.getElementById('cierre-stock-lista');

            if (bajos.length > 0) {
                lista.innerHTML = bajos.map(r => {
                    const min    = r.alerta_min ?? 5;
                    const agotado = r.cantidad === 0;
                    const color  = agotado ? 'var(--red)' : '#f59e0b';
                    const icono  = agotado ? '\uD83D\uDD34' : '\uD83D\UDFE1';
                    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px;border-bottom:1px solid var(--border);font-size:0.82rem;">'
                         + '<span>' + icono + ' ' + (r.stock_items?.nombre || '\u2014') + '</span>'
                         + '<span style="color:' + color + ';font-weight:700;">' + r.cantidad + ' / m\xedn ' + min + ' ' + (r.stock_items?.unidad || '') + '</span>'
                         + '</div>';
                }).join('');
                contenedor.style.display = 'block';
            } else {
                contenedor.style.display = 'none';
            }
        } catch (e) {
            document.getElementById('cierre-stock-alertas').style.display = 'none';
        }

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

    // ── EDITAR PEDIDO ────────────────────────────────────────────────────────

    let editarPedidoState = null; // { pedido, items }

    window.abrirEditarPedido = function(p) {
        // Clonar items para editar sin afectar el original
        const items = (Array.isArray(p.items_json) ? p.items_json : []).map(i => ({
            id:      i.id || i.nombre,
            nombre:  i.nombre,
            detalle: i.detalle || '',
            precio:  Number(i.precio) || 0,
            qty:     Number(i.qty || i.cantidad) || 1,
        }));
        editarPedidoState = { pedido: p, items };

        document.getElementById('editar-pedido-subtitulo').textContent =
            `${p.nombre || 'Sin nombre'} · #${p.id} · ${p.tipo_entrega}`;

        renderEditarItems();
        document.getElementById('modal-editar-pedido').classList.remove('hidden');
    };

    window.cerrarEditarPedido = function() {
        document.getElementById('modal-editar-pedido').classList.add('hidden');
        editarPedidoState = null;
    };

    function renderEditarItems() {
        const lista = document.getElementById('editar-items-lista');
        const { items } = editarPedidoState;

        if (!items.length) {
            lista.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:12px 0;">Sin items</div>';
            actualizarTotalEditar();
            return;
        }

        lista.innerHTML = items.map((item, idx) => `
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.88rem;">${item.nombre}</div>
                    ${item.detalle ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">${item.detalle}</div>` : ''}
                    <div style="font-size:0.82rem;color:var(--muted);margin-top:2px;">${fmt(item.precio)} c/u</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <button onclick="editarQty(${idx},-1)"
                        style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
                    <span style="min-width:20px;text-align:center;font-weight:700;">${item.qty}</span>
                    <button onclick="editarQty(${idx},1)"
                        style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
                </div>
                <div style="font-weight:700;min-width:60px;text-align:right;">${fmt(item.precio * item.qty)}</div>
                <button onclick="eliminarItemEditar(${idx})"
                    style="padding:4px 8px;border:1px solid var(--red);border-radius:8px;background:transparent;color:var(--red);font-size:0.75rem;cursor:pointer;">✕</button>
            </div>
        `).join('');

        actualizarTotalEditar();
    }

    window.editarQty = function(idx, delta) {
        editarPedidoState.items[idx].qty = Math.max(1, editarPedidoState.items[idx].qty + delta);
        renderEditarItems();
    };

    window.eliminarItemEditar = function(idx) {
        editarPedidoState.items.splice(idx, 1);
        renderEditarItems();
    };

    function actualizarTotalEditar() {
        const total = editarPedidoState.items.reduce((s, i) => s + i.precio * i.qty, 0);
        document.getElementById('editar-total').textContent = fmt(total);
    }

    window.guardarEdicionPedido = async function() {
        const { pedido, items } = editarPedidoState;
        if (!items.length) { toast('El pedido no puede quedar sin items', 'err'); return; }

        const total = items.reduce((s, i) => s + i.precio * i.qty, 0);
        try {
            const { error } = await SB.from('pedidos')
                .update({ items_json: items, total })
                .eq('id', pedido.id);
            if (error) throw error;
            toast('Pedido actualizado ✅', 'ok');
            cerrarEditarPedido();
            cargarPedidosWeb();
        } catch(e) {
            toast('Error al guardar', 'err');
            console.error(e);
        }
    };

    document.getElementById('modal-editar-pedido')?.addEventListener('click', function(e) {
        if (e.target === this) cerrarEditarPedido();
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

    // ── OPCIONES DE PRODUCTO ─────────────────────────────────────────────────

    // Recetas predeterminadas
    const RECETA_SANDWICH = {
        'Italiano':  ['palta', 'tomate', 'mayo'],
        'Chacarero': ['tomate', 'porotos', 'aji', 'mayo'],
        'Luco':      ['queso', 'mayo'],
    };
    const RECETA_COMPLETO = {
        'Italiano':  ['tomate', 'palta', 'mayo'],
        'Completo':  ['tomate', 'chucrut', 'mayo'],
        'Dinámico':  ['palta', 'tomate', 'americana', 'mayo', 'chucrut'],
    };

    // Todos los ingredientes disponibles
    const INGREDIENTES_FUENTE = [
        { id: 'palta',     nombre: 'Palta' },
        { id: 'tomate',    nombre: 'Tomate' },
        { id: 'mayo',      nombre: 'Mayonesa' },
        { id: 'chucrut',   nombre: 'Chucrut' },
        { id: 'queso',     nombre: 'Queso' },
        { id: 'porotos',   nombre: 'Porotos verdes' },
        { id: 'aji',       nombre: 'Ají verde' },
        { id: 'americana', nombre: 'Americana' },
        { id: 'lechuga',   nombre: 'Lechuga' },
        { id: 'cebolla',   nombre: 'Cebolla' },
        { id: 'pepino',    nombre: 'Pepinillos' },
    ];

    const BEBIDAS_FUENTE = [
        'Coca-Cola','Coca-Cola sin azúcar','Pepsi','Kem',
        'Bilz','Pap','Fanta','Sprite','Agua con gas','Agua sin gas'
    ];

    let opcionesState = null; // producto actual en el modal

    // Determina si un producto necesita modal de opciones
    function necesitaOpciones(prod) {
        const cat = prod.cat || prod.categoria || '';
        if (estado.local === 'cafe' && cat === 'cafe') return true;          // elegir grano
        if (estado.local === 'fuente') {
            if (cat === 'sandwich' || cat === 'completo') return true;       // receta + ingredientes + bebida
            if (cat === 'handroll') return true;                             // salsa
        }
        if (prod.categoria === 'handroll' || cat === 'handroll') return true; // handroll en cualquier sitio
        if (cat === 'jugo' || prod.categoria === 'jugo') return true;             // jugos: azúcar
        return false;
    }

    function clickProducto(prod) {
        if (!necesitaOpciones(prod)) {
            agregarAComanda(prod);
            return;
        }
        abrirOpciones(prod);
    }

    function abrirOpciones(prod) {
        const cat = prod.cat || prod.categoria || '';
        opcionesState = { prod, cat, selecciones: {} };

        document.getElementById('opciones-titulo').textContent = prod.nombre.toUpperCase();
        document.getElementById('opciones-subtitulo').textContent = fmt(prod.precio);
        document.getElementById('opciones-resumen').textContent = '';

        const contenido = document.getElementById('opciones-contenido');
        contenido.innerHTML = '';

        // ── CAFÉ: elegir grano (y leche si aplica) ───────────────────────────
        const CAFES_CON_LECHE = ['c_cortado','c_latte','c_capuchino','c_mocachino','c_chocolate'];
        const llevaleche = CAFES_CON_LECHE.includes(prod.id);
        if (cat === 'cafe') {
            contenido.innerHTML = `
                <div>
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">TIPO DE GRANO</div>
                    <div style="display:flex;gap:10px;">
                        ${['Napoli','Armonía'].map(g => `
                            <button class="opt-btn-opciones" data-grupo="grano" data-val="${g}"
                                onclick="selOpcion('grano','${g}')"
                                style="flex:1;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;">
                                ${g === 'Napoli' ? '☕ Napoli' : '🌿 Armonía'}<br>
                                <span style="font-size:0.72rem;color:var(--muted);font-weight:400;">${g === 'Napoli' ? 'Intenso' : 'Suave'}</span>
                            </button>`).join('')}
                    </div>
                </div>
                ${llevaleche ? `
                <div>
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">TIPO DE LECHE</div>
                    <div style="display:flex;gap:10px;">
                        ${[{id:'entera',label:'🥛 Entera',desc:'Estándar'},{id:'sin_lactosa',label:'🌿 Sin lactosa',desc:'Descremada'}].map(l => `
                            <button class="opt-btn-opciones" data-grupo="leche" data-val="${l.id}"
                                onclick="selOpcion('leche','${l.id}')"
                                style="flex:1;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;">
                                ${l.label}<br>
                                <span style="font-size:0.72rem;color:var(--muted);font-weight:400;">${l.desc}</span>
                            </button>`).join('')}
                    </div>
                </div>` : ''}`;
        }

        // ── HANDROLL: elegir salsa ────────────────────────────────────────────
        if (cat === 'handroll') {
            contenido.innerHTML = `
                <div>
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">SALSA</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;">
                        ${[{id:'soya',label:'🫙 Soya',desc:'Gratis'},{id:'agridulce',label:'🍯 Agridulce',desc:'+$500'},{id:'sin_salsa',label:'Sin salsa',desc:''}].map(s => `
                            <button class="opt-btn-opciones" data-grupo="salsa" data-val="${s.id}"
                                onclick="selOpcion('salsa','${s.id}')"
                                style="flex:1;min-width:90px;padding:14px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;text-align:center;">
                                ${s.label}${s.desc ? `<br><span style="font-size:0.72rem;color:var(--muted);font-weight:400;">${s.desc}</span>` : ''}
                            </button>`).join('')}
                    </div>
                </div>`;
        }

        // ── SANDWICH / COMPLETO / HAMBURGUESA ────────────────────────────────
        if (cat === 'sandwich' || cat === 'completo') {
            const recetas = cat === 'completo' ? RECETA_COMPLETO : RECETA_SANDWICH;
            const opciones = Object.keys(recetas);
            opcionesState.ingr = {}; // ingredientes seleccionados

            contenido.innerHTML = `
                <div>
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">ELIGE UNA OPCIÓN</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${opciones.map(op => `
                            <button class="opt-btn-opciones" data-grupo="receta" data-val="${op}"
                                onclick="selReceta('${op}')"
                                style="flex:1;min-width:90px;padding:12px 8px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;text-align:center;">
                                ${op}
                            </button>`).join('')}
                    </div>
                </div>
                <div id="opciones-ingredientes" style="display:none;">
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">INGREDIENTES <span style="font-weight:400;text-transform:none;font-size:0.72rem;">(quita o agrega)</span></div>
                    <div id="ingredientes-grid" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
                </div>
                ${prod.bebida ? `
                <div id="opciones-bebida">
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">BEBIDA DEL COMBO</div>
                    <select id="sel-bebida" onchange="selOpcion('bebida',this.value)"
                        style="width:100%;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.9rem;outline:none;">
                        <option value="">— Elige una bebida —</option>
                        ${BEBIDAS_FUENTE.map(b => `<option value="${b}">${b}</option>`).join('')}
                    </select>
                </div>` : ''}`;
        }

        // ── JUGO: azúcar ──────────────────────────────────────────────────────
        if (cat === 'jugo') {
            contenido.innerHTML = `
                <div>
                    <div style="font-size:0.75rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">AZÚCAR</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;">
                        ${[{id:'con',label:'🍬 Con azúcar'},{id:'sin',label:'🚫 Sin azúcar'},{id:'endulzante',label:'🌿 Endulzante'}].map(a => `
                            <button class="opt-btn-opciones" data-grupo="azucar" data-val="${a.id}"
                                onclick="selOpcion('azucar','${a.id}')"
                                style="flex:1;min-width:90px;padding:14px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;text-align:center;">
                                ${a.label}
                            </button>`).join('')}
                    </div>
                </div>`;
        }

        document.getElementById('modal-opciones').classList.remove('hidden');
    }

    window.selOpcion = function(grupo, val) {
        opcionesState.selecciones[grupo] = val;
        // Highlight botón seleccionado
        document.querySelectorAll(`[data-grupo="${grupo}"]`).forEach(btn => {
            btn.style.background = btn.dataset.val === val ? 'var(--primary)' : 'var(--surface)';
            btn.style.color = btn.dataset.val === val ? '#fff' : 'var(--text)';
            btn.style.borderColor = btn.dataset.val === val ? 'var(--primary)' : 'var(--border)';
        });
        actualizarResumenOpciones();
    };

    window.selReceta = function(opcion) {
        const cat = opcionesState.cat;
        const recetas = cat === 'completo' ? RECETA_COMPLETO : RECETA_SANDWICH;
        opcionesState.selecciones.receta = opcion;
        // Cargar ingredientes base de la receta
        opcionesState.ingr = {};
        (recetas[opcion] || []).forEach(id => { opcionesState.ingr[id] = 1; });

        // Highlight receta
        document.querySelectorAll('[data-grupo="receta"]').forEach(btn => {
            btn.style.background = btn.dataset.val === opcion ? 'var(--primary)' : 'var(--surface)';
            btn.style.color = btn.dataset.val === opcion ? '#fff' : 'var(--text)';
            btn.style.borderColor = btn.dataset.val === opcion ? 'var(--primary)' : 'var(--border)';
        });

        // Mostrar ingredientes
        document.getElementById('opciones-ingredientes').style.display = 'block';
        renderIngredientesOpciones();
        actualizarResumenOpciones();
    };

    function renderIngredientesOpciones() {
        const grid = document.getElementById('ingredientes-grid');
        if (!grid) return;

        const receta  = opcionesState.selecciones.receta;
        const cat     = opcionesState.cat;
        const recetas = cat === 'completo' ? RECETA_COMPLETO : RECETA_SANDWICH;
        const base    = new Set(recetas[receta] || []);

        // Botón control reutilizable
        const ctrlBtn = (id, delta, txt) =>
            `<button onclick="cambiarCantIngr('${id}',${delta})"
                style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);
                color:var(--text);font-size:1rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">${txt}</button>`;

        // Fila base: nombre ocupa flex-1, controles alineados a la derecha
        const filaBase = (ing) => {
            const cant  = opcionesState.ingr[ing.id] ?? 1;
            const badge = cant === 0
                ? `<span style="font-size:0.68rem;color:var(--red);font-weight:700;min-width:36px;text-align:center;">SIN</span>`
                : cant === 2
                ? `<span style="font-size:0.68rem;color:var(--primary);font-weight:700;min-width:36px;text-align:center;">DOBLE</span>`
                : `<span style="min-width:36px;"></span>`;
            return `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
                    <span style="flex:1;font-size:0.88rem;${cant===0?'color:var(--muted);text-decoration:line-through;':''}">${ing.nombre}</span>
                    ${badge}
                    ${ctrlBtn(ing.id, -1, '−')}
                    ${ctrlBtn(ing.id,  1, '+')}
                </div>`;
        };

        // Extras en grid 2 columnas, cada celda con nombre+controles
        const celdaExtra = (ing) => {
            const cant = opcionesState.ingr[ing.id] || 0;
            const badge = cant === 2
                ? `<span style="font-size:0.65rem;color:var(--primary);font-weight:700;">x2</span>`
                : cant === 1
                ? `<span style="font-size:0.65rem;color:#4caf50;font-weight:700;">+1</span>`
                : `<span style="font-size:0.65rem;color:transparent;">__</span>`;
            return `
                <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
                    <span style="flex:1;font-size:0.8rem;${cant===0?'color:var(--muted);':''}">${ing.nombre} ${badge}</span>
                    ${ctrlBtn(ing.id, -1, '−')}
                    ${ctrlBtn(ing.id,  1, '+')}
                </div>`;
        };

        const baseHTML   = INGREDIENTES_FUENTE.filter(i => base.has(i.id)).map(filaBase).join('');
        const extrasHTML = INGREDIENTES_FUENTE.filter(i => !base.has(i.id)).map(celdaExtra).join('');

        // Mantener estado del extras-bar si ya estaba abierto
        const extrasAbierto = document.getElementById('extras-bar')?.style.display === 'grid';

        grid.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">${baseHTML}</div>
            <div style="margin-top:10px;">
                <button onclick="toggleExtrasBar()" id="btn-extras-bar"
                    style="width:100%;padding:8px;border:1px dashed var(--border);border-radius:10px;background:transparent;
                    color:var(--muted);font-family:'DM Sans',sans-serif;font-size:0.8rem;cursor:pointer;">
                    ${extrasAbierto ? '− Ocultar extras' : '+ Agregar extras'}
                </button>
                <div id="extras-bar" style="display:${extrasAbierto?'grid':'none'};margin-top:8px;
                    grid-template-columns:1fr 1fr;gap:6px;">${extrasHTML}</div>
            </div>`;
    }

    window.toggleExtrasBar = function() {
        const bar = document.getElementById('extras-bar');
        const btn = document.getElementById('btn-extras-bar');
        if (bar.style.display === 'none' || bar.style.display === '') {
            bar.style.display = 'grid';
            btn.textContent = '− Ocultar extras';
        } else {
            bar.style.display = 'none';
            btn.textContent = '+ Agregar extras';
        }
    };

    // ingr ahora es { id: cantidad } — 0=sin, 1=normal, 2=doble
    window.cambiarCantIngr = function(id, delta) {
        const cur = opcionesState.ingr[id] || 0;
        const nxt = Math.max(0, Math.min(2, cur + delta));
        // Solo un doble a la vez
        if (nxt === 2) {
            const hayDoble = Object.entries(opcionesState.ingr).find(([k,v]) => k !== id && v === 2);
            if (hayDoble) { toast('Solo un ingrediente puede ir doble a la vez', 'err'); return; }
        }
        if (nxt === 0) delete opcionesState.ingr[id];
        else opcionesState.ingr[id] = nxt;
        renderIngredientesOpciones();
        actualizarResumenOpciones();
    };

    function actualizarResumenOpciones() {
        const s = opcionesState.selecciones;
        const partes = [];
        if (s.azucar) partes.push(s.azucar === 'con' ? 'Con azúcar' : s.azucar === 'sin' ? 'Sin azúcar' : 'Endulzante');
        if (s.grano) partes.push(s.grano);
        if (s.leche) partes.push(s.leche === 'sin_lactosa' ? 'Sin lactosa' : 'Leche entera');
        if (s.salsa) partes.push(s.salsa === 'sin_salsa' ? 'Sin salsa' : s.salsa === 'agridulce' ? 'Agridulce' : 'Soya');
        if (s.receta) partes.push(s.receta);
        if (opcionesState.ingr && opcionesState.selecciones.receta) {
            const recetas = opcionesState.cat === 'completo' ? RECETA_COMPLETO : RECETA_SANDWICH;
            const base = new Set(recetas[opcionesState.selecciones.receta] || []);
            const mods = [];
            // Ingredientes sin (base que se quitó)
            INGREDIENTES_FUENTE.filter(i => base.has(i.id) && (opcionesState.ingr[i.id] ?? 1) === 0)
                .forEach(i => mods.push('sin ' + i.nombre));
            // Ingredientes doble
            INGREDIENTES_FUENTE.filter(i => (opcionesState.ingr[i.id]) === 2)
                .forEach(i => mods.push('doble ' + i.nombre));
            // Extras agregados
            INGREDIENTES_FUENTE.filter(i => !base.has(i.id) && (opcionesState.ingr[i.id] || 0) > 0)
                .forEach(i => mods.push('+ ' + i.nombre));
            if (mods.length) partes.push(mods.join(', '));
        }
        if (s.bebida) partes.push('🥤 ' + s.bebida);
        document.getElementById('opciones-resumen').textContent = partes.join(' · ');
    }

    window.cerrarOpciones = function() {
        document.getElementById('modal-opciones').classList.add('hidden');
        opcionesState = null;
    };

    window.confirmarOpciones = function() {
        const { prod, cat, selecciones, ingr } = opcionesState;

        // Validaciones
        if (cat === 'cafe' && !selecciones.grano) {
            toast('Elige el tipo de grano', 'err'); return;
        }
        const CAFES_CON_LECHE_V = ['c_cortado','c_latte','c_capuchino','c_mocachino','c_chocolate'];
        if (cat === 'cafe' && CAFES_CON_LECHE_V.includes(prod.id) && !selecciones.leche) {
            toast('Elige el tipo de leche', 'err'); return;
        }
        if (cat === 'handroll' && !selecciones.salsa) {
            toast('Elige la salsa', 'err'); return;
        }
        if (cat === 'jugo' && !selecciones.azucar) {
            toast('Elige la opción de azúcar', 'err'); return;
        }
        if ((cat === 'sandwich' || cat === 'completo') && !selecciones.receta) {
            toast('Elige una opción', 'err'); return;
        }
        if (prod.bebida && !selecciones.bebida) {
            toast('Elige la bebida del combo', 'err'); return;
        }

        // Armar nombre con detalle
        let detalle = '';
        if (selecciones.azucar) detalle = selecciones.azucar === 'con' ? 'Con azúcar' : selecciones.azucar === 'sin' ? 'Sin azúcar' : 'Endulzante';
        if (selecciones.grano) detalle = selecciones.grano;
        if (selecciones.leche) detalle += (detalle ? ' · ' : '') + (selecciones.leche === 'sin_lactosa' ? 'Sin lactosa' : 'Leche entera');
        if (selecciones.salsa) detalle = selecciones.salsa === 'sin_salsa' ? 'Sin salsa' : selecciones.salsa === 'agridulce' ? 'Agridulce +$500' : 'Soya';
        if (selecciones.receta) {
            const recetas = cat === 'completo' ? RECETA_COMPLETO : RECETA_SANDWICH;
            const base = new Set(recetas[selecciones.receta] || []);
            const mods = [];
            INGREDIENTES_FUENTE.filter(i => base.has(i.id) && (ingr[i.id] ?? 1) === 0)
                .forEach(i => mods.push('sin ' + i.nombre));
            INGREDIENTES_FUENTE.filter(i => (ingr[i.id]) === 2)
                .forEach(i => mods.push('doble ' + i.nombre));
            INGREDIENTES_FUENTE.filter(i => !base.has(i.id) && (ingr[i.id] || 0) > 0)
                .forEach(i => mods.push('+ ' + i.nombre));
            detalle = selecciones.receta + (mods.length ? ' ' + mods.join(', ') : '');
        }
        if (selecciones.bebida) detalle += (detalle ? ' · ' : '') + '🥤 ' + selecciones.bebida;

        // Precio: handroll agridulce suma $500
        let precio = prod.precio;
        if (selecciones.salsa === 'agridulce') precio += 500;

        const uid = prod.id + '_' + Date.now();
        estado.comanda.push({
            id: uid,
            producto_id: prod.id,
            nombre: prod.nombre,
            detalle,
            precio,
            costo: prod.costo || 0,
            qty: 1
        });
        renderComanda();
        cerrarOpciones();
        toast(prod.nombre + ' agregado ✓', 'ok');
    };

    document.getElementById('modal-opciones')?.addEventListener('click', function(e) {
        if (e.target === this) cerrarOpciones();
    });


})();
