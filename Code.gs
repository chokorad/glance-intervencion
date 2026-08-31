/**
 * SEGUIMIENTO INTERVENCIÓN — Web App backend
 * ---------------------------------------------------------------
 * Lee las pestañas de "Seguimientos Intervención" y expone tres vistas:
 *   - intervenciones          -> Upcoming + Hospitalizados + Referencias
 *   - consulta_issste         -> pestaña "Consulta", solo pendientes de revisar
 *   - consulta_chisssmecali   -> pestaña "CHISSSMECALI", solo pendientes de revisar
 *
 * También recibe subida de imágenes (a Drive) y links (a la pestaña "Links"),
 * ambos ligados a un paciente por su columna ID.
 *
 * IMPORTANTE — antes de publicar, llena la sección CONFIG de abajo.
 * Ver SETUP.md para el paso a paso de despliegue.
 */

// ============================= CONFIG =============================
const CONFIG = {
  // ID del spreadsheet (lo sacas de la URL: .../d/ESTE_ID/edit)
  SPREADSHEET_ID: '1j46Gj8RiyDDj7-19EBwl5cTds9vj76Bl7XrTLH7NXJk',

  // Nombres exactos de las pestañas tal como están hoy
  SHEETS: {
    consulta: 'Consulta',
    chisssmecali: 'CHISSSMECALI',
    upcoming: 'Upcoming',
    hospitalizados: 'Hospitalizados',
    referencias: 'Referencias',
    imagenes: 'Imagenes',   // se crea sola si no existe
    links: 'Links',          // se crea sola si no existe
    notas: 'Notas',          // se crea sola si no existe — notas libres que solo viven en la app
    estado: 'Estado',        // se crea sola si no existe — checklist "visto" + orden manual, por dispositivo NO, por servidor SÍ
  },

  // Carpeta raíz en Drive donde se guardan las imágenes (crea subcarpetas por paciente)
  DRIVE_ROOT_FOLDER_ID: '1q18sD13e3Y_5sreL0PnEnfD-E-QSjkQT',

  // Texto que escribes (o escribe el script) en la columna Status para marcar
  // explícitamente "aún no se ha revisado en consulta"
  PENDIENTE_LABEL: 'Consulta',

  // Opcional: si quieres restringir quién puede escribir (subir imagen / agregar link)
  // además de la restricción de acceso del Web App. Deja vacío [] para no filtrar aquí.
  ALLOWED_EMAILS: [],

  // PIN de acceso a la app. El Web App se publica como "Anyone" (nadie necesita cuenta
  // de Google), así que este código es lo único que protege los datos de pacientes.
  // CÁMBIALO antes de publicar — ideal algo que recuerdes pero no sea obvio.
  ACCESS_CODE: 'Cfsg',

  // Cuando una pestaña usa un nombre de encabezado distinto para el mismo dato
  // (ej. Referencias usa "Pendientes" en vez de "Comment"), se mapea aquí en vez de por letra.
  HEADER_ALIASES: {
    'Referencias': { 'Pendientes': 'Comment' },
  },

  // Zona horaria de Mexicali, fija — NO uses Session.getScriptTimeZone() para "hoy",
  // porque depende de la config del proyecto de Apps Script y puede no coincidir,
  // lo que corre el filtro de fecha un día y hace "desaparecer" pacientes de hoy.
  TIMEZONE: 'America/Tijuana',
};

