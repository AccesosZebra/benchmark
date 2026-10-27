# Arquitectura · Zebra Benchmarking

Plataforma de **inteligencia competitiva**: a partir de una descripción de negocio (y PDFs
opcionales), genera un reporte de benchmarking con competidores reales, precios, posicionamiento,
huecos de mercado y estrategia — investigando en internet en vivo.

Este documento describe el **framework** que hace posible ese reporte.

---

## Cómo funciona, paso a paso (en lenguaje natural)

Imagina que quieres saber contra quién compites y cómo diferenciarte. Esto es lo que pasa,
contado como si te lo explicara una persona:

1. **Describes tu negocio.** Escribes de qué se trata (producto, zona, precios, qué te hace
   distinto) y, si quieres, subes PDFs con más detalle.

2. **La herramienta revisa qué tan claro es lo que escribiste.** Antes de gastar en la
   investigación pesada, lee tu texto y te da una **calificación de 0 a 100**. Si le falta
   información importante (por ejemplo, no dijiste la zona o el precio), te hace **unas cuantas
   preguntas concretas** para afinar. Puedes responderlas o saltártelas.

3. **Busca en internet quiénes son tus competidores reales.** Usando búsqueda web en vivo,
   identifica los negocios que de verdad compiten contigo en tu zona y rubro. No inventa: si no
   está seguro de que un competidor existe, no lo incluye.

4. **Investiga a fondo a cada competidor, uno por uno y al mismo tiempo.** Para cada uno vuelve a
   buscar en internet y recopila sus **precios, sus ventajas, su gancho de comunicación** y, muy
   importante, **las páginas de donde sacó cada dato** (las fuentes que ves en el reporte).

5. **Pone en duda lo que encontró.** Un segundo paso, más escéptico, revisa cada competidor y le
   pone una etiqueta de confianza: **"Verificado", "Probable" o "Sin confirmar"**, según qué tan
   respaldado esté con fuentes reales. Así sabes en qué apoyarte y en qué no.

6. **Arma la estrategia.** Con todo lo anterior, redacta un **diagnóstico del mercado**, define tu
   **audiencia ideal**, propone una **ruta de comunicación**, señala los **huecos de mercado** que
   nadie está cubriendo y calcula **dónde te ubicas tú** frente a la competencia (en un mapa de
   precio contra valor).

7. **Te entrega el reporte.** Ves todo en pantalla: las tarjetas de competidores con sus fuentes,
   el mapa de posicionamiento, los huecos y la estrategia. Y al final puedes **descargarlo como PDF**
   con el encabezado y el logo de Zebra, listo para presentar.

En una frase: **tú describes tu negocio, la herramienta investiga a tu competencia en internet,
verifica lo que encuentra y te devuelve una estrategia lista para usar y descargar.**

---

## 1. Stack técnico

| Capa | Tecnología |
|---|---|
| UI | **React 19** + **TypeScript**, componentes funcionales con hooks |
| Build | **Vite 6** (bundle a estático servido por nginx) |
| Estilos | **Tailwind CSS** (Play CDN) puenteado a los **tokens del Design System de Zebra** |
| IA / motor | **Claude** (Anthropic) vía `@anthropic-ai/sdk`, con la herramienta `web_search` y *structured outputs* |
| Despliegue | **Docker** multi-stage → **nginx**; inyección de la API key en runtime |

No hay backend propio: la app es **100% cliente**. Las llamadas a Claude salen directo desde el
navegador (`dangerouslyAllowBrowser`).

---

## 2. El framework de investigación (el corazón)

Todo vive en [`services/researchService.ts`](services/researchService.ts). En vez de una sola
llamada al modelo, es una **cadena agéntica de varios pasos**, cada uno especializado:

