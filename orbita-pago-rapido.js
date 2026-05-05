// ORBITA PAGO RÁPIDO - Sistema de pago optimizado para Orbita
// Versión corregida: IDs unificados en HTML y JS

window.OrbitaPagoRapido = {
    estado: {
        modo: 'nuevo',
        cliente: null,
        step: 1,
        total: 0,
        items: [],
        local: '',
        wspNumber: '',
        mpEdgeUrl: ''
    },

    async init(localConfig) {
        this.estado.local = localConfig.local;
        this.estado.wspNumber = localConfig.wspNumber;
        this.estado.mpEdgeUrl = localConfig.mpEdgeUrl;
        await this.cargarClienteGuardado();
        this.setupUI();
    },

    _mpEdgeUrl() {
        return this.estado.mpEdgeUrl
            || (window.orbitaPagoFlow && window.orbitaPagoFlow.MP_EDGE_URL)
            || null;
    },

    _supabaseHeaders() {
        const key = window.orbitaPagoFlow && window.orbitaPagoFlow.SUPABASE_KEY;
        if (!key) return null;
        return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
    },

    _syncRegisterServer(cliente) {
        const url = this._mpEdgeUrl();
        const headers = this._supabaseHeaders();
        if (!url || !headers) return;
        fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                action: "register_customer",
                email: cliente.email,
                nombre: cliente.nombre,
                pin_hash: cliente.pin_hash,
                telefono: cliente.telefono || null,
                direccion_entrega: cliente.direccion_entrega || null,
                metodo_pago: cliente.metodo_pago || "mercadopago",
            }),
        }).catch(() => {});
    },

    async _syncUpdateServer(email, pin_hash, updates) {
        const url = this._mpEdgeUrl();
        const headers = this._supabaseHeaders();
        if (!url || !headers) return { ok: false, reason: "no_config" };
        try {
            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ action: "update_customer", email, pin_hash, updates }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                console.warn("update_customer falló:", data);
                return { ok: false, reason: data.reason || "http_" + res.status };
            }
            return { ok: true, cliente: data.cliente };
        } catch (e) {
            console.warn("update_customer error:", e);
            return { ok: false, reason: "network" };
        }
    },

    async _loginFromServer(email, pin_hash) {
        const url = this._mpEdgeUrl();
        const headers = this._supabaseHeaders();
        if (!url || !headers) return null;
        try {
            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ action: "login_customer", email, pin_hash }),
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data && data.ok ? data.cliente : null;
        } catch (e) {
            return null;
        }
    },

    _syncDeleteServer(email, pin_hash) {
        const url = this._mpEdgeUrl();
        const headers = this._supabaseHeaders();
        if (!url || !headers) return;
        fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ action: "delete_customer", email, pin_hash }),
        }).catch(() => {});
    },

    _getUsuarios() {
        try {
            const raw = localStorage.getItem('orbita_usuarios');
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    },

    _saveUsuarios(map) {
        try { localStorage.setItem('orbita_usuarios', JSON.stringify(map)); } catch (e) {}
    },

    _getUsuarioPorEmail(email) {
        if (!email) return null;
        const map = this._getUsuarios();
        return map[email.toLowerCase().trim()] || null;
    },

    _setSesionActiva(email) {
        try {
            if (email) localStorage.setItem('orbita_cliente_activo', email.toLowerCase().trim());
            else localStorage.removeItem('orbita_cliente_activo');
        } catch (e) {}
    },

    async cargarClienteGuardado() {
        try {
            // Migración 1: si existe orbita_cliente_global viejo, moverlo al map nuevo
            const legacy = localStorage.getItem('orbita_cliente_global');
            if (legacy) {
                const c = JSON.parse(legacy);
                if (c && c.email) {
                    // Migración PIN plano → hash
                    if (c.pin && !c.pin_hash) {
                        c.pin_hash = await this.hashPin(c.pin, c.email);
                        delete c.pin;
                    }
                    // Migración PCI: borrar tarjeta con datos sensibles
                    if (c.tarjeta_datos) {
                        c.ultimos4 = c.tarjeta_datos.ultimos4 || c.ultimos4 || null;
                        c.marca_tarjeta = c.tarjeta_datos.marca || c.marca_tarjeta || null;
                        delete c.tarjeta_datos;
                    }
                    const map = this._getUsuarios();
                    map[c.email.toLowerCase().trim()] = c;
                    this._saveUsuarios(map);
                    this._setSesionActiva(c.email);
                }
                localStorage.removeItem('orbita_cliente_global');
            }

            // Leer sesión activa del map
            const emailActivo = localStorage.getItem('orbita_cliente_activo');
            if (!emailActivo) return;
            const c = this._getUsuarioPorEmail(emailActivo);
            if (!c) { this._setSesionActiva(null); return; }
            this.estado.cliente = c;
            this.estado.modo = 'registrado';
            // Refrescar en background por si hubo cambios en otro dispositivo
            this.refreshClienteFromServer().catch(() => {});
        } catch (e) {}
    },

    async hashPin(pin, email) {
        const salt = (email || '').toLowerCase().trim() + '|orbita_pin_v1';
        const data = new TextEncoder().encode(String(pin) + ':' + salt);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async guardarCliente(cliente, opts) {
        try {
            const emailKey = (cliente.email || '').toLowerCase().trim();
            if (!emailKey) return { ok: false };
            cliente.email = emailKey;
            const map = this._getUsuarios();
            map[emailKey] = cliente;
            this._saveUsuarios(map);
            this._setSesionActiva(emailKey);
            this.estado.cliente = cliente;
            this.estado.modo = 'registrado';
            const mode = opts && opts.mode;
            if (mode === 'register') {
                this._syncRegisterServer(cliente);
                return { ok: true };
            } else if (mode === 'update') {
                const { pin_hash, email, created_at, creado, id, ...updates } = cliente;
                const result = await this._syncUpdateServer(email, pin_hash, updates);
                // Si el server devolvió el cliente actualizado, sobrescribir local
                // con la versión canónica (por si el server normalizó algo)
                if (result && result.ok && result.cliente) {
                    const merged = { ...result.cliente, pin_hash: cliente.pin_hash };
                    map[emailKey] = merged;
                    this._saveUsuarios(map);
                    this.estado.cliente = merged;
                }
                return result;
            }
            return { ok: true };
        } catch (e) {
            console.error('Error guardando cliente:', e);
            return { ok: false, reason: 'exception' };
        }
    },

    // Refresca el cliente desde el server (por si se registró/actualizó
    // en otro dispositivo). No rompe si falla - mantiene el local.
    async refreshClienteFromServer() {
        const c = this.estado.cliente;
        if (!c || !c.email || !c.pin_hash) return;
        const remoto = await this._loginFromServer(c.email, c.pin_hash);
        if (!remoto) return;
        const merged = { ...remoto, pin_hash: c.pin_hash };
        // Si el local tiene más direcciones que el server (guardado aún en tránsito),
        // preservamos las locales para evitar sobreescribir cambios recientes.
        const localDirs = this._getDirecciones(c);
        const remoteDirs = Array.isArray(remoto.direcciones) ? remoto.direcciones.filter(Boolean) : [];
        if (localDirs.length > remoteDirs.length) merged.direcciones = localDirs;
        const map = this._getUsuarios();
        map[c.email] = merged;
        this._saveUsuarios(map);
        this.estado.cliente = merged;
    },

    setupUI() {
        this.crearEstructuraHTML();
        this.actualizarUI();
    },

    crearEstructuraHTML() {
        if (document.getElementById('orbita-pago-rapido-container')) return;

        const container = document.createElement('div');
        container.id = 'orbita-pago-rapido-container';
        container.innerHTML = `
            <!-- Modal principal (registro / perfil / beneficios) -->
            <div class="modal-overlay" id="modal-pago-rapido">
                <div class="modal">

                    <!-- Vista: Beneficios (para no registrados) -->
                    <div id="vista-beneficios" style="display:none;">
                        <div class="modal-title">⚡ PAGO RÁPIDO ÓRBITA</div>
                        <p class="modal-sub">Regístrate y paga en 1 solo click en los 3 locales.</p>
                        <div style="background:linear-gradient(135deg,rgba(255,77,0,0.1),rgba(0,158,227,0.06));padding:20px;border-radius:12px;margin:16px 0;text-align:center;">
                            <div style="font-size:2rem;margin-bottom:8px;">⚡</div>
                            <div style="font-weight:700;font-size:1.1rem;color:var(--fire);margin-bottom:4px;">Paga en 1 Segundo</div>
                            <div style="font-size:0.85rem;color:var(--muted);">Guarda tus datos y usa tu PIN para compras futuras</div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-size:1.2rem;">⚡</span>
                                <div><div style="font-weight:600;font-size:0.9rem;">Pago en 1 Click</div><div style="font-size:0.78rem;color:var(--muted);">Solo ingresa tu PIN</div></div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-size:1.2rem;">🔒</span>
                                <div><div style="font-weight:600;font-size:0.9rem;">Datos Seguros</div><div style="font-size:0.78rem;color:var(--muted);">Guardados localmente en tu dispositivo</div></div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-size:1.2rem;">🍣</span>
                                <div><div style="font-weight:600;font-size:0.9rem;">Válido en los 3 Locales</div><div style="font-size:0.78rem;color:var(--muted);">Hand Roll, Café y Fuente de Soda</div></div>
                            </div>
                        </div>
                        <button class="btn-modal btn-fire" id="btn-crear-cuenta">CREAR CUENTA</button>
                        <button class="btn-modal" id="btn-iniciar-sesion" style="background:transparent;border:2px solid var(--fire,var(--primary,#ff4d00));color:var(--fire,var(--primary,#ff4d00));font-weight:700;">INICIAR SESIÓN</button>
                        <button class="btn-modal btn-gray" onclick="OrbitaPagoRapido.cerrarModal()">Cancelar</button>
                    </div>

                    <!-- Vista: Iniciar sesión -->
                    <div id="vista-login" style="display:none;">
                        <div class="modal-title">INICIAR SESIÓN</div>
                        <p class="modal-sub">Ingresa con tu email y PIN de 4 dígitos.</p>

                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="login-email" placeholder="tu@email.com" autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label>PIN de 4 dígitos</label>
                            <input type="password" id="login-pin" placeholder="****" maxlength="4" inputmode="numeric"
                                style="letter-spacing:10px;font-size:1.8rem;text-align:center;">
                        </div>

                        <p class="modal-error" id="login-error"></p>

                        <button class="btn-modal btn-fire" id="btn-confirmar-login">INGRESAR</button>
                        <button class="btn-modal btn-gray" onclick="OrbitaPagoRapido.mostrarBeneficios()">Volver</button>
                    </div>

                    <!-- Vista: Registro -->
                    <div id="vista-registro" style="display:none;">
                        <div class="modal-title">REGISTRARME</div>
                        <p class="modal-sub">Guarda tus datos una vez y la próxima pagas con PIN.</p>

                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="reg-email" placeholder="tu@email.com" autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label>Nombre completo</label>
                            <input type="text" id="reg-nombre" placeholder="Tu nombre" autocomplete="name">
                        </div>
                        <div class="form-group">
                            <label>Teléfono <span style="color:var(--muted);font-size:0.7em;">(opcional)</span></label>
                            <input type="tel" id="reg-telefono" placeholder="+56 9 1234 5678" autocomplete="tel">
                        </div>
                        <div class="form-group">
                            <label>Dirección de entrega <span style="color:var(--muted);font-size:0.7em;">(opcional)</span></label>
                            <input type="text" id="reg-direccion" placeholder="Calle 123, depto 4B" autocomplete="street-address">
                        </div>
                        <div class="form-group">
                            <label>PIN de 4 dígitos <span style="color:var(--muted);font-size:0.7em;">(para pago rápido)</span></label>
                            <input type="password" id="reg-pin" placeholder="****" maxlength="4" inputmode="numeric"
                                style="letter-spacing:10px;font-size:1.8rem;text-align:center;">
                        </div>

                        <div class="form-group" id="reg-tarjeta-section" style="display:none;">
                            <p style="font-size:0.8rem;color:var(--muted);margin:0;">La tarjeta se ingresa al pagar en línea. Por seguridad, no guardamos los datos en este dispositivo.</p>
                        </div>

                        <div class="form-group">
                            <label style="display:flex;align-items:flex-start;gap:8px;font-size:0.8rem;line-height:1.4;text-transform:none;letter-spacing:0;">
                                <input type="checkbox" id="reg-terminos" style="margin-top:2px;accent-color:var(--fire);">
                                <span>Acepto los <a href="privacidad.html" target="_blank" style="color:var(--fire);">Términos y Condiciones</a>
                                y la <a href="privacidad.html" target="_blank" style="color:var(--fire);">Política de Privacidad</a>.</span>
                            </label>
                        </div>

                        <p class="modal-error" id="reg-error"></p>

                        <button class="btn-modal btn-fire" id="btn-guardar-registro">GUARDAR Y CONTINUAR</button>
                        <button class="btn-modal btn-gray" onclick="OrbitaPagoRapido.mostrarBeneficios()">Volver</button>
                    </div>

                    <!-- Vista: Perfil -->
                    <div id="vista-perfil" style="display:none;">
                        <div class="modal-title">MI PERFIL ÓRBITA</div>

                        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:14px;">
                            <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Email (no editable)</div>
                            <div id="perfil-email" style="font-size:0.9rem;color:var(--text);"></div>
                        </div>

                        <div class="form-group">
                            <label>Nombre completo</label>
                            <input type="text" id="perfil-edit-nombre" placeholder="Tu nombre" autocomplete="name">
                        </div>
                        <div class="form-group">
                            <label>Teléfono</label>
                            <input type="tel" id="perfil-edit-telefono" placeholder="+56 9 1234 5678" autocomplete="tel">
                        </div>
                        <div class="form-group">
                            <label>Mis direcciones de entrega</label>
                            <div id="perfil-direcciones-list"></div>
                            <div style="display:flex;gap:6px;margin-top:6px;">
                                <input type="text" id="perfil-nueva-direccion" placeholder="Ej: Calle 123, depto 4B" autocomplete="street-address" style="margin-bottom:0;">
                                <button type="button" class="btn-modal btn-gray" style="flex:0 0 auto;width:auto;padding:10px 14px;margin:0;font-size:0.78rem;white-space:nowrap;" onclick="OrbitaPagoRapido.agregarDireccion()">+ Agregar</button>
                            </div>
                        </div>

                        <!-- Tarjeta visual -->
                        <div class="form-group">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                <label style="margin:0;">Tus tarjetas</label>
                                <button class="btn-perfil-link" onclick="OrbitaPagoRapido.mostrarEditarTarjeta()">Editar</button>
                            </div>
                            <div id="perfil-tarjeta-container"></div>
                        </div>

                        <div class="form-group" style="margin-top:22px;padding-top:16px;border-top:1px solid var(--border);">
                            <label style="font-size:0.78rem;color:var(--muted);">Método de pago</label>
                            <p style="font-size:0.85rem;color:var(--text);margin:6px 0 0;">💳 Pago en línea (MercadoPago, tarjetas Visa/Master sin cuenta MP)</p>
                        </div>

                        <button class="btn-modal btn-fire" style="margin-top:14px;" onclick="OrbitaPagoRapido.guardarPerfil()">GUARDAR</button>
                        <button class="btn-modal btn-gray" onclick="OrbitaPagoRapido.cerrarModal()">Cerrar</button>
                        <button class="btn-modal" style="background:#1a0505;border:1px solid #3a0808;color:#ff4444;" onclick="OrbitaPagoRapido.cerrarSesion()">Cerrar sesión</button>
                        <button class="btn-modal" style="background:transparent;border:1px solid #3a0808;color:#ff4444;font-size:0.72rem;padding:8px;letter-spacing:0.5px;" onclick="OrbitaPagoRapido.eliminarCuentaCompleta()">Eliminar cuenta</button>

                        <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--border);text-align:center;">
                            <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Exportar mis datos (Ley 19.496)</div>
                            <div style="display:flex;gap:6px;">
                                <button class="btn-modal btn-gray" style="flex:1;font-size:0.72rem;padding:7px;margin:0;" onclick="OrbitaPagoRapido.descargarDatosJSON()">Descargar JSON</button>
                                <button class="btn-modal btn-gray" style="flex:1;font-size:0.72rem;padding:7px;margin:0;" onclick="OrbitaPagoRapido.descargarDatosPDF()">Imprimir PDF</button>
                            </div>
                        </div>
                    </div>

                    <!-- Vista: Editar Tarjeta Virtual -->
                    <div id="vista-editar-tarjeta" style="display:none;">
                        <div class="modal-title">TARJETA VIRTUAL</div>
                        <p class="modal-sub">Solo se guardan datos no sensibles para identificar tu tarjeta.</p>

                        <div class="form-group">
                            <label>Titular</label>
                            <input type="text" id="tarjeta-titular" placeholder="NOMBRE COMO FIGURA EN LA TARJETA" style="text-transform:uppercase;" autocomplete="cc-name">
                        </div>
                        <div class="form-group">
                            <label>Marca</label>
                            <select id="tarjeta-marca" style="width:100%;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'DM Sans',sans-serif;">
                                <option value="">Elige una</option>
                                <option value="Visa">Visa</option>
                                <option value="Mastercard">Mastercard</option>
                                <option value="American Express">American Express</option>
                                <option value="Otra">Otra</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Tipo</label>
                            <select id="tarjeta-tipo" style="width:100%;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:'DM Sans',sans-serif;">
                                <option value="">Elige una</option>
                                <option value="credito">Crédito</option>
                                <option value="debito">Débito</option>
                                <option value="prepago">Prepago</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Últimos 4 dígitos</label>
                            <input type="text" id="tarjeta-ultimos4" placeholder="1234" maxlength="4" inputmode="numeric"
                                style="letter-spacing:6px;font-size:1.4rem;text-align:center;" autocomplete="off">
                        </div>
                        <div class="form-group">
                            <label>Emisor <span style="color:var(--muted);font-size:0.7em;">(opcional)</span></label>
                            <input type="text" id="tarjeta-emisor" placeholder="Ej: Mercado Pago Emisora SA" autocomplete="off">
                        </div>

                        <p class="modal-error" id="tarjeta-error"></p>

                        <button class="btn-modal btn-fire" onclick="OrbitaPagoRapido.guardarTarjeta()">GUARDAR TARJETA</button>
                        <button class="btn-modal" style="background:#1a0505;border:1px solid #3a0808;color:#ff4444;" onclick="OrbitaPagoRapido.eliminarTarjeta()">ELIMINAR TARJETA</button>
                        <button class="btn-modal btn-gray" onclick="OrbitaPagoRapido.abrirPerfil()">Volver</button>
                    </div>

                </div>
            </div>

            <!-- Modal validación PIN -->
            <div class="modal-overlay" id="modal-pin-validacion">
                <div class="modal">
                    <div class="modal-title">⚡ PAGO RÁPIDO</div>
                    <p class="modal-sub">Ingresa tu PIN para confirmar el pago de $<span id="pin-total">0</span></p>
                    <div class="form-group">
                        <label>PIN de 4 dígitos</label>
                        <input type="password" id="pin-input-validacion" placeholder="****" maxlength="4" inputmode="numeric"
                            style="letter-spacing:10px;font-size:1.8rem;text-align:center;">
                    </div>
                    <p class="modal-error" id="pin-error-validacion"></p>
                    <button class="btn-modal btn-rayo" id="btn-confirmar-pin">⚡ CONFIRMAR PAGO</button>
                    <button class="btn-modal btn-gray" onclick="OrbitaPagoRapido.cerrarModalPin()">Cancelar</button>
                </div>
            </div>

            <!-- Toast -->
            <div id="orbita-pago-toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--fire);color:var(--text);padding:12px 22px;border-radius:50px;font-size:0.88rem;font-weight:600;z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:nowrap;max-width:90vw;text-align:center;"></div>
        `;

        document.body.appendChild(container);
        this.agregarEstilos();
        this.setupEventListeners();
    },

    agregarEstilos() {
        if (document.getElementById('orbita-pago-rapido-styles')) return;
        const styles = document.createElement('style');
        styles.id = 'orbita-pago-rapido-styles';
        styles.textContent = `
            .metodo-grid { display:flex; gap:8px; margin-bottom:4px; }
            .metodo-opt {
                flex:1; background:var(--surface); border:1.5px solid var(--border);
                border-radius:12px; padding:12px 8px; cursor:pointer;
                display:flex; align-items:center; gap:8px; font-size:0.88rem;
                font-weight:600; transition:all 0.2s;
            }
            .metodo-opt input { accent-color:var(--fire); }
            .metodo-opt:has(input:checked) { border-color:var(--fire); background:rgba(255,77,0,0.07); }
            .modal-error {
                color:#ff4444; font-size:0.82rem; margin-bottom:10px;
                display:none; padding:8px 12px; background:rgba(255,68,68,0.08);
                border-radius:8px; border:1px solid rgba(255,68,68,0.2);
            }
            #orbita-bienvenida {
                display:none; align-items:center; justify-content:space-between;
                background:rgba(37,211,102,0.06); border:1px solid rgba(37,211,102,0.25);
                border-radius:12px; padding:12px 16px; margin-bottom:14px;
                font-size:0.9rem;
            }
            #orbita-bienvenida strong { color:var(--green); }
            .btn-perfil-link {
                background:none; border:none; cursor:pointer; color:var(--fire);
                font-size:0.78rem; font-weight:700; letter-spacing:1px; text-transform:uppercase;
            }
            .one-click-box {
                display:none; background:linear-gradient(135deg,rgba(255,77,0,0.08),rgba(0,158,227,0.06));
                border:1px solid rgba(255,77,0,0.3); border-radius:16px; padding:20px;
                margin-bottom:16px; text-align:center;
            }
        `;
        document.head.appendChild(styles);
    },

    setupEventListeners() {
        // Botón guardar registro
        const btnGuardar = document.getElementById('btn-guardar-registro');
        if (btnGuardar) btnGuardar.addEventListener('click', () => this.handleGuardar());

        // Botón crear cuenta
        const btnCrear = document.getElementById('btn-crear-cuenta');
        if (btnCrear) btnCrear.addEventListener('click', () => this.mostrarRegistro());

        // Botón iniciar sesión
        const btnLogin = document.getElementById('btn-iniciar-sesion');
        if (btnLogin) btnLogin.addEventListener('click', () => this.mostrarLogin());

        // Botón confirmar login
        const btnConfirmarLogin = document.getElementById('btn-confirmar-login');
        if (btnConfirmarLogin) btnConfirmarLogin.addEventListener('click', () => this.handleLogin());

        // Enter en login PIN
        const loginPin = document.getElementById('login-pin');
        if (loginPin) loginPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.handleLogin(); });

        // Botón confirmar PIN
        const btnPin = document.getElementById('btn-confirmar-pin');
        if (btnPin) btnPin.addEventListener('click', () => this.confirmarPagoConPin());

        // Cerrar al hacer click fuera
        const modalPago = document.getElementById('modal-pago-rapido');
        if (modalPago) modalPago.addEventListener('click', (e) => { if (e.target === modalPago) this.cerrarModal(); });

        const modalPin = document.getElementById('modal-pin-validacion');
        if (modalPin) modalPin.addEventListener('click', (e) => { if (e.target === modalPin) this.cerrarModalPin(); });

        // Enter en PIN para confirmar
        const pinInput = document.getElementById('pin-input-validacion');
        if (pinInput) pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmarPagoConPin(); });

        // Mostrar aviso "la tarjeta se ingresa al pagar" solo si eligió Pago en línea
        // Mostrar aviso de tarjeta por default (todo es pago en línea ahora)
        const sec = document.getElementById('reg-tarjeta-section');
        if (sec) sec.style.display = '';
    },

    actualizarUI() {
        this.mostrarPerfilFlotante();
        this.mostrarBotonPagoRapido();
        this.prellenarDatosPedido();
    },

    prellenarDatosPedido() {
        const c = this.estado.cliente;
        const inputNombre = document.getElementById('input-nombre');
        if (inputNombre) {
            if (c && c.nombre) {
                // Si está vacío o contiene el nombre de un cliente previo, rellenar con el actual
                const val = inputNombre.value.trim();
                if (!val || val === (this._prevNombre || '')) {
                    inputNombre.value = c.nombre;
                }
                this._prevNombre = c.nombre;
            } else {
                // Sin cliente → limpiar si quedó el nombre del cliente anterior
                if (inputNombre.value.trim() === (this._prevNombre || '')) {
                    inputNombre.value = '';
                }
                this._prevNombre = '';
            }
        }
    },

    mostrarPerfilFlotante() {
        const existing = document.getElementById('perfil-flotante-container');
        if (existing) existing.remove();

        const estaRegistrado = !!this.estado.cliente;

        const chipStyle = "background:rgba(30,30,30,0.95);color:var(--muted);padding:7px 13px;border-radius:20px;font-size:0.78rem;font-weight:600;cursor:pointer;border:1px solid var(--border);white-space:nowrap;";
        const chipPrimary = "background:var(--fire,#ff4d00);color:#fff;padding:7px 13px;border-radius:20px;font-size:0.78rem;font-weight:700;cursor:pointer;border:1px solid var(--fire,#ff4d00);white-space:nowrap;";

        const html = `
            <div id="perfil-flotante-container" style="position:fixed;top:16px;right:16px;display:flex;align-items:center;gap:8px;z-index:1001;">
                ${!estaRegistrado ? `<span id="perfil-login" style="${chipPrimary}">Iniciar sesión</span>` : ''}
                ${!estaRegistrado ? `<span id="perfil-texto" style="${chipStyle}">Registrarme</span>` : ''}
                <div id="perfil-flotante" style="background:${estaRegistrado ? 'var(--fire, var(--primary, #ff4d00))' : '#2a2a2a'};color:#fff;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:${estaRegistrado ? '1.3rem' : '1.1rem'};font-weight:bold;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.85);font-family:'Bebas Neue',sans-serif;">
                    ${estaRegistrado ? this.estado.cliente.nombre.charAt(0).toUpperCase() : '?'}
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        setTimeout(() => {
            const perfil = document.getElementById('perfil-flotante');
            const texto = document.getElementById('perfil-texto');
            const login = document.getElementById('perfil-login');
            if (perfil) {
                perfil.addEventListener('click', () => estaRegistrado ? this.abrirPerfil() : this.mostrarBeneficios());
            }
            if (texto) {
                texto.addEventListener('click', () => this.mostrarRegistro());
            }
            if (login) {
                login.addEventListener('click', () => this.mostrarLogin());
            }
        }, 50);
    },

    mostrarBotonPagoRapido() {
        const existing = document.getElementById('btn-pago-rapido-principal');
        if (existing) existing.remove();

        const orderBox = document.querySelector('.order-box');
        if (!orderBox) return;

        const estaRegistrado = !!this.estado.cliente;
        const totalStr = this.estado.total > 0 ? ` · $${this.estado.total.toLocaleString('es-CL')}` : '';

        const html = `<button id="btn-pago-rapido-principal" class="btn-rayo" style="width:100%;margin-top:10px;padding:16px;border:none;border-radius:50px;font-family:'Bebas Neue',sans-serif;font-size:1.3rem;letter-spacing:2px;cursor:pointer;background:linear-gradient(135deg,#FFD700,#FFA500,#FF6347);color:#000;font-weight:800;border:2px solid #FFD700;animation:rayo-pulse 2s infinite;">
            ${estaRegistrado ? `⚡ PAGO RÁPIDO${totalStr} ⚡` : `⚡ REGISTRARME${totalStr}`}
        </button>`;

        const btnWsp = orderBox.querySelector('.btn-wsp');
        if (btnWsp) btnWsp.insertAdjacentHTML('beforebegin', html);
        else orderBox.insertAdjacentHTML('beforeend', html);

        setTimeout(() => {
            const btn = document.getElementById('btn-pago-rapido-principal');
            if (btn) btn.addEventListener('click', () => estaRegistrado ? this.pagarRapido() : this.mostrarBeneficios());
        }, 50);
    },

    // ── ABRIR VISTAS ──

    mostrarBeneficios() {
        this._mostrarVista('vista-beneficios');
        document.getElementById('modal-pago-rapido').classList.add('open');
    },

    mostrarRegistro() {
        // Limpiar form
        ['reg-email','reg-nombre','reg-telefono','reg-direccion','reg-pin'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const terminos = document.getElementById('reg-terminos');
        if (terminos) terminos.checked = false;
        const err = document.getElementById('reg-error');
        if (err) err.style.display = 'none';
        this._mostrarVista('vista-registro');
        document.getElementById('modal-pago-rapido').classList.add('open');
    },

    abrirPerfil() {
        if (!this.estado.cliente) { this.mostrarBeneficios(); return; }
        this._pintarPerfil();
        this._mostrarVista('vista-perfil');
        document.getElementById('modal-pago-rapido').classList.add('open');
        // Refrescar desde server para traer tarjeta/cambios hechos en otro
        // dispositivo (crítico en mobile cuando te logueas por primera vez).
        this.refreshClienteFromServer().then(() => this._pintarPerfil()).catch(() => {});
    },

    _pintarPerfil() {
        const c = this.estado.cliente;
        if (!c) return;
        document.getElementById('perfil-email').textContent = c.email || '';
        const elNombre = document.getElementById('perfil-edit-nombre');
        if (elNombre) elNombre.value = c.nombre || '';
        const elTel = document.getElementById('perfil-edit-telefono');
        if (elTel) elTel.value = c.telefono || '';
        this._renderDirecciones();
        this.renderTarjetaVisual();
    },

    // Helper público para que los HTMLs lean las direcciones del cliente logueado.
    getDireccionesCliente() {
        if (!this.estado.cliente) return [];
        return this._getDirecciones();
    },

    // Devuelve siempre un array de direcciones (backward-compat con direccion_entrega string).
    _getDirecciones(cliente) {
        const c = cliente || this.estado.cliente || {};
        if (Array.isArray(c.direcciones)) return c.direcciones.filter(Boolean);
        if (c.direccion_entrega) return [c.direccion_entrega];
        return [];
    },

    _setDirecciones(arr) {
        if (!this.estado.cliente) return;
        const list = (arr || []).filter(Boolean);
        this.estado.cliente.direcciones = list;
        this.estado.cliente.direccion_entrega = list[0] || null; // primera = principal, back-compat
    },

    _renderDirecciones() {
        const cont = document.getElementById('perfil-direcciones-list');
        if (!cont) return;
        const list = this._getDirecciones();
        if (!list.length) {
            cont.innerHTML = '<p style="font-size:0.78rem;color:var(--muted);margin:4px 0;">Sin direcciones guardadas. Agrega una abajo.</p>';
            return;
        }
        cont.innerHTML = list.map((d, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;font-size:0.86rem;">
                <span>📍 ${this._esc(d)}${i === 0 ? ' <span style="font-size:0.68rem;color:var(--fire,var(--primary));font-weight:700;">· principal</span>' : ''}</span>
                <button type="button" onclick="OrbitaPagoRapido.eliminarDireccionIndex(${i})" style="background:transparent;border:none;color:#c1121f;font-size:1.1rem;cursor:pointer;padding:2px 6px;line-height:1;" title="Eliminar">×</button>
            </div>
        `).join('');
    },

    async agregarDireccion() {
        if (!this.estado.cliente) return;
        const input = document.getElementById('perfil-nueva-direccion');
        const valor = (input && input.value || '').trim();
        if (!valor) { this.mostrarToast('Ingresa una dirección primero', 'error'); return; }
        const actual = this._getDirecciones();
        if (actual.some(d => d.toLowerCase() === valor.toLowerCase())) {
            this.mostrarToast('Esa dirección ya está guardada', 'error');
            return;
        }
        actual.push(valor);
        this._setDirecciones(actual);
        if (input) input.value = '';
        this._renderDirecciones();
        this.mostrarToast('Guardando...', 'success');
        const result = await this.guardarCliente(this.estado.cliente, { mode: 'update' });
        if (result && result.ok) {
            this.mostrarToast('Dirección guardada ✓', 'success');
        } else {
            this.mostrarToast('Dirección guardada localmente (sin conexión con servidor)', 'error');
        }
    },

    eliminarDireccionIndex(i) {
        if (!this.estado.cliente) return;
        const actual = this._getDirecciones();
        if (i < 0 || i >= actual.length) return;
        if (!confirm('¿Eliminar "' + actual[i] + '" de tus direcciones?')) return;
        actual.splice(i, 1);
        this._setDirecciones(actual);
        this.guardarCliente(this.estado.cliente, { mode: 'update' });
        this._renderDirecciones();
        this.mostrarToast('Dirección eliminada ✓');
    },

    renderTarjetaVisual() {
        const c = this.estado.cliente || {};
        const cont = document.getElementById('perfil-tarjeta-container');
        if (!cont) return;
        if (!c.ultimos4) {
            cont.innerHTML = `
                <div style="background:linear-gradient(135deg,#2a2a2a,#1a1a1a);border:1px dashed rgba(255,255,255,0.15);border-radius:16px;padding:36px 20px;text-align:center;color:#888;font-size:0.88rem;">
                    <div style="font-size:1.8rem;margin-bottom:8px;opacity:0.4;">💳</div>
                    No hay tarjeta guardada.<br>
                    <span style="font-size:0.78rem;">Toca "Editar" para agregar una.</span>
                </div>`;
            return;
        }

        // Esquemas por marca: fondo + color de texto
        const marca = c.marca_tarjeta || 'Otra';
        const schemes = {
            'Visa': {
                bg: 'linear-gradient(135deg,#1a1f71 0%,#0f1347 50%,#1a1f71 100%)',
                shine: 'linear-gradient(115deg,transparent 40%,rgba(255,255,255,0.08) 50%,transparent 60%)',
                fg: '#ffffff', sub: 'rgba(255,255,255,0.75)'
            },
            'Mastercard': {
                bg: 'linear-gradient(135deg,#1a1a1a 0%,#0a0a0a 50%,#2b1f1f 100%)',
                shine: 'linear-gradient(115deg,transparent 40%,rgba(255,153,0,0.08) 50%,transparent 60%)',
                fg: '#ffffff', sub: 'rgba(255,255,255,0.7)'
            },
            'American Express': {
                bg: 'linear-gradient(135deg,#006fcf 0%,#00457c 50%,#012665 100%)',
                shine: 'linear-gradient(115deg,transparent 40%,rgba(255,255,255,0.1) 50%,transparent 60%)',
                fg: '#ffffff', sub: 'rgba(255,255,255,0.78)'
            },
            'Otra': {
                bg: 'linear-gradient(135deg,#ff4d00 0%,#c13600 50%,#7a1f00 100%)',
                shine: 'linear-gradient(115deg,transparent 40%,rgba(255,255,255,0.1) 50%,transparent 60%)',
                fg: '#ffffff', sub: 'rgba(255,255,255,0.78)'
            }
        };
        const s = schemes[marca] || schemes['Otra'];

        // Logo SVG por marca
        const logoSvg = marca === 'Visa' ? `
            <svg viewBox="0 0 80 26" width="56" height="18" xmlns="http://www.w3.org/2000/svg" style="display:block;">
                <text x="0" y="22" font-family="Arial Black,Arial,sans-serif" font-size="24" font-weight="900" font-style="italic" fill="#fff" letter-spacing="-1">VISA</text>
            </svg>`
            : marca === 'Mastercard' ? `
            <svg viewBox="0 0 48 30" width="48" height="30" xmlns="http://www.w3.org/2000/svg" style="display:block;">
                <circle cx="18" cy="15" r="12" fill="#eb001b"/>
                <circle cx="30" cy="15" r="12" fill="#f79e1b" fill-opacity="0.92"/>
            </svg>`
            : marca === 'American Express' ? `
            <svg viewBox="0 0 60 22" width="56" height="20" xmlns="http://www.w3.org/2000/svg" style="display:block;">
                <rect width="60" height="22" rx="3" fill="#ffffff"/>
                <text x="5" y="16" font-family="Arial Black,Arial,sans-serif" font-size="12" font-weight="900" fill="#016fd0" letter-spacing="0.5">AMEX</text>
            </svg>`
            : `<span style="font-family:'DM Sans',sans-serif;font-size:0.78rem;color:#fff;background:rgba(255,255,255,0.18);padding:4px 10px;border-radius:4px;font-weight:800;letter-spacing:1px;">${this._esc(marca.toUpperCase())}</span>`;

        // Chip EMV (SVG inline)
        const chipSvg = `
            <svg viewBox="0 0 40 30" width="38" height="28" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="chipG" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#d4af37"/>
                        <stop offset="50%" stop-color="#f5d77e"/>
                        <stop offset="100%" stop-color="#b8860b"/>
                    </linearGradient>
                </defs>
                <rect x="0" y="0" width="40" height="30" rx="5" fill="url(#chipG)"/>
                <path d="M8 8 H32 M8 15 H16 M24 15 H32 M8 22 H32 M15 8 V22 M25 8 V22" stroke="#8a6a0b" stroke-width="1.2" fill="none" opacity="0.7"/>
            </svg>`;

        // Contactless symbol
        const contactlessSvg = `
            <svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(90deg);">
                <path d="M7 6 Q12 12 7 18" stroke="${s.fg}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.55"/>
                <path d="M11 4 Q17 12 11 20" stroke="${s.fg}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.75"/>
                <path d="M15 2 Q22 12 15 22" stroke="${s.fg}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.95"/>
            </svg>`;

        const tipoLabel = c.tipo_tarjeta === 'credito' ? 'CRÉDITO'
            : c.tipo_tarjeta === 'debito' ? 'DÉBITO'
            : c.tipo_tarjeta === 'prepago' ? 'PREPAGO' : '';
        const emisor = (c.emisor_tarjeta || 'TARJETA').toUpperCase();
        const titular = (c.titular_tarjeta || c.nombre || '').toUpperCase();
        const ultimos = this._esc(c.ultimos4);

        cont.innerHTML = `
            <div style="width:100%;max-width:360px;margin:0 auto;aspect-ratio:1.586 / 1;background:${s.bg};border-radius:16px;color:${s.fg};font-family:'DM Sans',sans-serif;box-shadow:0 14px 30px rgba(0,0,0,0.5),0 2px 6px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.08);position:relative;overflow:hidden;">
                <div style="position:absolute;inset:0;background:${s.shine};pointer-events:none;"></div>

                <!-- Arriba izquierda: emisor + tipo -->
                <div style="position:absolute;top:7%;left:6%;">
                    <div style="font-size:0.64rem;font-weight:800;letter-spacing:1.3px;color:${s.sub};text-transform:uppercase;">${this._esc(emisor)}</div>
                    ${tipoLabel ? `<div style="font-size:0.56rem;font-weight:700;letter-spacing:1.5px;color:${s.sub};margin-top:3px;">${tipoLabel}</div>` : ''}
                </div>

                <!-- Arriba derecha: contactless -->
                <div style="position:absolute;top:7%;right:6%;line-height:0;">${contactlessSvg}</div>

                <!-- Chip EMV: ~38% desde arriba, izquierda -->
                <div style="position:absolute;top:38%;left:6%;transform:translateY(-50%);line-height:0;">${chipSvg}</div>

                <!-- Número: justo debajo del chip, ancho completo con márgenes -->
                <div style="position:absolute;left:6%;right:6%;top:62%;font-family:'Courier New','Consolas',monospace;font-size:1.15rem;font-weight:700;letter-spacing:2px;color:${s.fg};text-shadow:0 1px 2px rgba(0,0,0,0.35);white-space:nowrap;">
                    ••••&nbsp;&nbsp;••••&nbsp;&nbsp;••••&nbsp;&nbsp;${ultimos}
                </div>

                <!-- Abajo izquierda: titular -->
                <div style="position:absolute;left:6%;bottom:7%;max-width:60%;">
                    <div style="font-size:0.52rem;font-weight:700;letter-spacing:1.2px;color:${s.sub};text-transform:uppercase;margin-bottom:2px;">TITULAR</div>
                    <div style="font-size:0.82rem;font-weight:700;letter-spacing:0.8px;color:${s.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this._esc(titular)}</div>
                </div>

                <!-- Abajo derecha: logo marca -->
                <div style="position:absolute;right:6%;bottom:8%;line-height:0;">${logoSvg}</div>
            </div>`;
    },

    _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    mostrarEditarTarjeta() {
        const c = this.estado.cliente || {};
        document.getElementById('tarjeta-titular').value = c.titular_tarjeta || c.nombre || '';
        document.getElementById('tarjeta-marca').value = c.marca_tarjeta || '';
        document.getElementById('tarjeta-tipo').value = c.tipo_tarjeta || '';
        document.getElementById('tarjeta-ultimos4').value = c.ultimos4 || '';
        document.getElementById('tarjeta-emisor').value = c.emisor_tarjeta || '';
        const err = document.getElementById('tarjeta-error');
        if (err) err.style.display = 'none';
        this._mostrarVista('vista-editar-tarjeta');
        document.getElementById('modal-pago-rapido').classList.add('open');
    },

    async guardarTarjeta() {
        const c = this.estado.cliente;
        if (!c) { this.mostrarBeneficios(); return; }
        const titular = document.getElementById('tarjeta-titular').value.trim().toUpperCase();
        const marca = document.getElementById('tarjeta-marca').value;
        const tipo = document.getElementById('tarjeta-tipo').value;
        const ultimos4 = document.getElementById('tarjeta-ultimos4').value.trim();
        const emisor = document.getElementById('tarjeta-emisor').value.trim();
        const errEl = document.getElementById('tarjeta-error');
        errEl.style.display = 'none';

        if (!titular) { errEl.textContent = 'Ingresa el titular.'; errEl.style.display = 'block'; return; }
        if (!marca) { errEl.textContent = 'Elige la marca.'; errEl.style.display = 'block'; return; }
        if (!tipo) { errEl.textContent = 'Elige el tipo de tarjeta.'; errEl.style.display = 'block'; return; }
        if (!/^\d{4}$/.test(ultimos4)) { errEl.textContent = 'Los últimos 4 dígitos deben ser 4 números.'; errEl.style.display = 'block'; return; }

        c.titular_tarjeta = titular;
        c.marca_tarjeta = marca;
        c.tipo_tarjeta = tipo;
        c.ultimos4 = ultimos4;
        c.emisor_tarjeta = emisor || null;

        this.mostrarToast('Guardando...');
        const result = await this.guardarCliente(c, { mode: 'update' });
        if (result && result.ok) {
            this.mostrarToast('Tarjeta guardada y sincronizada ✓', 'success');
        } else {
            this.mostrarToast('Tarjeta guardada local. Sin conexión con el servidor.', 'error');
        }
        this.abrirPerfil();
    },

    eliminarTarjeta() {
        const c = this.estado.cliente;
        if (!c) return;
        if (!confirm('¿Eliminar la tarjeta guardada?')) return;
        c.titular_tarjeta = null;
        c.marca_tarjeta = null;
        c.tipo_tarjeta = null;
        c.ultimos4 = null;
        c.emisor_tarjeta = null;
        this.guardarCliente(c, { mode: 'update' });
        this.mostrarToast('Tarjeta eliminada ✓');
        this.abrirPerfil();
    },

    _mostrarVista(idVisible) {
        ['vista-beneficios','vista-registro','vista-login','vista-perfil','vista-editar-tarjeta'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = id === idVisible ? 'block' : 'none';
        });
    },

    mostrarLogin() {
        ['login-email','login-pin'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const err = document.getElementById('login-error');
        if (err) err.style.display = 'none';
        this._mostrarVista('vista-login');
        document.getElementById('modal-pago-rapido').classList.add('open');
    },

    async handleLogin() {
        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const pin = document.getElementById('login-pin').value.trim();
        const errEl = document.getElementById('login-error');
        errEl.style.display = 'none';

        if (!email || !email.includes('@')) {
            errEl.textContent = 'Ingresa un email válido.';
            errEl.style.display = 'block';
            return;
        }
        if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
            errEl.textContent = 'El PIN debe tener 4 dígitos numéricos.';
            errEl.style.display = 'block';
            return;
        }

        const hash = await this.hashPin(pin, email);
        let usuario = this._getUsuarioPorEmail(email);

        if (usuario) {
            if (hash !== usuario.pin_hash) {
                errEl.textContent = 'PIN incorrecto.';
                errEl.style.display = 'block';
                return;
            }
        } else {
            // No está local → buscar en el servidor (puede haberse registrado en otro dispositivo)
            const remoto = await this._loginFromServer(email, hash);
            if (!remoto) {
                errEl.textContent = 'No encontramos una cuenta con ese email y PIN. Revisa los datos o crea una cuenta.';
                errEl.style.display = 'block';
                return;
            }
            // Cachear local con el pin_hash que ya tenemos (el server no lo devuelve)
            usuario = { ...remoto, pin_hash: hash };
            const map = this._getUsuarios();
            map[email] = usuario;
            this._saveUsuarios(map);
        }

        this.estado.cliente = usuario;
        this.estado.modo = 'registrado';
        this._setSesionActiva(email);

        this.cerrarModal();
        this.mostrarToast(`¡Hola de nuevo, ${this.estado.cliente.nombre.split(' ')[0]}!`);
        setTimeout(() => this.actualizarUI(), 200);
    },

    cerrarModal() {
        document.getElementById('modal-pago-rapido').classList.remove('open');
    },

    // ── GUARDAR REGISTRO ──
    handleGuardar() {
        const email = document.getElementById('reg-email').value.trim().toLowerCase();
        const nombre = document.getElementById('reg-nombre').value.trim();
        const telefono = document.getElementById('reg-telefono')?.value.trim() || '';
        const direccion = document.getElementById('reg-direccion')?.value.trim() || '';
        const pin = document.getElementById('reg-pin').value.trim();
        const metodo = 'mercadopago';
        const errEl = document.getElementById('reg-error');
        errEl.style.display = 'none';

        if (!email || !email.includes('@')) { errEl.textContent = 'Ingresa un email válido.'; errEl.style.display = 'block'; return; }
        if (!nombre) { errEl.textContent = 'Ingresa tu nombre.'; errEl.style.display = 'block'; return; }
        if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) { errEl.textContent = 'El PIN debe tener 4 dígitos numéricos.'; errEl.style.display = 'block'; return; }

        const terminos = document.getElementById('reg-terminos');
        if (!terminos?.checked) { errEl.textContent = 'Debes aceptar los Términos y Condiciones.'; errEl.style.display = 'block'; return; }

        const btn = document.getElementById('btn-guardar-registro');
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        (async () => {
            const pin_hash = await this.hashPin(pin, email);
            const cliente = {
                nombre,
                email,
                telefono: telefono || null,
                direccion_entrega: direccion || null,
                metodo_pago: metodo,
                pin_hash,
                creado: new Date().toISOString()
            };

            this.guardarCliente(cliente, { mode: 'register' });
            this.cerrarModal();
            this.mostrarToast(`¡Listo, ${nombre.split(' ')[0]}! Datos guardados ✓`);
            setTimeout(() => this.actualizarUI(), 300);
            btn.disabled = false;
            btn.textContent = 'GUARDAR Y CONTINUAR';
        })();
    },

    async guardarPerfil() {
        if (!this.estado.cliente) return;
        const c = this.estado.cliente;
        const nombre = (document.getElementById('perfil-edit-nombre')?.value || '').trim();
        const telefono = (document.getElementById('perfil-edit-telefono')?.value || '').trim();
        if (!nombre) { this.mostrarToast('El nombre no puede estar vacío', 'error'); return; }
        c.nombre = nombre;
        c.telefono = telefono || null;
        c.metodo_pago = 'mercadopago'; // WhatsApp ya no es método de pago
        // Direcciones: las edita el usuario con agregarDireccion() / eliminarDireccionIndex()
        // aquí solo persistimos el estado actual
        const result = await this.guardarCliente(c, { mode: 'update' });
        this.cerrarModal();
        this.actualizarUI();
        if (result && result.ok) this.mostrarToast('Perfil actualizado ✓', 'success');
        else this.mostrarToast('Guardado local. Sin conexión con el servidor.', 'error');
    },

    cerrarSesion() {
        // Mantener la cuenta guardada en 'orbita_usuarios', solo desactivar la sesión
        this._setSesionActiva(null);
        this.estado.cliente = null;
        this.estado.modo = 'nuevo';
        this.cerrarModal();
        this.actualizarUI();
        this.mostrarToast('Sesión cerrada. Puedes volver a entrar con tu email y PIN.');
    },

    // ── PAGO RÁPIDO ──
    pagarRapido() {
        if (!this.estado.cliente) { this.mostrarBeneficios(); return; }
        if (this.estado.total === 0) { this.mostrarToast('Agrega productos al pedido primero'); return; }

        const nombreInput = document.getElementById('input-nombre');
        if (nombreInput && !nombreInput.value.trim()) {
            this.mostrarToast('Completa tu nombre');
            nombreInput.focus();
            return;
        }

        // Detectar tipo de entrega por estado de los botones (DOM = verdad).
        // Si es retiro → pedir hora. Si es delivery → pedir ubicación.
        const tipo = this._detectarTipoEntrega();
        if (tipo === 'retiro') {
            const horaInput = document.getElementById('input-hora');
            if (horaInput && !horaInput.value) {
                this.mostrarToast('Elige hora de retiro');
                horaInput.focus();
                return;
            }
        } else if (tipo === 'delivery') {
            if (!window.ubicacionCliente) {
                this.mostrarToast('Comparte tu ubicación para el delivery');
                return;
            }
        } else if (tipo === null) {
            // Botones existen pero ninguno activo → exigir selección
            if (document.getElementById('btn-retiro') || document.getElementById('btn-delivery')) {
                this.mostrarToast('Elige Retiro en local o Delivery');
                return;
            }
            // Sin selector → validar hora si está visible (flujo legacy)
            const horaInput = document.getElementById('input-hora');
            const campoHora = document.getElementById('campo-hora');
            const horaVisible = horaInput && (!campoHora || campoHora.style.display !== 'none');
            if (horaVisible && !horaInput.value) {
                this.mostrarToast('Elige hora de retiro');
                horaInput.focus();
                return;
            }
        }

        this.abrirModalPin();
    },

    _detectarTipoEntrega() {
        const btnR = document.getElementById('btn-retiro');
        const btnD = document.getElementById('btn-delivery');
        if (btnR && btnR.classList.contains('active')) return 'retiro';
        if (btnD && btnD.classList.contains('active')) return 'delivery';
        if (btnR || btnD) return null; // existen pero ninguno activo
        return undefined; // no hay selector
    },

    abrirModalPin() {
        document.getElementById('pin-total').textContent = this.estado.total.toLocaleString('es-CL');
        document.getElementById('pin-input-validacion').value = '';
        document.getElementById('pin-error-validacion').style.display = 'none';
        document.getElementById('modal-pin-validacion').classList.add('open');
        setTimeout(() => document.getElementById('pin-input-validacion').focus(), 100);
    },

    cerrarModalPin() {
        document.getElementById('modal-pin-validacion').classList.remove('open');
    },

    async confirmarPagoConPin() {
        const pinIngresado = document.getElementById('pin-input-validacion').value.trim();
        const errEl = document.getElementById('pin-error-validacion');
        errEl.style.display = 'none';

        if (!pinIngresado || pinIngresado.length !== 4) {
            errEl.textContent = 'El PIN debe tener 4 dígitos.';
            errEl.style.display = 'block';
            return;
        }
        const hashIngresado = await this.hashPin(pinIngresado, this.estado.cliente.email);
        if (hashIngresado !== this.estado.cliente.pin_hash) {
            errEl.textContent = 'PIN incorrecto. Intentá nuevamente.';
            errEl.style.display = 'block';
            return;
        }

        this.cerrarModalPin();
        this.mostrarToast('PIN correcto ✓ Procesando pago...');

        setTimeout(() => {
            // Pago rápido siempre va por pago en línea (WhatsApp es canal, no método)
            if (window.pagarConMP) window.pagarConMP();
            else this.mostrarToast('Redirigiendo al pago en línea...');
        }, 500);
    },

    // ── DATOS ──
    descargarDatosJSON() {
        if (!this.estado.cliente) { this.mostrarToast('No hay datos para exportar'); return; }
        const c = this.estado.cliente;
        const datos = {
            nombre: c.nombre,
            email: c.email,
            telefono: c.telefono || null,
            direccion_entrega: c.direccion_entrega || null,
            metodo_pago: c.metodo_pago,
            creado: c.creado,
            tarjeta: c.ultimos4 ? {
                titular: c.titular_tarjeta || null,
                marca: c.marca_tarjeta || null,
                tipo: c.tipo_tarjeta || null,
                ultimos4: c.ultimos4,
                emisor: c.emisor_tarjeta || null
            } : null,
            exportado: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mis-datos-orbita-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        this.mostrarToast('Datos descargados ✓');
    },

    descargarDatosPDF() {
        if (!this.estado.cliente) { this.mostrarToast('No hay datos para exportar'); return; }
        const c = this.estado.cliente;
        const e = (s) => this._esc(s);
        const tarjetaHtml = c.ultimos4 ? `
            <p><label>Tarjeta:</label> ${e(c.marca_tarjeta || '')} ${e(c.tipo_tarjeta || '')} **** ${e(c.ultimos4)}</p>
            <p><label>Titular:</label> ${e(c.titular_tarjeta || '')}</p>` : '';
        const w = window.open('', '_blank');
        w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mis Datos Órbita</title>
            <style>body{font-family:Arial,sans-serif;padding:30px;line-height:1.6}h1{color:#ff4d00}hr{border:1px solid #ddd}label{font-weight:bold}</style>
            </head><body><h1>ÓRBITA — Mis Datos</h1><hr>
            <p><label>Nombre:</label> ${e(c.nombre)}</p>
            <p><label>Email:</label> ${e(c.email)}</p>
            <p><label>Teléfono:</label> ${e(c.telefono || '—')}</p>
            <p><label>Dirección:</label> ${e(c.direccion_entrega || '—')}</p>
            <p><label>Método pago:</label> ${e(c.metodo_pago)}</p>
            ${tarjetaHtml}
            <p><label>Registro:</label> ${new Date(c.creado).toLocaleString('es-CL')}</p>
            <p><label>Exportado:</label> ${new Date().toLocaleString('es-CL')}</p>
            <hr><p style="font-size:0.85em;color:#666;">Protegido por Ley 19.496 Chile</p></body></html>`);
        w.document.close();
        setTimeout(() => { w.print(); }, 400);
        this.mostrarToast('PDF generado ✓');
    },

    eliminarCuentaCompleta() {
        if (!confirm('¿Estás seguro? Se borrarán tus medios de pago, tarjeta guardada, dirección, teléfono y todo tu historial en este dispositivo y en el servidor. Esta acción NO se puede deshacer.')) return;
        const email = (this.estado.cliente && this.estado.cliente.email || '').toLowerCase().trim();
        const pinHash = this.estado.cliente && this.estado.cliente.pin_hash;
        if (email) {
            const map = this._getUsuarios();
            delete map[email];
            this._saveUsuarios(map);
            if (pinHash) this._syncDeleteServer(email, pinHash);
        }
        this._setSesionActiva(null);
        this.estado.cliente = null;
        this.estado.modo = 'nuevo';
        this.cerrarModal();
        this.actualizarUI();
        this.mostrarToast('Cuenta eliminada permanentemente.');
    },

    // ── UTILIDADES ──
    mostrarToast(msg, tipo) {
        // Quitar toast previo si existe
        const prev = document.getElementById('orbita-pago-toast-dinamico');
        if (prev) prev.remove();

        const colors = {
            success: { bg: '#00ff88', fg: '#001a0a', glow: 'rgba(0,255,136,0.55)' },
            error:   { bg: '#ff2d55', fg: '#ffffff', glow: 'rgba(255,45,85,0.55)' },
            info:    { bg: '#39ff14', fg: '#0a1a00', glow: 'rgba(57,255,20,0.55)' }
        };
        const t = colors[tipo] || colors.info;

        const el = document.createElement('div');
        el.id = 'orbita-pago-toast-dinamico';
        el.textContent = msg;
        el.style.cssText =
            'position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;' +
            'background:' + t.bg + ';color:' + t.fg + ';' +
            'padding:14px 24px;border-radius:14px;' +
            "font-family:'DM Sans',sans-serif;font-size:1rem;font-weight:800;letter-spacing:0.3px;" +
            'border:2px solid ' + t.bg + ';' +
            'box-shadow:0 0 0 3px rgba(0,0,0,0.25),0 0 24px 4px ' + t.glow + ',0 10px 28px rgba(0,0,0,0.5);' +
            'max-width:90vw;text-align:center;' +
            'opacity:0;transition:opacity 0.25s ease,transform 0.25s ease;' +
            'transform:translate(-50%,-10px);pointer-events:none;';
        document.body.appendChild(el);

        // Trigger animación de entrada
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%,0)';
        });

        // Desvanecer y borrar
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translate(-50%,-10px)';
        }, 2700);
        setTimeout(() => { el.remove(); }, 3100);
    },

    detectarMarca(num) {
        if (num.startsWith('4')) return 'Visa';
        if (num.startsWith('5')) return 'Mastercard';
        if (num.startsWith('3')) return 'American Express';
        return 'Otra';
    },

    actualizarTotal(total, items) {
        this.estado.total = total;
        this.estado.items = items;
        this.actualizarUI();
    }
};
