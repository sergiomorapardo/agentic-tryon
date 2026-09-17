# Probador virtual · variante open source en un solo HTML

Construida a partir de `prompts/virtual-tryon-open-source.md`. `index.html` es el entregable: un archivo autocontenido (167 KB) que abre la cámara del MacBook,
captura una foto, la manda a un modelo open source de virtual try-on y muestra el antes y el después.
No hay build, npm, backend ni servidor local. La prenda (una polo bicolor) va incrustada en base64.

## Cómo correrlo

1. Doble clic en `index.html` (o arrastrarlo a Chrome). Funciona desde `file://`.
2. Chrome pide permiso de cámara la primera vez: **Permitir**.
3. Colócate dentro del marco 3:4, pulsa **Capturar foto** (o `espacio`): cuenta atrás de 3 s.
4. Revisa la foto y pulsa **Generar** (`⏎`). El estado y el contador de segundos van en la barra grande.
5. **Descargar resultado** (`D`) guarda el PNG. **Repetir foto** (`R`) vuelve a la cámara. `esc` cancela.

Ajustes (desplegable inferior): token HF, X-IP-Token, clave fal.ai, orden de modelos, pasos, tiempo máximo,
URL de un Gradio local. Se guardan en `localStorage`, nunca en el archivo.

## Prenda por enlace: `custom-garment.html`

Misma página, más una barra arriba para pegar el **enlace directo** a la imagen de una prenda (clic derecho sobre la foto del
producto → «Copiar dirección de la imagen»). También vale pegar el enlace con Cmd+V en cualquier punto de la página. La prenda
de ejemplo sigue incrustada y vuelve con «Prenda de ejemplo» o si el enlace falla.

Cómo se trae la imagen desde un `file://`, en este orden (probado):

1. Descarga directa desde el navegador, si el servidor de la tienda envía cabeceras CORS (pocos lo hacen).
2. A través del proxy público `images.weserv.nl` (el mismo que usa la app principal), que añade CORS y aplana transparencias en blanco.
3. Si nada de eso funciona pero la imagen se puede mostrar, se le pasa la URL al Space y él la descarga (verificado con Gradio 4.24).

En 1 y 2 la imagen se normaliza en el navegador a 768×1024 con fondo blanco, que es lo que esperan los modelos; en 3 no, e IDM-VTON
la estira a 3:4. El campo «Descripción para el modelo» alimenta el prompt de IDM-VTON («model is wearing …»): en inglés y corto.
El enlace y la descripción se recuerdan entre sesiones, así que se pueden dejar listos antes de la presentación.

Límites: solo prendas de torso (el Space de IDM-VTON enmascara únicamente la parte superior). Funciona mejor con foto de producto
frontal, sin persona y sobre fondo liso. El enlace pasa por weserv.nl y por el Space de Hugging Face: no uses imágenes privadas.
Probado en Chrome headless con un enlace con CORS (directa), uno sin CORS (proxy) y uno roto (error en pantalla y vuelta al
ejemplo). La generación completa con prenda por enlace usa el mismo camino de subida ya probado con la prenda incrustada.

## Qué modelo se usa y por qué