// Columnas esperadas (por nombre, no por letra — así no se rompe si reordenas)
const COL = {
  FOLLOWUP: 'Followup',
  STATUS: 'Status',
  CONSULTA: 'Consulta',
  INTERVENCION: 'Intervencion',
  TIME: 'Time',
  NAME: 'Name Patient',
  ID: 'ID',
  AGE: 'Age',
  CONTACTO: 'contacto',
  PROCEDIMIENTO: 'Procedimiento',
  MAIN_PATHOLOGY: 'Main Pathology',
  ANTECEDENTES: 'Antecedentes',
  COMMENT: 'Comment',
  MODALITY: 'Modality',
  HOSPITAL: 'Hospital',
  ANATOMICAL_PART: 'Anatomical Part',
  DICOM_LINK: 'DICOM Link',
  CAMA: 'Cama',                 // solo existe en Hospitalizados
  HOSPITALIZADO: 'Hospitalizado', // checkbox -- existe en Hospitalizados (col V) y en CHISSSMECALI (col S)
};

// ============================= ENTRY POINTS =============================

function doGet(e) {
  try {
    if (!checkAccessCode(e.parameter.code)) {
      return jsonResponse({ ok: false, error: 'codigo_invalido' });
    }
    const mode = (e.parameter.mode || 'intervenciones_issste').toLowerCase();
    let payload;

    if (mode === 'consulta_issste') {
      payload = getConsultaPendiente(CONFIG.SHEETS.consulta);
    } else if (mode === 'consulta_chisssmecali') {
      payload = getConsultaPendiente(CONFIG.SHEETS.chisssmecali);
    } else if (mode === 'intervenciones_issste') {
      // Upcoming se omite a propósito: solo duplica lo que ya está en Hospitalizados/Consulta
      payload = getIntervencionesFromSheets([
        CONFIG.SHEETS.hospitalizados, CONFIG.SHEETS.referencias, CONFIG.SHEETS.consulta,
      ]);
    } else if (mode === 'intervenciones_chisssmecali') {
      payload = getIntervencionesFromSheets([CONFIG.SHEETS.chisssmecali]);
    } else if (mode === 'hosp_issste') {
      payload = getHospitalizadosList(CONFIG.SHEETS.hospitalizados);
    } else if (mode === 'hosp_chisssmecali') {
      payload = getHospitalizadosList(CONFIG.SHEETS.chisssmecali);
    } else {
      return jsonResponse({ ok: false, error: 'mode desconocido: ' + mode });
    }

    return jsonResponse({ ok: true, mode: mode, groups: payload });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!checkAccessCode(body.code) || !isAuthorized()) {
      return jsonResponse({ ok: false, error: 'No autorizado' });
    }

    // Candado: evita que dos guardados lean la hoja al mismo tiempo y se pisen
    // (esto era lo que causaba filas duplicadas y el "Visto" regresando a FALSE).
    const lock = LockService.getScriptLock();
    const gotLock = lock.tryLock(10000);
    if (!gotLock) {
      return jsonResponse({ ok: false, error: 'Ocupado, intenta de nuevo en un momento' });
    }
    try {
      if (body.action === 'upload_image') {
        return jsonResponse(uploadImage(body));
      }
      if (body.action === 'add_link') {
        return jsonResponse(addLink(body));
      }
      if (body.action === 'save_note') {
        return jsonResponse(saveNote(body));
      }
      if (body.action === 'set_estado') {
        return jsonResponse(setEstado(body));
      }
      if (body.action === 'set_orden') {
        return jsonResponse(setOrdenGrupo(body));
      }
      return jsonResponse({ ok: false, error: 'action desconocida: ' + body.action });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function isAuthorized() {
  if (!CONFIG.ALLOWED_EMAILS.length) return true; // confía solo en el PIN (ver checkAccessCode)
  const email = Session.getActiveUser().getEmail();
  return CONFIG.ALLOWED_EMAILS.indexOf(email) !== -1;
}

function checkAccessCode(code) {
  return code && String(code) === CONFIG.ACCESS_CODE;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================= LECTURA DE HOJAS =============================

function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

const KNOWN_HEADERS = Object.keys(COL).map(k => COL[k]);

function sinAcentos(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Encuentra el nombre "canónico" de un encabezado ignorando mayúsculas, acentos y espacios de más.
// Ej. "antecedentes ", "ANTECEDENTES" o "Antecedéntes" en alguna pestaña -> se leen igual que "Antecedentes".
function nombreCanonico(header) {
  const norm = sinAcentos(String(header).trim().toLowerCase());
  const match = KNOWN_HEADERS.find(k => sinAcentos(k.toLowerCase()) === norm);
  return match || String(header).trim();
}

// Convierte una pestaña en una lista de objetos {NombreColumna: valor, _row: numeroDeFila}
function readSheetAsObjects(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const aliases = CONFIG.HEADER_ALIASES[sheetName] || {};
  const headers = values[0].map(h => {
    const raw = String(h).trim();
    return aliases[raw] ? nombreCanonico(aliases[raw]) : nombreCanonico(raw);
  });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.join('') === '') continue; // fila vacía
    const obj = { _row: r + 1 };
    headers.forEach((h, i) => { obj[h] = row[i]; });
    rows.push(obj);
  }
  return rows;
}

// Descarta filas que no tienen "forma" de paciente real — vacías, o con datos temporales
// pegados fuera de las columnas correctas (ej. un número donde debería ir el nombre).
function esFilaValida(row) {
  const nombre = row[COL.NAME];
  if (nombre === null || nombre === undefined) return false;
  const s = String(nombre).trim();
  if (!s || s === '—') return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(s)) return false; // debe tener al menos una letra
  return true;
}

// 📫 = "referido, ya está duplicado en otra pestaña" -> ignorar la fila en todas las vistas
function esDuplicadoReferido(row) {
  const s1 = String(row[COL.INTERVENCION] || '');
  const s2 = String(row[COL.CONSULTA] || '');
  return s1.indexOf('📫') !== -1 || s2.indexOf('📫') !== -1;
}

// pendiente de consulta = Status (columna B) dice exactamente "Consulta" — nada más.
// Sin checar fecha, sin checar Followup: si no dice "Consulta" en Status, no entra aquí.
function esPendienteConsulta(row) {
  const status = row[COL.STATUS];
  if (status === null || status === undefined) return false;
  return String(status).trim() === CONFIG.PENDIENTE_LABEL;
}

function getConsultaPendiente(sheetName) {
  const rows = readSheetAsObjects(sheetName)
    .filter(esFilaValida)
    .filter(r => !esDuplicadoReferido(r))
    .filter(esPendienteConsulta);
  return groupByDate(rows, COL.CONSULTA);
}

// Status (columna B) sigue diciendo "pendiente" en algún lado del texto -- cubre valores como
// "🔴 Pendiente" o "Pendiente de valorar", sin importar mayúsculas/acentos/emoji alrededor.
function esStatusPendiente(row) {
  const status = row[COL.STATUS];
  if (status === null || status === undefined) return false;
  return sinAcentos(String(status).trim().toLowerCase()).indexOf('pendiente') !== -1;
}

// Intervención = trae fecha real en la columna "Intervencion" de esa pestaña, Y Status sigue pendiente.
// (ya no usa Consulta como respaldo — si no tiene fecha de Intervención, no es una intervención)
function getIntervencionesFromSheets(sheetNames) {
  let all = [];
  sheetNames.forEach(name => { all = all.concat(readSheetAsObjects(name)); });
  all = all.filter(esFilaValida).filter(r => !esDuplicadoReferido(r)).filter(esStatusPendiente);

  // Solo hoy en adelante — descarta filas viejas
  const todayKey = formatDateKey(new Date());
  const proximas = all.filter(row => {
    const key = formatDateKey(row[COL.INTERVENCION]);
    return key !== 'sin-fecha' && key >= todayKey;
  });

  return groupByDate(proximas, COL.INTERVENCION);
}

// Checkbox "Hospitalizado" -- existe en Hospitalizados (col V) y en CHISSSMECALI (col S).
// Google Sheets a veces lo entrega como boolean real, a veces como texto "TRUE" -- cubrimos los dos.
function esMarcadoHospitalizado(row) {
  const v = row[COL.HOSPITALIZADO];
  if (v === true) return true;
  return String(v || '').trim().toUpperCase() === 'TRUE';
}

// Lista plana (no agrupada por fecha) de quién está hospitalizado AHORITA, para el panel
// chico junto a Upcoming. Cama solo existe en la pestaña Hospitalizados -- en CHISSSMECALI
// sale vacío y el frontend simplemente no lo muestra.
function getHospitalizadosList(sheetName) {
  const rows = readSheetAsObjects(sheetName)
    .filter(esFilaValida)
    .filter(r => !esDuplicadoReferido(r))
    .filter(esMarcadoHospitalizado);
  return rows.map(buildHospPatient).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
}

function buildHospPatient(row) {
  return {
    id: String(row[COL.ID] || ''),
    nombre: row[COL.NAME] || '',
    edad: row[COL.AGE] || '',
    cama: row[COL.CAMA] || '',
    diagnostico: row[COL.MAIN_PATHOLOGY] || '',
    pendientes: row[COL.COMMENT] || '',
  };
}

function groupByDate(rows, dateField, fallbackField) {
  const estadoMap = getEstadoMap(); // una sola lectura de la pestaña Estado para todo el request
  const groups = {};
  rows.forEach(row => {
    let dateVal = row[dateField];
    if ((!dateVal || dateVal === '') && fallbackField) dateVal = row[fallbackField];
    const key = formatDateKey(dateVal);
    if (!groups[key]) groups[key] = [];
    groups[key].push(buildPatientSummary(row, estadoMap));
  });
  return Object.keys(groups).sort().map(date => ({
    date: date,
    // Ordena por "orden" guardado (los que no tienen orden manual se quedan al final, en su orden original)
    patients: groups[date].slice().sort((a, b) => {
      const oa = a.orden === null ? Infinity : a.orden;
      const ob = b.orden === null ? Infinity : b.orden;
      return oa - ob;
    }),
  }));
}

const MONTH_ABBR = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

// Convierte lo que sea que traiga la celda (Date real, texto "5-Aug-2026", "NA", emoji, vacío...)
// en un Date válido o null si no se puede interpretar como fecha real.
function parseDateFlexible(val) {
  if (val === null || val === undefined || val === '') return null;

  if (Object.prototype.toString.call(val) === '[object Date]') {
    // Sheets guarda celdas de solo-hora como Date anclado a 1899-12-30 -> no es una fecha real
    if (val.getFullYear() < 1900) return null;
    return val;
  }

  let s = String(val).replace(/[^\x00-\x7F]/g, '').trim(); // quita emojis / símbolos no ASCII
  if (!s || s.toUpperCase() === 'NA') return null;

  // Formato español día/mes/año (ej. 11/08/2026 = 11 de agosto). Se checa ANTES que el parser
  // nativo de JS porque este último asume mes/día/año (formato de EEUU) y da fechas equivocadas.
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return new Date(year, month - 1, day);
  }

  m = s.match(/^(\d{1,2})[\-\/]([A-Za-z]{3})[\-\/](\d{4})$/); // ej. 5-Aug-2026 (mes en letras, no ambiguo)
  if (m) {
    const month = MONTH_ABBR[m[2].toLowerCase()];
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[1]));
  }

  const native = new Date(s); // último recurso: ISO (yyyy-mm-dd) u otros formatos no ambiguos
  if (!isNaN(native.getTime())) return native;

  return null;
}