```
                        ┌─────────────────────────────────────────────┐
   input del usuario ──▶│  0 · PRE-ANÁLISIS   (preAnalyze)             │
   (texto + PDFs)       │     evalúa calidad del input, score 0-100    │
                        │     y genera preguntas para afinarlo         │
                        └───────────────────┬─────────────────────────┘
                                            │  (el usuario responde, opcional)
                                            ▼
                        ┌─────────────────────────────────────────────┐
                        │  1 · IDENTIFICAR    (identifyCompetitors)    │  🔍 búsqueda web
                        │     encuentra N competidores reales          │
                        └───────────────────┬─────────────────────────┘
                                            ▼
                        ┌─────────────────────────────────────────────┐
                        │  2 · INVESTIGAR     (researchCompetitor)     │  🔍 búsqueda web
                        │     N llamadas EN PARALELO, una por          │     (× N, Promise.allSettled)
                        │     competidor: precio, ventajas, fuentes    │
                        └───────────────────┬─────────────────────────┘
                                            ▼
                        ┌─────────────────────────────────────────────┐
                        │  3 · VERIFICAR      (verifyCompetitors)      │  🧠 sin búsqueda
                        │     verificador escéptico: confianza + nota  │     (razona sobre lo hallado)
                        └───────────────────┬─────────────────────────┘
                                            ▼
                        ┌─────────────────────────────────────────────┐
                        │  4 · SINTETIZAR     (synthesize)             │  🧠 salida estructurada
                        │     estrategia, audiencia, huecos de         │     (JSON garantizado)
                        │     mercado, posicionamiento del usuario     │
                        └───────────────────┬─────────────────────────┘
                                            ▼
                                    BenchmarkResult ──▶ UI / PDF
```

### Por qué así

- **Multi-paso > una llamada:** cada competidor se investiga a fondo por separado, con búsqueda
  enfocada. Más profundidad y menos alucinación que pedir todo de golpe.
- **Paralelo donde se puede:** el paso 2 dispara N llamadas concurrentes (`Promise.allSettled`);
  si una falla, las demás continúan.
- **Verificación independiente:** un segundo pase escéptico asigna confianza (alta/media/baja) a
  cada competidor, apoyándose en si tiene fuentes reales.
- **Salida estructurada en la síntesis:** el paso 4 usa *structured outputs* de Claude (esquema
  JSON), así el reporte final **siempre** tiene forma válida (elimina errores de parseo).

### Dos herramientas de Claude que lo sostienen

- **`web_search`** (`web_search_20260209`): búsqueda web en vivo del lado del servidor de Anthropic.
  Devuelve resultados con URLs → de ahí salen las **fuentes** que ves en cada card.
- **Structured outputs** (`output_config.format` con `json_schema`): fuerza la forma del JSON.

---

## 3. Procedencia de los datos (en qué confiar)

El output mezcla **tres orígenes**, y el diseño los distingue:

| Origen | Qué produce | Confiabilidad |
|---|---|---|
| **Tu input** (texto + PDFs) | El ancla de todo el análisis | Tú lo defines |
| **Búsqueda web en vivo** | Competidores, precios, ubicaciones, **fuentes** | Verificable (abre la fuente) |
| **Razonamiento del modelo** | Scores de posicionamiento, huecos, audiencia, estrategia, badge de confianza | Interpretación, no medición |

Regla mental: **lo que tiene fuente = dato comprobable; lo que no = estimación de la IA.**

---

## 4. Mapa de archivos

```
App.tsx                      Máquina de estados: input → refine → loading → report
index.tsx                    Punto de entrada; importa los tokens del Design System

services/
  researchService.ts         EL MOTOR: preAnalyze + pipeline de 4 pasos + orquestador

components/
  PreAnalysisPanel.tsx       Score de calidad del input + preguntas para afinar
  LoadingScreen.tsx          Pantalla de carga con las 4 fases reales como checklist
  BenchmarkReport.tsx        Reporte completo + encabezado/pie de marca para PDF
  PositioningMap.tsx         Mapa SVG precio vs valor (theme-aware)
  FileUploader.tsx           Carga de PDFs de referencia
  ThemeToggle.tsx            Interruptor día/noche

styles/tokens.css            Tokens del Design System de Zebra + reglas @media print
types.ts                     Contratos: BenchmarkResult, Competitor, PreAnalysis, etc.

design-system/               Kit del Design System de Zebra (reglas ZR-##, memoria, flujos)
Dockerfile, nginx.conf,      Despliegue + inyección de la API key en runtime
  docker-entrypoint.sh
```