| Vía | Veredicto | Motivo (verificado) |
|---|---|---|
| **Space `yisol/IDM-VTON` (ZeroGPU) vía `@gradio/client`** | **Elegida** | CORS acepta origen `null` (file://). 18-22 s de GPU por imagen en cola vacía. Resultado excelente en foto de medio cuerpo. Gratis. |
| Space `franciszzj/Leffa` (ZeroGPU) | Respaldo | API verificada, pero pide 180 s de cuota por llamada; en anónimo (180 s/día) casi nunca entra. |
| Space `zhengchong/CatVTON` | Descartado | En `RUNTIME_ERROR` el 16-sep-2026. |
| fal.ai `fal-ai/leffa/virtual-tryon` | Respaldo de pago | CORS OK desde `null`, acepta data-URI base64, $0.10/generación, uso comercial permitido. Requiere clave. **No probado sin clave.** |
| Replicate | Descartado | Su API no devuelve cabeceras CORS (comprobado con `curl -X OPTIONS`): imposible desde un HTML suelto. |
| Inferencia en el navegador (transformers.js / ONNX / WebGPU) | Imposible hoy | No existe port de ningún VTON de difusión (IDM-VTON es SDXL, 2-7 GB de pesos); en un MacBook Intel tardaría minutos por imagen si existiera. |
| 100 % local sin red | No cumple las restricciones | Solo corriendo la app de IDM-VTON en Python con GPU y apuntando el HTML a `http://127.0.0.1:7860` (con `demo.launch(strict_cors=False)`, porque Gradio bloquea el origen `null` hacia localhost). |

Lo que se sacrifica con la elección: dependencia de la red y de un Space público compartido (cola y cuota diaria),
espera total de 45-70 s por imagen (la descarga del PNG pesa tanto como la GPU) y prenda de dataset de investigación
(VITON-HD, sustituible).

## Qué se verificó y qué queda como supuesto

Verificado (16-sep-2026, con `curl`, Node y Chrome 152 headless con cámara falsa):

- `huggingface.co/api` y `*.hf.space` responden `access-control-allow-origin: null` y el preflight acepta `authorization` y `x-ip-token`.
- Firmas de API: IDM-VTON `/tryon` (Gradio 4.24.0), Leffa `/leffa_predict_vt` (Gradio 5.38.2, `step` mínimo 30), OOTDiffusion `/process_hd` (6.20.0).
- Flujo completo en Chrome desde `file://`, tres veces: cámara → captura 768×1024 sin espejo → IDM-VTON → resultado en pantalla.
  Tiempos: 19-22 s de cola+GPU y **20-50 s más de descarga** del PNG (~600 KB) porque el endpoint `/file=` del Space entrega
  ~25 KB/s. Total observado: 45-70 s. Bajarlo en rangos paralelos fue peor en Chrome (una sola conexión HTTP/2), se descartó.
- Pantalla de error con cámara denegada y con cuota ZeroGPU agotada (mensaje legible, botones de reintento).
- Cuota ZeroGPU anónima medida: **180 s de GPU al día por IP** (los docs dicen 2 min). IDM-VTON reserva 90 s por llamada
  (60 s × factor 1,5) y consume los ~20 s reales; hoy aguantó 5 generaciones seguidas. Leffa reserva 180 s (nunca entra en anónimo)
  y al tercer intento devolvió además un «runs limit».
- `@gradio/client` 2.6.0 (ISC) incrustado tal cual; el `export` final se convierte en `window.__gradio` en `src/build.mjs`.

Supuestos / no verificado:

- Que un token HF (`Authorization: Bearer`) atribuya la cuota de la cuenta al llamar por API: el paquete `spaces` solo lee `X-IP-Token`,
  y en los foros de HF (dic-2024, mar-2025) usuarios PRO reportan que el token vía cliente **no** les aplicó su cuota. Por eso el HTML
  también permite pegar un `X-IP-Token` copiado de DevTools; tampoco pude probarlo sin cuenta.
- Ruta fal.ai: escrita contra la documentación REST (`queue.fal.run`, `status_url`, `response_url`) y probada solo hasta el 401 sin clave.
- Leffa: la petición llega al servidor y pasa la validación, pero nunca obtuve cuota para ver una imagen suya.
- Prenda: imagen del dataset VITON-HD (ejemplos del propio Space, uso de investigación). Para cambiarla, sustituye `src/garment.jpg`
  por una foto de producto frontal sobre fondo blanco (ideal 768×1024), ajusta `GARMENT.description` en `src/template.html` y
  ejecuta `node src/build.mjs`.

## Puntos de fallo en vivo y mitigación rápida

1. **Cuota ZeroGPU agotada por IP** (el error más probable en un evento: la wifi comparte IP con toda la sala).
   → Presenta desde el **hotspot del móvil** (IP propia y limpia). No ensayes el mismo día desde esa IP: la cuota resetea 24 h después del primer uso.
   → Ten una **clave de fal.ai** con 2-3 USD cargados y ponla en Ajustes; el HTML pasa solo a fal si IDM-VTON falla.
2. **Cola larga en el Space** (mucha gente usándolo). El estado muestra posición y ETA; a los 150 s salta al siguiente modelo.
   → Baja el tiempo máximo a 60-90 s en Ajustes si tienes fal como respaldo.
3. **Space caído / durmiendo**: las pastillas de la cabecera lo dicen al abrir la página. → Cambia el orden de modelos en Ajustes.
4. **Cámara ocupada** por Zoom/Teams/FaceTime: mensaje en pantalla; cierra la otra app y «Reintentar cámara».
5. **Descarga lenta del resultado**: tras «Descargando resultado…» pueden pasar 20-50 s; el contador sigue corriendo. Con fal
   la imagen llega de un CDN rápido.
6. **Foto mal encuadrada**: el modelo necesita torso y hombros visibles, sin brazos cruzados, luz frontal. Usa el marco 3:4 y la cuenta atrás.

Ensayo recomendado 1-2 días antes, desde el hotspot: una generación completa, comprobar descarga y guardar una captura de pantalla
del resultado como plan C (mostrarla si todo falla).

## Estructura

- `index.html` — entregable final, autocontenido, prenda incrustada.
- `custom-garment.html` — igual, más la barra de prenda por enlace.
- `src/template.html` — plantilla legible (CSS + app JS) con dos placeholders.
- `src/gradio-client-2.6.0.min.js` — bundle oficial de `@gradio/client` descargado de jsDelivr.
- `src/garment.jpg` — prenda de la demo.
- `src/build.mjs` — ensambla los dos HTML (`node src/build.mjs`, Node ≥ 18). Solo hace falta para regenerarlos.
- `src/e2e.mjs` — prueba automática en Chrome headless con cámara falsa (sin dependencias). Sirve para ensayar sin gastar
  la cámara ni tocar la pantalla: `cp foto.jpg foto.mjpeg && node src/e2e.mjs index.html foto.mjpeg`
  (`--skip-generate` no gasta cuota; `--deny-camera` y `--order=leffa` prueban las pantallas de error). Deja capturas y
  resultado en `./e2e-out/`.

## Ensayo rápido antes del evento (5 min)

```bash
cd open-source-tryon
cp ~/una-foto-de-medio-cuerpo.jpg foto.mjpeg
node src/e2e.mjs index.html foto.mjpeg        # una generación real: mira "resultado recibido en N s" en el registro
open index.html                               # y una vez con la cámara de verdad, desde el hotspot
```