// Usa la zona horaria configurada DENTRO del propio Sheet (Archivo > Configuración de la hoja),
// no una fija en el código -- así una fecha se lee siempre igual a como se ve en pantalla.
// CONFIG.TIMEZONE queda solo como respaldo si por algo falla la lectura del Sheet.
let _sheetTz = null;
function getSheetTimeZone() {
  if (_sheetTz) return _sheetTz;
  try {
    _sheetTz = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSpreadsheetTimeZone();
  } catch (e) {
    _sheetTz = CONFIG.TIMEZONE;
  }
  return _sheetTz;
}

function formatDateKey(val) {
  const d = parseDateFlexible(val);
  if (!d) return 'sin-fecha';
  return Utilities.formatDate(d, getSheetTimeZone(), 'yyyy-MM-dd');
}

// El campo Time a veces trae solo hora (Sheets lo guarda como Date en 1899-12-30) -> mostrar solo HH:mm
function formatTimeValue(val) {
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, getSheetTimeZone(), 'HH:mm');
  }
  return val || '';
}

function buildPatientSummary(row, estadoMap) {
  const id = String(row[COL.ID] || '');
  const estado = (estadoMap && estadoMap[id]) || { visto: false, orden: null };
  return {
    id: id,
    nombre: row[COL.NAME] || '',
    edad: row[COL.AGE] || '',
    procedimiento: row[COL.PROCEDIMIENTO] || '',
    status: row[COL.STATUS] || '',
    time: formatTimeValue(row[COL.TIME]),
    hospital: row[COL.HOSPITAL] || '',
    modality: row[COL.MODALITY] || '',
    anatomicalPart: row[COL.ANATOMICAL_PART] || '',
    mainPathology: row[COL.MAIN_PATHOLOGY] || '',
    antecedentes: row[COL.ANTECEDENTES] || '',
    comentario: row[COL.COMMENT] || '',
    dicomLinkSheet: row[COL.DICOM_LINK] || '',
    imagenes: getImagesForPatient(id),
    links: getLinksForPatient(id),
    notaApp: getNotaForPatient(id),
    visto: estado.visto,
    orden: estado.orden,
  };
}

