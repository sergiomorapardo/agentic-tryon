# Desarrollo y operación

La descripción del producto y el recorrido de uso están en el [README](../README.md).
Esta guía reúne la configuración, las pruebas y el diagnóstico del probador.

## Configuración

Requiere Node.js 22 o superior. Ejecuta `npm install`, copia `.env.example` a `.env` y configura las claves.
`agent/env.mjs` carga el archivo antes de inicializar el workflow. Las variables exportadas en la shell tienen precedencia.
`.env` está ignorado por Git y el servidor no lo sirve al navegador.

| Variable | Uso |
| --- | --- |
| `ANTHROPIC_API_KEY` | Necesaria para análisis y evaluación en el modo agéntico |
| `OPENAI_API_KEY` | Necesaria cuando el generador es OpenAI |
| `GENERATOR` | `openai` o `idm`; por defecto OpenAI si hay clave, de lo contrario IDM-VTON |
| `OPENAI_IMAGE_MODEL` | Modelo de imagen; el código usa `gpt-image-2` por defecto |
| `CLAUDE_MODEL` | Modelo de análisis y evaluación; consulta el valor por defecto en `agent/workflow.mjs` |
| `MAX_REVISIONS` | Máximo de revisiones después del primer intento; por defecto `1` |
| `HF_TOKEN` | Token opcional para IDM-VTON |
| `IDM_SPACE` | Space de IDM-VTON; permite apuntar a una instancia alternativa |
| `PORT` | Puerto del servidor; por defecto `3000` |

Reinicia `npm start` después de cambiar la configuración. El servidor escucha en `127.0.0.1`.
La estimación monetaria de Claude usa tarifas fijas en `agent/workflow.mjs`; al cambiar `CLAUDE_MODEL`,
revisa también esas tarifas. Los tokens de imagen no se convierten a dólares en la interfaz.

Los modos directos guardan tokens, orden de proveedores y otros ajustes en `localStorage` del navegador.
Esas credenciales se usan desde el cliente, a diferencia de las claves del servidor agéntico.

## Generar los HTML

Edita `src/template.html` y regenera los entregables:

```bash
npm run build
```

| Archivo | Variante |
| --- | --- |
| `index.html` | Prenda incrustada y generación desde el navegador |
| `custom-garment.html` | Añade selección de prenda por URL |
| `agentic.html` | Generación mediante el servidor y grafo del workflow |

`src/build.mjs` incrusta `src/garment.jpg` y, en las variantes directas, el cliente Gradio.
No edites los HTML generados por separado. Para cambiar la prenda incluida, sustituye `src/garment.jpg`,
actualiza `EMBEDDED_GARMENT.description` en la plantilla y vuelve a ejecutar el build.

## Prendas por enlace

El campo espera una URL directa a una imagen JPG, PNG o WebP, no la página del producto.
La carga intenta, en orden:

1. Descargar la imagen directamente si el origen permite CORS.
2. Usar el proxy público `images.weserv.nl`.
3. Si el navegador puede mostrarla, pasar la URL para descargarla al generar.

Las dos primeras rutas normalizan la imagen a 768×1024 con fondo blanco. La tercera no la normaliza.
Si fallan, el probador vuelve a la prenda de ejemplo. El enlace y la descripción se recuerdan en `localStorage`.

## Probar la interfaz

El E2E usa Node.js, Chrome y el protocolo DevTools, sin dependencias adicionales.
La ruta de Chrome está definida en `src/e2e.mjs` para macOS.

### Subida sin generar

```bash
node src/e2e.mjs index.html docs/images/person-before.png --upload --skip-generate
```

Comprueba la subida local y el estado listo para generar, sin activar la cámara ni ejecutar modelos.
La página puede consultar la disponibilidad de los proveedores. Las capturas y la foto normalizada se guardan
por defecto en `e2e-out/`, ignorado por Git. `OUT=/ruta` cambia la salida y `WIN=1280,720` el tamaño de la ventana.

### Cámara virtual

```bash
cp e2e-out/captured.jpg /tmp/tryon-camera.mjpeg
node src/e2e.mjs index.html /tmp/tryon-camera.mjpeg --skip-generate
```

Chrome recibe la imagen como cámara virtual. La prueba activa explícitamente el botón de cámara y captura el encuadre.
`--deny-camera` recorre el error de permisos y termina con código distinto de cero.

### Workflow real

Con el servidor y sus credenciales configurados:

```bash
node src/e2e.mjs http://localhost:3000 docs/images/person-before.png --upload
```

También puedes ejecutar el workflow por CLI:

```bash
node agent/run.mjs persona.jpg prenda.jpg
```

Estos comandos llaman a los modelos y consumen sus cuotas o saldo. `IDM_MOCK=a.png,b.png npm start` sustituye
únicamente el generador por archivos locales: Claude sigue analizando y evaluando mediante su API.

### Evidencia de la revisión de interfaz

La revisión del 19-oct-2026 comprobó en Chrome:

- Subida, normalización, archivos inválidos y corruptos, carga de prenda por URL y restauración del ejemplo.
- Petición de generación, eventos, descarga, rechazo, resultado no aprobado, error, cancelación y reintento.
- Grafo por teclado, ajustes, movimiento reducido y ausencia de errores JavaScript no capturados.
- Anchos de 320, 390, 768, 1024, 1366 y 1600 px sin desbordamiento horizontal de la página.
- Subida desde `file://` y captura con cámara virtual en el E2E del repositorio.

Las respuestas del workflow de esa revisión fueron simuladas. No revalida la calidad de los modelos ni sus costos.
Safari y dispositivos físicos quedan pendientes.

## Diagnóstico

| Síntoma | Qué revisar |
| --- | --- |
| El servidor no tiene clave de Anthropic | Completa `.env` y reinicia el servidor |
| Cuota de IDM-VTON agotada o cola larga | Espera, usa otra instancia compatible o configura otro proveedor |
| La cámara está denegada u ocupada | Revisa permisos y aplicaciones que la usan; también puedes subir una foto |
| El enlace de la prenda falla | Comprueba que sea una URL de imagen directa y accesible |
| El resultado no aprueba | Revisa los criterios visibles y el encuadre; ajusta la prenda o la foto |
| La generación falla | Consulta **Ajustes y actividad**, el grafo y el registro del servidor |

## Capturas de documentación

Las vistas de [escritorio](images/visualizer-preview.png) y [móvil](images/visualizer-mobile.png) muestran
la interfaz real con una persona ficticia y un cambio de prenda generados previamente. El ejemplo está identificado
como ilustrativo; no es evidencia de una ejecución ni de una evaluación del workflow.
La vista móvil se capturó en un navegador con viewport de 390×876, desplazado hasta el resultado y sus acciones.

Los [prompts y la procedencia de los recursos](images/generation-prompts.txt) están junto a las imágenes.
Para tomar estas capturas se desactivaron la cámara, las consultas de proveedores y la carga del grafo
únicamente en el renderizador de documentación; el código de la aplicación no cambia por las capturas.
