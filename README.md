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
IDM-VTON alternativo (tu copia del Space en GPU de pago o un Gradio local). Se guardan en `localStorage`, nunca en el archivo.

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

1. **Cuota ZeroGPU agotada por IP** (el error más probable en un evento: la wifi comparte IP con toda la sala; el propio error
   ofrece un botón que abre Ajustes). No hay ningún Space público con estos modelos en GPU de pago (revisados los 183 Spaces
   de try-on el 16-sep-2026), así que las salidas reales son tres:
   → **Clave de fal.ai** en Ajustes (0,10 USD por imagen, modelo Leffa; cuenta en 3 minutos, prepago). La página pasa sola a fal cuando IDM-VTON falla.
   → **Tu copia del Space en GPU de pago**: en `yisol/IDM-VTON` → «Duplicate this Space» → hardware A10G small (1 USD/h) o L4 (0,80 USD/h);
     requiere plan PRO para crear Spaces con cómputo. Escribe `tu-usuario/IDM-VTON` en el campo «IDM-VTON alternativo» de Ajustes.
     Sin cuota ni cola compartida; enciéndelo 20 min antes (descarga ~10 GB de pesos) y páusalo al terminar para no pagar.
   → **Hotspot del móvil** (IP propia y limpia): gratis, 4-5 generaciones. No ensayes el mismo día desde esa IP: la cuota resetea 24 h después del primer uso.
2. **Cola larga en el Space** (mucha gente usándolo). El estado muestra posición y ETA; a los 150 s salta al siguiente modelo.
   → Baja el tiempo máximo a 60-90 s en Ajustes si tienes fal como respaldo.
3. **Space caído / durmiendo**: las pastillas de la cabecera lo dicen al abrir la página. → Cambia el orden de modelos en Ajustes.
4. **Cámara ocupada** por Zoom/Teams/FaceTime: mensaje en pantalla; cierra la otra app y «Reintentar cámara».
5. **Descarga lenta del resultado**: tras «Descargando resultado…» pueden pasar 20-50 s; el contador sigue corriendo. Con fal
   la imagen llega de un CDN rápido.
6. **Foto mal encuadrada**: el modelo necesita torso y hombros visibles, sin brazos cruzados, luz frontal. Usa el marco 3:4 y la cuenta atrás.

Ensayo recomendado 1-2 días antes, desde el hotspot: una generación completa, comprobar descarga y guardar una captura de pantalla
del resultado como plan C (mostrarla si todo falla).

## Variante agéntica: `agentic.html` + `server.mjs` (Claude + IDM-VTON)

Misma interfaz, pero la generación pasa por un servidor local que orquesta a Claude (SDK oficial `@anthropic-ai/sdk`,
modelo `claude-opus-5`) alrededor de IDM-VTON. **Claude no genera imágenes** (la API solo devuelve texto), así que la imagen
la sigue produciendo IDM-VTON en el Space gratuito; Claude decide si vale la pena generar, escribe la descripción de la
prenda, califica el resultado y propone la revisión. Solo hace falta la clave de Anthropic.

```bash
cd open-source-tryon
npm install                 # una vez: @anthropic-ai/sdk, zod, @gradio/client 2.6.0 (solo para el servidor)
nano .env                   # ANTHROPIC_API_KEY=sk-ant-…  (opcional: HF_TOKEN, CLAUDE_MODEL, MAX_REVISIONS, IDM_SPACE)
npm start                   # http://localhost:3000  (la cámara funciona porque localhost es contexto seguro)
```

`.env` está en `.gitignore` y solo lo lee `server.mjs`: las claves nunca llegan al navegador. A diferencia del resto del
repo, esta carpeta sí usa dependencias npm, pero únicamente en el servidor; la página sigue sin build ni CDN.

### Patrones (según «Building effective agents» de Anthropic y la guía de workflows de LangGraph)

Es un **workflow**: la estructura está fija en código (`agent/workflow.mjs`) y Claude toma decisiones dentro de ella.
No se usó un agente libre con herramientas porque los pasos se conocen de antemano y cada generación gasta cuota escasa
de ZeroGPU: dejar que el modelo decida cuántas veces generar podría agotarla en una sola corrida.