// ============================= IMÁGENES Y LINKS (child tabs) =============================

function getOrCreateChildSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function getImagesForPatient(patientId) {
  if (!patientId) return [];
  const sheet = getOrCreateChildSheet(CONFIG.SHEETS.imagenes,
    ['Timestamp', 'PatientID', 'FileID', 'ThumbURL', 'FullURL', 'Origen']);
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][1]) === patientId) {
      out.push({
        fecha: values[r][0],
        thumbUrl: values[r][3],
        fullUrl: values[r][4],
        origen: values[r][5],
      });
    }
  }
  return out;
}

function getLinksForPatient(patientId) {
  if (!patientId) return [];
  const sheet = getOrCreateChildSheet(CONFIG.SHEETS.links,
    ['Timestamp', 'PatientID', 'URL', 'Label', 'Origen']);
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][1]) === patientId) {
      out.push({
        fecha: values[r][0],
        url: values[r][2],
        label: values[r][3],
        origen: values[r][4],
      });
    }
  }
  return out;
}

function getNotaForPatient(patientId) {
  if (!patientId) return '';
  const sheet = getOrCreateChildSheet(CONFIG.SHEETS.notas, ['Timestamp', 'PatientID', 'Nota']);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][1]) === patientId) return values[r][2] || '';
  }
  return '';
}

