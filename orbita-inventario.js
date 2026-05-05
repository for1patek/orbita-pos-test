(function () {
    function storageKey(site, type) {
        return `orbita_inventario_${site}_${type}`;
    }

    function readJson(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key) || fallback);
        } catch (e) {
            return JSON.parse(fallback);
        }
    }

    function formatClp(value) {
        return '$' + Math.round(value || 0).toLocaleString('es-CL');
    }

    function loadState(site) {
        return {
            insumos: readJson(storageKey(site, 'insumos'), '[]'),
            historial: readJson(storageKey(site, 'historial'), '[]')
        };
    }

    function saveState(site, state) {
        localStorage.setItem(storageKey(site, 'insumos'), JSON.stringify(state.insumos));
        localStorage.setItem(storageKey(site, 'historial'), JSON.stringify(state.historial));
    }

    function getInput(prefix, id) {
        return document.getElementById(`${prefix}-${id}`);
    }

    function render(site, prefix) {
        const state = loadState(site);
        const list = document.getElementById(`${prefix}-inv-list`);
        const history = document.getElementById(`${prefix}-inv-history`);
        if (!list || !history) return;

        if (!state.insumos.length) {
            list.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;">No hay insumos agregados aún.</p>';
        } else {
            list.innerHTML = state.insumos.map((ins, idx) => `
                <div class="perf-card" style="padding:14px;">
                    <div class="perf-row"><span style="font-weight:700;color:var(--text);">${ins.nombre}</span><strong>${ins.unidad}</strong></div>
                    <div class="perf-row"><span>Stock</span><strong>${ins.stock} ${ins.unidad}</strong></div>
                    <div class="perf-row"><span>Costo unitario</span><strong>${formatClp(ins.costo)}</strong></div>
                    <div class="perf-row" style="gap:8px;flex-wrap:wrap;"><button class="btn-sm btn-green" onclick="window.orbitaInventario.ajustarStock('${site}','${prefix}',${idx},true)">+ Reponer</button><button class="btn-sm btn-fire" onclick="window.orbitaInventario.ajustarStock('${site}','${prefix}',${idx},false)">− Usar</button><button class="btn-sm btn-orange" onclick="window.orbitaInventario.editarInsumo('${site}','${prefix}',${idx})">✏️ Editar</button><button class="btn-sm btn-red" onclick="window.orbitaInventario.eliminarInsumo('${site}','${prefix}',${idx})">🗑️ Eliminar</button></div>
                </div>`).join('');
        }

        if (!state.historial.length) {
            history.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;">Aún no hay movimientos.</p>';
        } else {
            history.innerHTML = state.historial.slice(0, 20).map(entry => `
                <div class="history-item">
                    <strong>${entry.tipo === 'ingreso' ? 'Ingreso' : entry.tipo === 'salida' ? 'Salida' : 'Edición'}: ${entry.nombre}</strong>
                    <p>${entry.cantidad} ${entry.unidad} · ${entry.nota || 'Sin nota'}</p>
                    <p>${new Date(entry.fecha).toLocaleString('es-CL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</p>
                </div>`).join('');
        }
    }

    function agregarInsumo(site, prefix) {
        const nombreEl = getInput(prefix, 'inv-name');
        const stockEl = getInput(prefix, 'inv-stock');
        const unidadEl = getInput(prefix, 'inv-unit');
        const costoEl = getInput(prefix, 'inv-costo');
        const nombre = nombreEl?.value.trim();
        const stock = parseFloat(stockEl?.value) || 0;
        const unidad = unidadEl?.value.trim() || 'u';
        const costo = parseFloat(costoEl?.value) || 0;
        if (!nombre) { alert('Ingresa un nombre para el insumo.'); return; }
        const state = loadState(site);
        state.insumos.push({ nombre, stock, unidad, costo, createdAt: new Date().toISOString() });
        state.historial.unshift({ tipo: 'ingreso', nombre, unidad, cantidad: stock, costo, nota: 'Stock inicial', fecha: new Date().toISOString() });
        saveState(site, state);
        if (nombreEl) nombreEl.value = '';
        if (stockEl) stockEl.value = '';
        if (unidadEl) unidadEl.value = '';
        if (costoEl) costoEl.value = '';
        render(site, prefix);
    }

    function ajustarStock(site, prefix, index, esIngreso) {
        const state = loadState(site);
        const insumo = state.insumos[index];
        if (!insumo) return;
        const cantidad = parseFloat(prompt(`Cantidad a ${esIngreso ? 'sumar' : 'restar'} (${insumo.unidad})`, '0')) || 0;
        if (cantidad <= 0) return;
        const nota = prompt('Nota breve (opcional)', esIngreso ? 'Reposición' : 'Consumo') || (esIngreso ? 'Reposición' : 'Consumo');
        insumo.stock = Math.max(0, Math.round((insumo.stock + (esIngreso ? cantidad : -cantidad)) * 100) / 100);
        state.historial.unshift({ tipo: esIngreso ? 'ingreso' : 'salida', nombre: insumo.nombre, unidad: insumo.unidad, cantidad, costo: insumo.costo, nota, fecha: new Date().toISOString() });
        saveState(site, state);
        render(site, prefix);
    }

    function editarInsumo(site, prefix, index) {
        const state = loadState(site);
        const insumo = state.insumos[index];
        if (!insumo) return;
        const nombre = prompt('Nombre del insumo', insumo.nombre)?.trim();
        const unidad = prompt('Unidad', insumo.unidad)?.trim();
        const stock = parseFloat(prompt('Stock actual', insumo.stock)) || insumo.stock;
        const costo = parseFloat(prompt('Costo unitario', insumo.costo)) || insumo.costo;
        if (!nombre) return;
        insumo.nombre = nombre;
        insumo.unidad = unidad || insumo.unidad;
        insumo.stock = stock;
        insumo.costo = costo;
        state.historial.unshift({ tipo: 'edicion', nombre: insumo.nombre, unidad: insumo.unidad, cantidad: insumo.stock, costo: insumo.costo, nota: 'Edición manual', fecha: new Date().toISOString() });
        saveState(site, state);
        render(site, prefix);
    }

    function eliminarInsumo(site, prefix, index) {
        const state = loadState(site);
        const insumo = state.insumos[index];
        if (!insumo || !confirm(`¿Eliminar ${insumo.nombre}?`)) return;
        state.insumos.splice(index, 1);
        saveState(site, state);
        render(site, prefix);
    }

    window.orbitaInventario = {
        init: function(site, prefix) {
            this.site = site;
            this.prefix = prefix;
            render(site, prefix);
        },
        render: render,
        agregarInsumo: agregarInsumo,
        ajustarStock: ajustarStock,
        editarInsumo: editarInsumo,
        eliminarInsumo: eliminarInsumo
    };
})();