1. **Paralelización (sectioning)**: dos ramas fijas en paralelo, ambas esperadas antes de decidir: Claude revisa la foto
   (¿una persona, de frente, con cabeza y torso?) y analiza la prenda (categoría, descripción para el prompt de IDM-VTON,
   rasgos clave). Compuerta: si la foto no sirve o la prenda no es de torso, se detiene **sin gastar GPU**.
2. **Evaluator-optimizer**: IDM-VTON genera; Claude califica con una rúbrica de 1 a 5 (fidelidad de la prenda, identidad
   preservada, realismo) y propone descripción, auto-crop y pasos para el siguiente intento. Aprueba si los tres criterios
   llegan a 4. Máximo `MAX_REVISIONS` revisiones (1 por defecto, por la cuota). Si ninguna aprueba, se entrega el mejor
   intento (mayor puntaje mínimo) **con los criterios incumplidos visibles**: llegar al límite no lo convierte en aprobado.

Todo queda visible en la página: los pasos en grupos «Paralelo» y «Evaluador-optimizador» con su duración, el veredicto de
Claude, los puntajes del intento entregado y el costo en Claude de la corrida.

### Medido el 5-oct-2026

| Caso | Tiempo total | Llamadas a Claude | Costo Claude |
| --- | --- | --- | --- |
| Foto no apta (compuerta) | ~3 s | 2 | ~US$ 0,02 (0 s de GPU) |
| Generación real aprobada al primer intento (CLI) | 25 s (15 s de IDM-VTON) | 3 | ~US$ 0,045 |
| Con una revisión (generador simulado) | 18-23 s + GPU | 4 | ~US$ 0,075 |

Impacto frente a la versión sin Claude: añade ~3 s y ~US$ 0,02 antes de generar y ~6-7 s y ~US$ 0,025 por evaluación.
A cambio, una foto mala no consume los 60-90 s de cuota ZeroGPU que reserva cada llamada (≈ 4-5 generaciones al día por IP),
y el resultado sale con un veredicto explicable. Lo que no se ha medido: si la revisión propuesta por Claude mejora de
verdad el resultado de IDM-VTON en casos que fallan (la prueba de revisión usó un generador simulado).

### Pruebas

- `node agent/run.mjs persona.jpg prenda.jpg` corre el workflow sin navegador (genera de verdad).
- `IDM_MOCK=a.png,b.png npm start` sustituye IDM-VTON por esas imágenes, en orden, para probar la interfaz y el ciclo de
  revisión sin gastar cuota (por ejemplo, la foto original primero para forzar el rechazo, luego un resultado real).
- `node src/e2e.mjs http://localhost:3000 foto.mjpeg` hace el recorrido completo en Chrome headless con cámara falsa.
  La cámara falsa entrega 16:9 y recorta arriba y abajo: centra la foto en un lienzo 16:9
  (`sips --padToHeightWidth 1024 1820 --padColor FFFFFF foto.jpg --out foto.jpg`) o Claude la rechazará, con razón, por
  la cabeza cortada.
- Verificado el 5-oct-2026: compuerta (foto sin persona y cabeza cortada), generación real aprobada, revisión que pasa de
  1/5 a aprobada, revisión que termina sin aprobar, cuota agotada (mensaje con la hora de renovación) y regresión de
  `index.html` y `custom-garment.html` en `file://`. Foto de prueba: ejemplo `00034_00.jpg` del Space de IDM-VTON.

## Estructura

- `index.html` — entregable final, autocontenido, prenda incrustada.
- `custom-garment.html` — igual, más la barra de prenda por enlace.
- `src/template.html` — plantilla legible (CSS + app JS) con tres placeholders.
- `src/gradio-client-2.6.0.min.js` — bundle oficial de `@gradio/client` descargado de jsDelivr.
- `src/garment.jpg` — prenda de la demo.
- `src/build.mjs` — ensambla los tres HTML (`node src/build.mjs`, Node ≥ 18). Solo hace falta para regenerarlos.
- `agentic.html` — variante agéntica; la sirve `server.mjs`, sin el cliente de Gradio incrustado.
- `server.mjs` — servidor local: página, `/api/health` y `/api/tryon` (eventos NDJSON en streaming).
- `agent/workflow.mjs` — workflow con Claude (paralelización + evaluator-optimizer); `agent/idm.mjs` — IDM-VTON desde Node;
  `agent/run.mjs` — CLI del workflow.
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