function saveNote(body) {
  const patientId = String(body.patientId || '');
  if (!patientId) return { ok: false, error: 'Falta patientId' };
  const sheet = getOrCreateChildSheet(CONFIG.SHEETS.notas, ['Timestamp', 'PatientID', 'Nota']);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][1]) === patientId) {
      sheet.getRange(r + 1, 1, 1, 3).setValues([[new Date(), patientId, body.nota || '']]);
      return { ok: true };
    }
  }
  sheet.appendRow([new Date(), patientId, body.nota || '']);
  return { ok: true };
}

// ============================= ESTADO (visto + orden — persistido en servidor, no en el navegador) =============================

function getEstadoSheet() {
  return getOrCreateChildSheet(CONFIG.SHEETS.estado, ['PatientID', 'Visto', 'Orden', 'Timestamp']);
}

// Lee toda la pestaña Estado UNA vez por request (más rápido que leerla por cada paciente).
function getEstadoMap() {
  const sheet = getEstadoSheet();
  const values = sheet.getDataRange().getValues();
  const map = {};
  for (let r = 1; r < values.length; r++) {
    const pid = String(values[r][0] || '');
    if (!pid) continue;
    const orden = values[r][2];
    map[pid] = {
      visto: values[r][1] === true || String(values[r][1]).toUpperCase() === 'TRUE',
      orden: (orden === '' || orden === null || orden === undefined) ? null : Number(orden),
    };
  }
  return map;
}