---

## 5. Flujo de la UI (máquina de estados en `App.tsx`)

```
input ──(Continuar)──▶ [preAnalyze] ──▶ refine ──(Lanzar)──▶ [analyzeBenchmark] ──▶ loading ──▶ report
  ▲                                        │                                                       │
  └──────────────(Editar input)───────────┘                                (Nuevo Análisis / logo)─┘
```

- **input:** contexto + PDFs.
- **refine:** score + preguntas opcionales; las respuestas se fusionan al contexto.
- **loading:** `LoadingScreen` muestra la fase real (leyendo `onProgress` del motor).
- **report:** `BenchmarkReport`, con botón **Descargar PDF** (`window.print()` + reglas de impresión).

---

## 6. Design System y presentación

- **Tokens únicos:** `styles/tokens.css` define colores, radios y sombras como variables CSS,
  puenteadas a Tailwind (`bg-surface`, `text-text`, `rounded-card`, etc.) para que todo sea
  **theme-aware** vía `[data-ds-theme="dark"]`.
- **Día/noche:** `ThemeToggle` persiste en `localStorage` y respeta la preferencia del sistema.
- **PDF:** las reglas `@media print` fuerzan el tema claro, ocultan el chrome (`.no-print`), evitan
  cortes dentro de las cards y muestran encabezado/pie de marca (logo Zebra + fecha).

---

## 7. Configuración

La app se sirve desde un servidor Node (`server/index.mjs`) con Postgres. Las preferencias de
investigación llegan por **variable de entorno** o **`localStorage`**:

| Clave | Dónde | Defecto | Para qué |
|---|---|---|---|
| `ANTHROPIC_MODEL` | env o `localStorage` | `claude-sonnet-5` | Modelo. `claude-opus-4-8` = máxima calidad, más caro |
| `ANTHROPIC_MAX_COMPETITORS` | `localStorage` | `4` | Cuántos competidores investigar a fondo (2-8). Menos = más barato |

### Claves de Claude

Las claves **no llegan al navegador**. El SDK apunta a `/api/anthropic` y el servidor reenvía la
llamada a Anthropic con la clave que corresponde al usuario de la sesión (la asignada al invitado o
la predeterminada). Las claves se administran desde el panel **Admin** y se guardan cifradas en
Postgres. Detalle en [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 8. Costo (y cómo controlarlo)

Cada corrida son ~**N + 3** llamadas a Claude (1 identificar + N investigar + 1 verificar + 1
sintetizar), más 1 de pre-análisis. Las llamadas con **búsqueda web** son las caras.

Palancas de ahorro ya aplicadas por defecto:

- Modelo **Sonnet 5** (≈ mitad de precio que Opus, calidad cercana).
- **4** competidores en vez de 6.
- **Verificación sin búsqueda** (razona sobre lo ya recopilado).
- Tope de búsquedas por llamada.

Para abaratar más: baja `ANTHROPIC_MAX_COMPETITORS`; para más calidad: `ANTHROPIC_MODEL=claude-opus-4-8`.

---

## 9. Contratos de datos (`types.ts`)

- **`BenchmarkResult`** — el reporte: `summary`, `analysis`, `competitors[]`, `userDifferentiator`,
  `suggestions[]`, `communicationStrategy`, `targetAudience`, `marketGaps[]`, `positioning[]`, `sources[]`.
- **`Competitor`** — `name`, `url`, `location`, `pricing`, `advantages[]`, `differentiator`,
  `priceScore`, `valueScore`, `confidence`, `verificationNote`, `sources[]`.
- **`PreAnalysis`** — `score`, `verdict`, `missing[]`, `questions[]`.
- **`ProgressFn`** — callback para reportar el avance de cada etapa a la UI.

La UI depende solo de estos tipos; el motor puede cambiar por dentro sin tocar los componentes.
