/* ============================================================
   Bitácora de Consecutivos - lógica principal
   Almacenamiento: IndexedDB (persistente en el dispositivo)
   ============================================================ */

const DB_NAME = 'bitacoraConsecutivosDB';
const DB_VERSION = 1;
const STORE_REGISTROS = 'registros';
const STORE_CONFIG = 'config';

const COLUMNAS_DISPONIBLES = {
  fecha: 'Fecha',
  consecutivo: 'Consecutivo',
  asunto: 'Asunto',
  destinatario: 'Dirigido a',
  componente: 'Componente'
};

const COLUMNAS_POR_DEFECTO = [
  { key: 'fecha', activa: true },
  { key: 'consecutivo', activa: true },
  { key: 'asunto', activa: true },
  { key: 'destinatario', activa: true },
  { key: 'componente', activa: false }
];

let db = null;
let registros = [];
let ultimoConsecutivo = 0;
let columnasExport = JSON.parse(JSON.stringify(COLUMNAS_POR_DEFECTO));
let componenteSeleccionado = null;

/* ---------------------- IndexedDB helpers ---------------------- */

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const dbase = e.target.result;
      if (!dbase.objectStoreNames.contains(STORE_REGISTROS)) {
        dbase.createObjectStore(STORE_REGISTROS, { keyPath: 'id' });
      }
      if (!dbase.objectStoreNames.contains(STORE_CONFIG)) {
        dbase.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function txStore(nombre, modo) {
  return db.transaction(nombre, modo).objectStore(nombre);
}

function getTodosRegistros() {
  return new Promise((resolve, reject) => {
    const req = txStore(STORE_REGISTROS, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

function putRegistro(registro) {
  return new Promise((resolve, reject) => {
    const req = txStore(STORE_REGISTROS, 'readwrite').put(registro);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

function deleteRegistro(id) {
  return new Promise((resolve, reject) => {
    const req = txStore(STORE_REGISTROS, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

function getConfig(key, valorPorDefecto) {
  return new Promise((resolve, reject) => {
    const req = txStore(STORE_CONFIG, 'readonly').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : valorPorDefecto);
    req.onerror = (e) => reject(e.target.error);
  });
}

function setConfig(key, value) {
  return new Promise((resolve, reject) => {
    const req = txStore(STORE_CONFIG, 'readwrite').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

/* ---------------- Migración best-effort desde localStorage ---------------- */
/* Si en este mismo navegador existieran datos de una versión anterior
   guardados con localStorage, se incorporan una sola vez. No afecta
   nada si no existen (caso normal en una instalación nueva). */
async function migrarDesdeLocalStorageSiExiste() {
  try {
    const crudo = localStorage.getItem('bitacora-oficios');
    if (!crudo) return;
    const antiguos = JSON.parse(crudo);
    if (!Array.isArray(antiguos) || antiguos.length === 0) return;

    const existentesIds = new Set(registros.map(r => r.id));
    let maxNumero = ultimoConsecutivo;
    for (const r of antiguos) {
      if (!r.id || existentesIds.has(r.id)) continue;
      await putRegistro(r);
      registros.push(r);
      if (typeof r.numero === 'number' && r.numero > maxNumero) maxNumero = r.numero;
    }
    if (maxNumero > ultimoConsecutivo) {
      ultimoConsecutivo = maxNumero;
      await setConfig('ultimoConsecutivo', ultimoConsecutivo);
    }
    localStorage.removeItem('bitacora-oficios');
  } catch (e) {
    console.warn('Migración omitida:', e);
  }
}

/* ---------------------- Utilidades de fecha ---------------------- */

function hoyISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function isoADDMMYYYY(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/* ---------------------- Consecutivo ---------------------- */

function formatearConsecutivo(numero, fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anioCorto = String(fecha.getFullYear()).slice(-1);
  const numStr = String(numero).padStart(3, '0');
  return `C-${numStr}${mes}${anioCorto}`;
}

function actualizarVistaPrevioConsecutivo() {
  const fecha = document.getElementById('fecha').value || hoyISO();
  const siguiente = ultimoConsecutivo + 1;
  document.getElementById('proximoPreview').textContent = formatearConsecutivo(siguiente, fecha);
}

/* ---------------------- Inicialización ---------------------- */

async function iniciar() {
  db = await abrirDB();
  registros = await getTodosRegistros();
  ultimoConsecutivo = await getConfig('ultimoConsecutivo', 0);
  const colsGuardadas = await getConfig('columnasExport', null);
  if (colsGuardadas) columnasExport = colsGuardadas;

  await migrarDesdeLocalStorageSiExiste();

  document.getElementById('fecha').value = hoyISO();
  actualizarVistaPrevioConsecutivo();
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((e) => {
      console.warn('No se pudo registrar el service worker:', e);
    });
  }

  actualizarEstadoConexion();
  window.addEventListener('online', actualizarEstadoConexion);
  window.addEventListener('offline', actualizarEstadoConexion);
}

function actualizarEstadoConexion() {
  const el = document.getElementById('estadoOffline');
  el.classList.toggle('mostrar', !navigator.onLine);
}

/* ---------------------- Formulario / registro ---------------------- */

document.getElementById('fecha').addEventListener('change', actualizarVistaPrevioConsecutivo);

document.querySelectorAll('.comp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.comp-btn').forEach(b => b.classList.remove('activo'));
    btn.classList.add('activo');
    componenteSeleccionado = btn.dataset.c;
  });
});

document.getElementById('btnGenerar').addEventListener('click', async () => {
  const fecha = document.getElementById('fecha').value || hoyISO();
  const destinatario = document.getElementById('destinatario').value.trim();
  const asunto = document.getElementById('asunto').value.trim();

  if (!asunto) { alert('Registra el asunto del oficio.'); return; }
  if (!componenteSeleccionado) { alert('Selecciona el componente.'); return; }
  if (!destinatario) { alert('Registra a quién va dirigido.'); return; }

  const numero = ultimoConsecutivo + 1;
  const consecutivoTexto = formatearConsecutivo(numero, fecha);

  const nuevo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    consecutivo: consecutivoTexto,
    numero,
    fecha,
    asunto,
    destinatario,
    componente: componenteSeleccionado,
    creado: new Date().toISOString()
  };

  await putRegistro(nuevo);
  ultimoConsecutivo = numero;
  await setConfig('ultimoConsecutivo', ultimoConsecutivo);

  registros.unshift(nuevo);

  document.getElementById('selloNum').textContent = consecutivoTexto;
  document.getElementById('sello').classList.add('mostrar');

  document.getElementById('asunto').value = '';
  document.getElementById('destinatario').value = '';
  componenteSeleccionado = null;
  document.querySelectorAll('.comp-btn').forEach(b => b.classList.remove('activo'));

  actualizarVistaPrevioConsecutivo();
  render();
});

document.getElementById('btnCopiar').addEventListener('click', () => {
  const texto = document.getElementById('selloNum').textContent;
  navigator.clipboard.writeText(texto).catch(() => {});
});

/* ---------------------- Historial ---------------------- */

document.getElementById('buscar').addEventListener('input', render);
document.getElementById('filtroComp').addEventListener('change', render);

async function borrar(id) {
  const registro = registros.find(r => r.id === id);
  if (!registro) return;
  const ok = confirm(`¿Eliminar el registro ${registro.consecutivo}? Esta acción no se puede deshacer y el número no volverá a usarse.`);
  if (!ok) return;
  await deleteRegistro(id);
  registros = registros.filter(r => r.id !== id);
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const lista = document.getElementById('lista');
  const q = document.getElementById('buscar').value.toLowerCase();
  const filtroComp = document.getElementById('filtroComp').value;

  const ordenados = registros.slice().sort((a, b) => b.numero - a.numero);

  const visibles = ordenados.filter(r => {
    const coincideTexto = !q ||
      r.asunto.toLowerCase().includes(q) ||
      r.destinatario.toLowerCase().includes(q) ||
      r.consecutivo.toLowerCase().includes(q) ||
      r.fecha.includes(q);
    const coincideComp = !filtroComp || r.componente === filtroComp;
    return coincideTexto && coincideComp;
  });

  document.getElementById('contadorTotal').textContent = `${registros.length} oficio${registros.length === 1 ? '' : 's'}`;

  if (visibles.length === 0) {
    lista.innerHTML = '<div class="vacio">Aún no hay oficios registrados con este filtro.</div>';
    return;
  }

  lista.innerHTML = visibles.map(r => `
    <div class="registro-item" data-c="${r.componente}">
      <div class="fila1">
        <span class="cons">${r.consecutivo}</span>
        <span class="fecha">${r.fecha}</span>
      </div>
      <div class="asunto">${escapeHtml(r.asunto)}</div>
      <div class="meta">
        <span class="comp-tag">${r.componente} · ${escapeHtml(r.destinatario)}</span>
        <button class="del" data-id="${r.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  lista.querySelectorAll('.del').forEach(b => {
    b.addEventListener('click', () => borrar(b.dataset.id));
  });
}

/* ---------------------- Ajuste manual del consecutivo ---------------------- */

document.getElementById('btnAjustarConsecutivo').addEventListener('click', async () => {
  const valor = parseInt(document.getElementById('ajusteConsecutivo').value, 10);
  if (!valor || valor < 1) { alert('Ingresa un número válido.'); return; }
  const ok = confirm(`El próximo consecutivo generado será el número ${valor}. Actualmente el próximo sería ${ultimoConsecutivo + 1}. ¿Confirmas el cambio?`);
  if (!ok) return;
  ultimoConsecutivo = valor - 1;
  await setConfig('ultimoConsecutivo', ultimoConsecutivo);
  document.getElementById('ajusteConsecutivo').value = '';
  actualizarVistaPrevioConsecutivo();
  alert('Consecutivo ajustado correctamente.');
});

/* ---------------------- Exportación a Excel ---------------------- */

const modalExportar = document.getElementById('modalExportar');

document.getElementById('btnAbrirExportar').addEventListener('click', () => {
  document.getElementById('fechaDesde').value = '';
  document.getElementById('fechaHasta').value = hoyISO();
  document.getElementById('chkExportarTodos').checked = true;
  actualizarEstadoRangoFechas();
  renderColConfig();
  modalExportar.classList.add('mostrar');
});

document.getElementById('btnCancelarExportar').addEventListener('click', () => {
  modalExportar.classList.remove('mostrar');
});

document.getElementById('chkExportarTodos').addEventListener('change', actualizarEstadoRangoFechas);

function actualizarEstadoRangoFechas() {
  const todos = document.getElementById('chkExportarTodos').checked;
  document.getElementById('fechaDesde').disabled = todos;
  document.getElementById('fechaHasta').disabled = todos;
}

function renderColConfig() {
  const cont = document.getElementById('colConfig');
  cont.innerHTML = columnasExport.map((c, i) => `
    <div class="col-row">
      <span class="orden">${i + 1}</span>
      <label>
        <input type="checkbox" data-key="${c.key}" ${c.activa ? 'checked' : ''}>
        ${COLUMNAS_DISPONIBLES[c.key]}
      </label>
      <div class="flechas">
        <button data-dir="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''} type="button">↑</button>
        <button data-dir="down" data-idx="${i}" ${i === columnasExport.length - 1 ? 'disabled' : ''} type="button">↓</button>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('input[type=checkbox]').forEach(chk => {
    chk.addEventListener('change', async () => {
      const col = columnasExport.find(c => c.key === chk.dataset.key);
      col.activa = chk.checked;
      await setConfig('columnasExport', columnasExport);
    });
  });

  cont.querySelectorAll('button[data-dir]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const dir = btn.dataset.dir;
      const nuevoIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (nuevoIdx < 0 || nuevoIdx >= columnasExport.length) return;
      [columnasExport[idx], columnasExport[nuevoIdx]] = [columnasExport[nuevoIdx], columnasExport[idx]];
      await setConfig('columnasExport', columnasExport);
      renderColConfig();
    });
  });
}

document.getElementById('btnGenerarExcel').addEventListener('click', () => {
  const exportarTodos = document.getElementById('chkExportarTodos').checked;
  const desde = document.getElementById('fechaDesde').value;
  const hasta = document.getElementById('fechaHasta').value;

  if (!exportarTodos && (!desde || !hasta)) {
    alert('Indica la fecha "Desde" y "Hasta", o marca "Exportar todos".');
    return;
  }
  if (!exportarTodos && desde > hasta) {
    alert('La fecha "Desde" no puede ser posterior a la fecha "Hasta".');
    return;
  }

  const activas = columnasExport.filter(c => c.activa);
  if (activas.length === 0) {
    alert('Selecciona al menos una columna para exportar.');
    return;
  }

  let seleccion = registros.slice().sort((a, b) => a.numero - b.numero);
  if (!exportarTodos) {
    seleccion = seleccion.filter(r => r.fecha >= desde && r.fecha <= hasta);
  }

  if (seleccion.length === 0) {
    alert('No hay registros en el rango seleccionado.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('No se pudo cargar el generador de Excel. Verifica tu conexión a internet e inténtalo de nuevo (esto solo se necesita la primera vez).');
    return;
  }

  const encabezado = activas.map(c => COLUMNAS_DISPONIBLES[c.key]);
  const filas = seleccion.map(r => activas.map(c => r[c.key] ?? ''));
  const datos = [encabezado, ...filas];

  const ws = XLSX.utils.aoa_to_sheet(datos);
  ws['!cols'] = activas.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Consecutivos');

  let nombreArchivo;
  if (exportarTodos) {
    nombreArchivo = 'Registro_Consecutivos_Todos.xlsx';
  } else {
    nombreArchivo = `Registro_Consecutivos_${isoADDMMYYYY(desde)}_a_${isoADDMMYYYY(hasta)}.xlsx`;
  }

  XLSX.writeFile(wb, nombreArchivo);
  modalExportar.classList.remove('mostrar');
});

/* ---------------------- Respaldo / restauración ---------------------- */

document.getElementById('btnRespaldoExportar').addEventListener('click', () => {
  const respaldo = {
    version: 1,
    generado: new Date().toISOString(),
    ultimoConsecutivo,
    columnasExport,
    registros
  };
  const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `respaldo_consecutivos_${hoyISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('btnRespaldoImportar').addEventListener('click', () => {
  document.getElementById('inputRespaldo').click();
});

document.getElementById('inputRespaldo').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  try {
    const texto = await archivo.text();
    const datos = JSON.parse(texto);
    if (!datos || !Array.isArray(datos.registros)) {
      alert('El archivo de respaldo no tiene un formato válido.');
      return;
    }

    const existentesIds = new Set(registros.map(r => r.id));
    const nuevos = datos.registros.filter(r => r.id && !existentesIds.has(r.id));

    const ok = confirm(
      `Este respaldo tiene ${datos.registros.length} registro(s).\n` +
      `Se agregarán ${nuevos.length} registro(s) nuevos (no se duplicará ninguno existente).\n\n` +
      `¿Deseas continuar?`
    );
    if (!ok) { e.target.value = ''; return; }

    for (const r of nuevos) {
      await putRegistro(r);
      registros.push(r);
    }

    let maxNumero = ultimoConsecutivo;
    if (typeof datos.ultimoConsecutivo === 'number') maxNumero = Math.max(maxNumero, datos.ultimoConsecutivo);
    for (const r of registros) {
      if (typeof r.numero === 'number' && r.numero > maxNumero) maxNumero = r.numero;
    }
    ultimoConsecutivo = maxNumero;
    await setConfig('ultimoConsecutivo', ultimoConsecutivo);

    actualizarVistaPrevioConsecutivo();
    render();
    alert('Respaldo importado correctamente.');
  } catch (err) {
    console.error(err);
    alert('No se pudo leer el archivo de respaldo.');
  } finally {
    e.target.value = '';
  }
});

/* ---------------------- Arranque ---------------------- */

iniciar();