function setEstado(body) {
  const patientId = String(body.patientId || '');
  if (!patientId) return { ok: false, error: 'Falta patientId' };
  const sheet = getEstadoSheet();
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]) === patientId) {
      const visto = body.visto !== undefined ? !!body.visto : values[r][1];
      const orden = body.orden !== undefined ? body.orden : values[r][2];
      sheet.getRange(r + 1, 1, 1, 4).setValues([[patientId, visto, orden, new Date()]]);
      return { ok: true };
    }
  }
  sheet.appendRow([patientId, body.visto === true, body.orden !== undefined ? body.orden : '', new Date()]);
  return { ok: true };
}

// Reescribe el orden (0,1,2...) de una lista completa de pacientes de un mismo día,
// según el orden en que llegan en body.ids (así se manda una sola vez tras arrastrar/mover).
function setOrdenGrupo(body) {
  const ids = body.ids || [];
  const sheet = getEstadoSheet();
  const values = sheet.getDataRange().getValues();
  const rowByPid = {};
  for (let r = 1; r < values.length; r++) { rowByPid[String(values[r][0])] = r + 1; }

  ids.forEach((rawPid, idx) => {
    const pid = String(rawPid || '');
    if (!pid) return;
    if (rowByPid[pid]) {
      const rowNum = rowByPid[pid];
      const visto = sheet.getRange(rowNum, 2).getValue();
      sheet.getRange(rowNum, 1, 1, 4).setValues([[pid, visto, idx, new Date()]]);
    } else {
      sheet.appendRow([pid, false, idx, new Date()]);
    }
  });
  return { ok: true };
}

function uploadImage(body) {
  const patientId = String(body.patientId || '');
  if (!patientId) return { ok: false, error: 'Falta patientId' };

  const bytes = Utilities.base64Decode(body.base64);
  const blob = Utilities.newBlob(bytes, body.mimeType || 'image/jpeg', body.filename || (patientId + '.jpg'));

  const root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const folderIter = root.getFoldersByName(patientId);
  const folder = folderIter.hasNext() ? folderIter.next() : root.createFolder(patientId);

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();

  const thumbUrl = 'https://lh3.googleusercontent.com/d/' + fileId + '=w300';
  const fullUrl = 'https://drive.google.com/file/d/' + fileId + '/view';

  const sheet = getOrCreateChildSheet(CONFIG.SHEETS.imagenes,
    ['Timestamp', 'PatientID', 'FileID', 'ThumbURL', 'FullURL', 'Origen']);
  sheet.appendRow([new Date(), patientId, fileId, thumbUrl, fullUrl, 'app']);

  return { ok: true, thumbUrl: thumbUrl, fullUrl: fullUrl };
}

function addLink(body) {
  const patientId = String(body.patientId || '');
  const url = String(body.url || '');
  if (!patientId || !url) return { ok: false, error: 'Falta patientId o url' };

  const sheet = getOrCreateChildSheet(CONFIG.SHEETS.links,
    ['Timestamp', 'PatientID', 'URL', 'Label', 'Origen']);
  sheet.appendRow([new Date(), patientId, url, body.label || '', 'app']);

  return { ok: true };
}
