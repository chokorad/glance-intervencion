# Glance Intervención — pasos para instalar

Carpeta: `glance-intervencion`. Tres archivos: `Code.gs`, `index.html`, `SETUP.md` (este).

---

**Paso 1 — abre tu Google Sheet**
"Seguimientos Intervención" → menú **Extensions → Apps Script**.

**Paso 2 — pega `Code.gs`**
En el editor de Apps Script, crea un archivo nuevo (o usa uno existente) y pega todo el contenido de `Code.gs`.

**Paso 3 — el CONFIG ya está completo**
`SPREADSHEET_ID`, `DRIVE_ROOT_FOLDER_ID` y `ACCESS_CODE` (tu PIN: `Cfsg`) ya vienen puestos. No necesitas tocar nada, solo guarda (Ctrl+S).

**Paso 4 — publica el Web App**
`Deploy → New deployment` → tipo **Web app** → Execute as **Me** → Who has access **Anyone** → `Deploy`.
("Anyone" es para que puedas entrar sin loguearte a Google — el PIN del paso 3 es lo que protege los datos, no el login de Google.)
Copia la URL que termina en `/exec`.

**Paso 5 — pega esa URL en `index.html`**
Abre `index.html`, busca la línea:
```js
const API_URL = 'PON_AQUI_TU_URL_DE_WEB_APP/exec';
```
Reemplaza el texto entre comillas por la URL que copiaste. Guarda.

**Paso 6 — sube `index.html` a GitHub Pages**
Súbelo a tu repo (puede ser una carpeta nueva, ej. `/glance/index.html`). No necesitas subir `Code.gs` ahí — ese vive solo en Apps Script.

**Paso 7 — pruébalo**
Abre la URL de GitHub Pages desde tu celular y desde tu laptop. La primera vez te va a pedir el PIN que pusiste en el paso 3 — se guarda en ese navegador, no lo vuelve a pedir después. Revisa:
- Las tres pestañas (Intervenciones / Consulta ISSSTE / Consulta ISSSTECali) cargan pacientes.
- Tocar una tarjeta expande antecedentes/comentario.
- El toggle "Imágenes" muestra el DICOM Link si el paciente ya tiene uno.
- Subir una imagen desde el celular te ofrece cámara o galería.
- La imagen sube y aparece de inmediato en la tira de miniaturas.

**Paso 8 — si algo no carga**
Lo más probable es un nombre de pestaña o columna distinto al que usé. Revísalo en `Code.gs` (bloque `COL` y `CONFIG.SHEETS`) o dime qué error te marca y lo ajusto.

---

**Nota de seguridad:** el Web App está publicado como "Anyone" (nadie necesita cuenta de Google), así que el PIN de `ACCESS_CODE` es lo único que protege los datos de pacientes — trátalo como una contraseña real, no lo compartas por WhatsApp sin cifrar ni lo dejes en un lugar público. Las imágenes en Drive quedan como "cualquiera con el link puede ver" (necesario para que las miniaturas se rendericen) — no buscable, pero no es cero riesgo. Si tu Drive es de una organización, dime y lo cambio a "solo dentro de tu organización".

**Recuerda:** cada vez que edites `Code.gs`, tienes que publicar una **versión nueva** del deployment (no basta con guardar) — igual que en tu sistema de WhatsApp.
