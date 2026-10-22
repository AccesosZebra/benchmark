
import Anthropic from "@anthropic-ai/sdk";
import {
  FileData,
  BenchmarkResult,
  Competitor,
  Source,
  PositioningPoint,
  ProgressFn,
  PreAnalysis,
} from "../types";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const getApiKey = (): string => {
  // El build deja un placeholder que el docker-entrypoint sustituye en runtime.
  // Si sigue sin sustituir (sin env), lo ignoramos y caemos a localStorage.
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  const envKey = fromEnv && !fromEnv.includes("__RUNTIME") ? fromEnv : null;

  const apiKey =
    envKey ||
    (typeof window !== "undefined" ? localStorage.getItem("ANTHROPIC_API_KEY") : null);

  if (!apiKey) {
    throw userError(
      "API Key de Claude no configurada. " +
        'Configura localStorage.setItem("ANTHROPIC_API_KEY", "tu_clave") ' +
        "o define ANTHROPIC_API_KEY en el entorno. La obtienes en console.anthropic.com."
    );
  }
  return apiKey;
};

// Sonnet 5 = calidad casi-Opus a menos de la mitad del costo (por defecto, para
// controlar el gasto). Pon 'claude-opus-4-8' para máxima capacidad, o
// 'claude-haiku-4-5' NO sirve aquí (la búsqueda web no lo soporta).
const resolveModel = (): string =>
  process.env.ANTHROPIC_MODEL ||
  (typeof window !== "undefined" ? localStorage.getItem("ANTHROPIC_MODEL") : null) ||
  "claude-sonnet-5";

// Nº de competidores a investigar a fondo. Menos = más barato. Config vía
// localStorage.setItem("ANTHROPIC_MAX_COMPETITORS", "3"). Rango 2-8, defecto 5.
const maxCompetitors = (): number => {
  const raw = typeof window !== "undefined" ? localStorage.getItem("ANTHROPIC_MAX_COMPETITORS") : null;
  const n = Number(raw);
  return isFinite(n) && n >= 2 && n <= 8 ? Math.floor(n) : 5;
};

// Moneda por defecto: pesos mexicanos, salvo que la fuente indique otra.
const PRICING_HINT = `Los precios se asumen en pesos mexicanos (MXN) salvo que la fuente indique
explícitamente otra moneda; exprésalos siempre en MXN e indica la cifra cuando exista.`;

// Contexto temporal: se fija al lanzar la investigación para que el modelo
// use el año correcto y no asuma el año de su entrenamiento.
let currentDateNote = "";

// ---------------------------------------------------------------------------
// Contabilidad de tokens / costo
// ---------------------------------------------------------------------------

// Precios por millón de tokens (USD). Ajusta si cambian las tarifas de Anthropic.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
const WEB_SEARCH_USD = 0.01; // ~$10 por 1000 búsquedas web

interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}
const zeroUsage = (): RunUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
});
let runUsage: RunUsage = zeroUsage();

const addUsage = (u: any): void => {
  if (!u) return;
  runUsage.inputTokens += u.input_tokens || 0;
  runUsage.outputTokens += u.output_tokens || 0;
  runUsage.cacheReadTokens += u.cache_read_input_tokens || 0;
  runUsage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
  const ws = u.server_tool_use?.web_search_requests;
  if (ws) runUsage.webSearches += ws;
};

const computeCost = (u: RunUsage, model: string) => {
  const p = PRICING[model] || PRICING["claude-sonnet-5"];
  const usd =
    (u.inputTokens / 1e6) * p.in +
    (u.outputTokens / 1e6) * p.out +
    (u.cacheReadTokens / 1e6) * p.in * 0.1 +
    (u.cacheWriteTokens / 1e6) * p.in * 1.25 +
    u.webSearches * WEB_SEARCH_USD;
  return {
    model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    webSearches: u.webSearches,
    usd: Math.round(usd * 10000) / 10000,
  };
};

// Topes por llamada para acotar el costo. Búsqueda + fetch de sitios/redes.
const MAX_SEARCH_USES = 6;
const MAX_FETCH_USES = 3;

const SECTOR_HINT = `Prioriza FUENTES PRIMARIAS y del sector: sitios oficiales de cada
competidor, portales y directorios especializados. Si el producto es inmobiliario, apóyate
además en portales como Inmuebles24, Lamudi, Propiedades.com y Vivanuncios (precio por m2/lote,
amenidades, ritmo de absorción). Cita siempre de dónde sale cada dato.`;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const userError = (message: string): Error => {
  const e = new Error(message);
  (e as any).userFacing = true;
  return e;
};

// Extrae el JSON de un texto (puede venir con cercas markdown o prosa alrededor).
const extractJson = (raw: string): any => {
  let text = (raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  if (!text.startsWith("{") && !text.startsWith("[")) {
    const firstObj = text.indexOf("{");
    const firstArr = text.indexOf("[");
    const starts = [firstObj, firstArr].filter((i) => i !== -1);
    if (starts.length) {
      const start = Math.min(...starts);
      const closer = text[start] === "{" ? "}" : "]";
      const end = text.lastIndexOf(closer);
      if (end > start) text = text.slice(start, end + 1);
    }
  }

  try {
    return JSON.parse(text || "{}");
  } catch (parseError) {
    console.error("Claude JSON Parse Error:", parseError, raw);
    throw userError(
      "La IA respondió en un formato inesperado y no pudimos leer los resultados. " +
        "Vuelve a intentarlo; si persiste, reformula el contexto del negocio."
    );
  }
};

const classifyError = (error: any): Error => {
  if (error?.userFacing) return error;
  console.error("Claude API Error:", error);

  const status: number | undefined = error?.status ?? error?.statusCode;
  const raw: string = (error?.message || String(error ?? "")).toLowerCase();

  if (status === 401 || raw.includes("authentication") || raw.includes("invalid x-api-key") || raw.includes("api key")) {
    return userError(
      "La API Key de Claude no es válida. " +
        "Verifica que la clave sea correcta y esté activa en console.anthropic.com."
    );
  }
  if (status === 403 || raw.includes("permission")) {
    return userError("La API Key de Claude no tiene permisos para esta operación o este modelo.");
  }
  if (
    status === 413 ||
    raw.includes("request too large") ||
    raw.includes("request_too_large") ||
    raw.includes("too large") ||
    raw.includes("payload")
  ) {
    return userError(
      "Los documentos PDF son demasiado pesados para procesarlos juntos. " +
        "Sube menos archivos o versiones más ligeras (o quita presentaciones/brochures muy grandes) e inténtalo de nuevo."
    );
  }
  if (status === 404 || raw.includes("not found") || raw.includes("model")) {
    return userError(
      `El modelo "${resolveModel()}" no está disponible para tu cuenta. ` +
        "Revisa el identificador del modelo o los permisos de tu clave."
    );
  }
  if (status === 429 || raw.includes("rate limit") || raw.includes("overloaded")) {
    return userError(
      "Se superó el límite de peticiones o la cuota de Claude. " +
        "Espera unos minutos o revisa tu plan y facturación en console.anthropic.com."
    );
  }
  if (status !== undefined && status >= 500) {
    return userError("El servicio de Claude tuvo un problema temporal. Vuelve a intentarlo en unos momentos.");
  }
  if (raw.includes("failed to fetch") || raw.includes("network") || raw.includes("timeout") || raw.includes("connection")) {
    return userError(
      "No pudimos conectar con Claude. Revisa tu conexión a internet. Si adjuntaste varios PDFs " +
        "pesados, prueba con menos archivos: una petición muy grande también puede fallar así."
    );
  }
  return userError("Ocurrió un error al generar la investigación" + (error?.message ? `: ${error.message}` : ". Inténtalo de nuevo."));
};

const dedupeSources = (sources: Source[]): Source[] => {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
};

const clampScore = (n: any): number => {
  const v = Number(n);
  if (!isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
};

const textOf = (content: any[]): string =>
  content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

// Recoge las fuentes de los bloques de resultado de web_search.
const sourcesFrom = (content: any[]): Source[] => {
  const out: Source[] = [];
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r?.type === "web_search_result" && r.url) {
          out.push({ title: r.title || "Referencia de Mercado", url: r.url });
        }
      }
    }
    // Páginas abiertas con web_fetch (sitio/redes del competidor).
    if (b.type === "web_fetch_tool_result" && b.content?.url) {
      out.push({ title: b.content.title || b.content.url, url: b.content.url });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Llamadas a Claude
// ---------------------------------------------------------------------------

// Llamada con búsqueda web en vivo. Maneja el bucle de herramientas de servidor (pause_turn).
const runWithSearch = async (
  client: Anthropic,
  userContent: any
): Promise<{ text: string; sources: Source[] }> => {
  const messages: any[] = [{ role: "user", content: userContent }];
  const sources: Source[] = [];
  try {
    for (let i = 0; i < 7; i++) {
      const resp = await client.messages.create({
        model: resolveModel(),
        max_tokens: 4000,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCH_USES } as any,
          // web_fetch abre sitios/redes ya encontrados para leer precios y amenidades
          // directamente (clave para negocios locales mal indexados en buscadores).
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: MAX_FETCH_USES } as any,
        ],
        messages,
      });
      addUsage((resp as any).usage);
      sources.push(...sourcesFrom(resp.content as any[]));
      if (resp.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: resp.content });
        continue;
      }
      return { text: textOf(resp.content as any[]), sources };
    }
    return { text: textOf(messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))), sources };
  } catch (error) {
    throw classifyError(error);
  }
};

// Llamada sin búsqueda con SALIDA ESTRUCTURADA garantizada (elimina fallos de formato).
const runStructured = async (client: Anthropic, content: any, schema: any): Promise<any> => {
  try {
    const resp = await client.messages.create({
      model: resolveModel(),
      max_tokens: 6000,
      output_config: { format: { type: "json_schema", schema } } as any,
      messages: [{ role: "user", content }],
    });
    addUsage((resp as any).usage);
    return extractJson(textOf(resp.content as any[]));
  } catch (error) {
    throw classifyError(error);
  }
};

// Esquemas para reparar salidas de los pasos con búsqueda (a veces el modelo
// devuelve prosa alrededor del JSON y extractJson falla).
const IDENTIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, url: { type: "string" }, location: { type: "string" } },
        required: ["name", "url", "location"],
      },
    },
  },
  required: ["competitors"],
};

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    url: { type: "string" },
    location: { type: "string" },
    pricing: { type: "string" },
    advantages: { type: "array", items: { type: "string" } },
    differentiator: { type: "string" },
    priceScore: { type: "integer" },
    valueScore: { type: "integer" },
    selfConfidence: { type: "string" },
  },
  required: ["name", "url", "location", "pricing", "advantages", "differentiator", "priceScore", "valueScore", "selfConfidence"],
};

// Intenta parsear el texto; si no es JSON válido, lo reformatea con una llamada
// estructurada (sin búsqueda) que garantiza el esquema.
const parseOrStructure = async (client: Anthropic, rawText: string, schema: any): Promise<any> => {
  try {
    return extractJson(rawText);
  } catch {
    console.warn("Salida no era JSON puro; reparando con salida estructurada...");
    return await runStructured(
      client,
      `Extrae la información del siguiente texto y devuélvela EXACTAMENTE conforme al esquema JSON. ` +
        `No inventes: si un campo no aparece, usa "" para texto, [] para listas y 50 para puntajes.\n\nTEXTO:\n${rawText}`,
      schema
    );
  }
};

// Presupuesto de PDFs para no exceder el límite de la API (~32MB por petición).
// ~18M chars base64 ≈ ~13MB reales; deja margen para prompts y respuesta.
const BASE64_BUDGET = 18_000_000;

const budgetedDocBlocks = (files: FileData[]): { blocks: any[]; skipped: number } => {
  const blocks: any[] = [];
  let used = 0;
  let skipped = 0;
  for (const file of files) {
    const data = file.base64.split(",")[1] || "";
    if (used + data.length > BASE64_BUDGET) {
      skipped++;
      continue;
    }
    used += data.length;
    blocks.push({ type: "document", source: { type: "base64", media_type: file.type, data } });
  }
  return { blocks, skipped };
};

// ---------------------------------------------------------------------------
// Pre-análisis: evalúa la calidad del input y genera preguntas para afinarlo.
// ---------------------------------------------------------------------------

const PREANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer" },
    verdict: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          hint: { type: "string" },
        },
        required: ["id", "question", "hint"],
      },
    },
  },
  required: ["score", "verdict", "missing", "questions"],
};

export const preAnalyze = async (text: string, files: FileData[]): Promise<PreAnalysis> => {
  // Inicia la contabilidad de la corrida; el costo del pre-análisis cuenta.
  runUsage = zeroUsage();
  const client = new Anthropic({ apiKey: getApiKey(), dangerouslyAllowBrowser: true });

  const prompt = `Evalúa la CALIDAD del siguiente input para una investigación de benchmarking
competitivo. Un buen input define con claridad: (1) el producto o servicio, (2) la zona o mercado
geográfico, (3) el rango de precio o modelo de negocio, y (4) qué diferencia al negocio.

Da un score de 0 a 100 y un veredicto de una frase. Lista brevemente lo que falta. Genera entre 0 y
5 preguntas CONCRETAS y accionables, SOLO sobre lo que falta o está vago, para mejorar el análisis.
Si el input ya es sólido, usa score alto y pocas o cero preguntas. Cada pregunta lleva un id corto y
un hint con un ejemplo de respuesta. TODO EN ESPAÑOL.

CONTEXTO DEL NEGOCIO:
${text || "(sin texto)"}${
    files.length
      ? `\n\nDocumentos adjuntos (${files.length}, se leerán en la investigación): ${files
          .map((f) => f.name)
          .join(", ")}. Asume que aportan detalle; no penalices por lo que puedan contener.`
      : ""
  }`;

  // El pre-análisis NO envía los PDFs (petición ligera y rápida); solo el texto.
  const data = await runStructured(client, prompt, PREANALYSIS_SCHEMA);

  const questions = Array.isArray(data?.questions) ? data.questions : [];
  return {
    score: clampScore(data?.score),
    verdict: String(data?.verdict || ""),
    missing: Array.isArray(data?.missing) ? data.missing.map(String) : [],
    questions: questions.slice(0, 5).map((q: any, i: number) => ({
      id: String(q?.id || `q${i}`),
      question: String(q?.question || ""),
      hint: String(q?.hint || ""),
    })),
  };
};

// ---------------------------------------------------------------------------
// Etapas de la investigación
// ---------------------------------------------------------------------------

const identifyCompetitors = async (
  client: Anthropic,
  text: string,
  docBlocks: any[]
): Promise<Array<{ name: string; url: string; location: string }>> => {
  const n = maxCompetitors();
  const prompt = `Eres un analista de Inteligencia Competitiva. Usando búsqueda web, identifica los
${n} competidores o referentes MÁS relevantes para el siguiente negocio. Incluye tanto competidores
DIRECTOS como MEDIANAMENTE DIRECTOS: variantes ligeras del mismo producto, sustitutos cercanos y
alternativas del mismo mercado o segmento. Prefiere incluir de más que de menos; basta con que sean
plausibles y encontrables. Solo descarta lo que sea claramente inventado. ${currentDateNote} ${SECTOR_HINT} ${PRICING_HINT}

CONTEXTO DEL NEGOCIO:
${text}

Responde SOLO con JSON puro (sin texto adicional):
{"competitors":[{"name":"Nombre real","url":"URL oficial o ''","location":"Ciudad/Zona"}]}`;

  const { text: out } = await runWithSearch(client, [...docBlocks, { type: "text", text: prompt }]);
  const data = await parseOrStructure(client, out, IDENTIFY_SCHEMA);
  const list = Array.isArray(data?.competitors) ? data.competitors : [];
  return list
    .filter((c: any) => c?.name)
    .slice(0, n)
    .map((c: any) => ({ name: String(c.name), url: String(c.url || ""), location: String(c.location || "") }));
};

const researchCompetitor = async (
  client: Anthropic,
  context: string,
  base: { name: string; url: string; location: string }
): Promise<Competitor> => {
  const prompt = `Investiga A FONDO al competidor "${base.name}" (${base.location}) usando búsqueda web.
Es competidor (directo o medianamente directo) del negocio descrito abajo. ${currentDateNote} ${SECTOR_HINT} ${PRICING_HINT}

ESTRATEGIA DE BÚSQUEDA (la info de negocios locales suele estar mal indexada, insiste):
- Prueba varias consultas: "${base.name} precios", "${base.name} ${base.location}", "${base.name} lotes m2",
  "${base.name} Instagram", "${base.name} Facebook", "${base.name} Google Maps".
- Si encuentras su SITIO WEB o REDES (incluido ${base.url || "su URL oficial"}), ÁBRELOS con web_fetch para
  leer precios, amenidades y mensajes DIRECTAMENTE; no te quedes solo con los fragmentos del buscador.
- Si tras buscar y abrir sitios aún falta un dato, NO devuelvas todo vacío: pon lo que sí encontraste y
  ESTIMA un rango plausible con base en proyectos comparables de la zona, marcándolo como "Estimado: ...".
  Baja selfConfidence a "baja" cuando estimes.

CONTEXTO DEL NEGOCIO:
${context}

Responde SOLO con JSON puro:
{"name":"${base.name}","url":"URL confirmada o '${base.url}'","location":"Ubicación exacta",
"pricing":"Precios en MXN o modelo, con cifras (o 'Estimado: ...' si dedujiste)","advantages":["Ventaja 1","Ventaja 2","Ventaja 3"],
"differentiator":"Su gancho principal",
"priceScore":"0-100 según el PRECIO real hallado: 0 = el más económico del segmento, 100 = el más caro/premium (ej. precio por m2/lote vs. comparables de la zona)",
"valueScore":"0-100 según la OFERTA: 0 = básica, 100 = la más completa (amenidades, acabados, ubicación, servicios, plusvalía). Basa el puntaje en lo que ofrece, NO en reputación ni reviews.",
"selfConfidence":"alta|media|baja"}`;

  try {
    const { text: out, sources } = await runWithSearch(client, [{ type: "text", text: prompt }]);
    const data = await parseOrStructure(client, out, RESEARCH_SCHEMA);
    return {
      name: String(data?.name || base.name),
      url: String(data?.url || base.url || ""),
      location: String(data?.location || base.location || ""),
      pricing: String(data?.pricing || "No disponible"),
      advantages: Array.isArray(data?.advantages) ? data.advantages.map(String) : [],
      differentiator: String(data?.differentiator || ""),
      priceScore: clampScore(data?.priceScore),
      valueScore: clampScore(data?.valueScore),
      confidence: ["alta", "media", "baja"].includes(data?.selfConfidence) ? data.selfConfidence : "media",
      sources: dedupeSources(sources),
    };
  } catch (e) {
    // No descartamos al competidor: lo dejamos con sus datos base y confianza baja.
    console.warn(`No se pudo profundizar en "${base.name}":`, e);
    return {
      name: base.name,
      url: base.url || "",
      location: base.location || "",
      pricing: "No disponible",
      advantages: [],
      differentiator: "",
      priceScore: 50,
      valueScore: 50,
      confidence: "baja",
      verificationNote: "No se pudo profundizar en esta fuente.",
      sources: [],
    };
  }
};

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          confidence: { type: "string" },
          note: { type: "string" },
        },
        required: ["name", "confidence", "note"],
      },
    },
  },
  required: ["verifications"],
};

const verifyCompetitors = async (
  client: Anthropic,
  context: string,
  competitors: Competitor[]
): Promise<Competitor[]> => {
  const summary = competitors
    .map((c, i) => `${i + 1}. ${c.name} — ${c.location} — ${c.pricing} — ${c.url || "sin URL"}`)
    .join("\n");
  const withSources = competitors
    .map((c, i) => `${i + 1}. ${c.name} — fuentes: ${(c.sources || []).map((s) => s.url).join(", ") || "ninguna"}`)
    .join("\n");
  const prompt = `Actúa como verificador ESCÉPTICO. Revisa cada competidor de la lista y evalúa, con
base en la coherencia de sus datos (precio, ubicación, oferta) y en si tiene fuentes que lo
respalden, qué tan confiable es. Sé estricto: si no tiene fuentes o los datos son vagos o
sospechosos, baja la confianza. No busques en internet; razona sobre lo ya recopilado.

NEGOCIO: ${context}

DATOS:
${summary}

RESPALDO POR FUENTES:
${withSources}

Devuelve, para cada competidor, name (exacto de la lista), confidence (alta|media|baja) y note (1 frase).`;

  const data = await runStructured(client, prompt, VERIFY_SCHEMA);
  const verifications: any[] = Array.isArray(data?.verifications) ? data.verifications : [];
  const byName = new Map(verifications.map((v) => [String(v?.name || "").toLowerCase(), v]));

  return competitors.map((c) => {
    const v = byName.get(c.name.toLowerCase());
    if (!v) return c;
    return {
      ...c,
      confidence: ["alta", "media", "baja"].includes(v.confidence) ? v.confidence : c.confidence,
      verificationNote: v.note ? String(v.note) : undefined,
    };
  });
};

const SYNTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    analysis: { type: "string" },
    targetAudience: { type: "string" },
    communicationStrategy: { type: "string" },
    userDifferentiator: { type: "string" },
    suggestions: { type: "array", items: { type: "string" } },
    marketGaps: { type: "array", items: { type: "string" } },
    userPosition: {
      type: "object",
      additionalProperties: false,
      properties: { priceScore: { type: "integer" }, valueScore: { type: "integer" } },
      required: ["priceScore", "valueScore"],
    },
  },
  required: [
    "summary",
    "analysis",
    "targetAudience",
    "communicationStrategy",
    "userDifferentiator",
    "suggestions",
    "marketGaps",
    "userPosition",
  ],
};

const synthesize = async (
  client: Anthropic,
  text: string,
  competitors: Competitor[]
): Promise<any> => {
  const dossier = competitors
    .map((c) => `- ${c.name} (${c.location}) · precio:${c.priceScore}/100 valor:${c.valueScore}/100 · ${c.pricing} · dif: ${c.differentiator}`)
    .join("\n");

  const prompt = `Eres Director de Estrategia. Con base en el dossier de competidores ya investigado,
redacta la estrategia para el negocio. TODO EN ESPAÑOL. No inventes nuevos competidores.
${currentDateNote} ${PRICING_HINT}

NEGOCIO:
${text}

DOSSIER DE COMPETIDORES (ya verificado):
${dossier}

Devuelve summary, analysis, targetAudience, communicationStrategy, userDifferentiator,
suggestions (3), marketGaps (2+) y userPosition {priceScore 0-100, valueScore 0-100}.`;

  const data = await runStructured(client, prompt, SYNTH_SCHEMA);
  return {
    summary: String(data?.summary || "Investigación completada."),
    analysis: String(data?.analysis || ""),
    targetAudience: String(data?.targetAudience || "No definida."),
    communicationStrategy: String(data?.communicationStrategy || "No definida."),
    userDifferentiator: String(data?.userDifferentiator || "Estrategia generada."),
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions.map(String) : [],
    marketGaps: Array.isArray(data?.marketGaps) ? data.marketGaps.map(String) : [],
    userPosition: {
      priceScore: clampScore(data?.userPosition?.priceScore),
      valueScore: clampScore(data?.userPosition?.valueScore),
    },
  };
};

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

export const analyzeBenchmark = async (
  text: string,
  files: FileData[],
  onProgress?: ProgressFn
): Promise<BenchmarkResult> => {
  const client = new Anthropic({ apiKey: getApiKey(), dangerouslyAllowBrowser: true });
  const report = (msg: string) => onProgress?.(msg);

  // Fecha fijada al momento de lanzar la investigación (para prompts y sello).
  const now = new Date();
  const generatedAt = now.toISOString();
  currentDateNote = `Contexto temporal: hoy es ${now.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })} y estamos en el año ${now.getFullYear()}. Usa ${now.getFullYear()} como referencia temporal (precios, disponibilidad, "actualmente"); NO asumas años anteriores.`;

  const { blocks: docBlocks, skipped } = budgetedDocBlocks(files);
  if (skipped > 0) {
    report(`Nota: ${skipped} PDF(s) se omitieron por tamaño para no exceder el límite.`);
  }

  // Paso 1 · Identificar
  report("Identificando competidores reales del mercado...");
  const seeds = await identifyCompetitors(client, text, docBlocks);
  if (seeds.length === 0) {
    throw userError(
      "No encontramos competidores claros para este negocio. " +
        "Añade más detalle del producto y la zona, e inténtalo de nuevo."
    );
  }

  // Paso 2 · Investigar a fondo (en paralelo)
  report(`Investigando a fondo ${seeds.length} competidores en paralelo...`);
  const researched = await Promise.allSettled(seeds.map((s) => researchCompetitor(client, text, s)));
  let competitors: Competitor[] = researched
    .filter((r): r is PromiseFulfilledResult<Competitor> => r.status === "fulfilled")
    .map((r) => r.value);

  if (competitors.length === 0) {
    const firstRejected = researched.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw firstRejected ? classifyError(firstRejected.reason) : userError("No pudimos investigar a los competidores. Inténtalo de nuevo.");
  }

  // Paso 3 · Verificar
  report("Verificando datos y contrastando fuentes...");
  try {
    competitors = await verifyCompetitors(client, text, competitors);
  } catch (e) {
    console.warn("Verificación omitida:", e);
  }

  // Paso 4 · Sintetizar (salida estructurada)
  report("Sintetizando estrategia y mapa de posicionamiento...");
  const synth = await synthesize(client, text, competitors);

  const positioning: PositioningPoint[] = [
    ...competitors.map((c) => ({ name: c.name, priceScore: c.priceScore ?? 50, valueScore: c.valueScore ?? 50 })),
    { name: "Tu negocio", priceScore: synth.userPosition.priceScore, valueScore: synth.userPosition.valueScore, isUser: true },
  ];

  const allSources = dedupeSources(competitors.flatMap((c) => c.sources || []));

  return {
    summary: synth.summary,
    analysis: synth.analysis,
    competitors,
    userDifferentiator: synth.userDifferentiator,
    suggestions: synth.suggestions,
    communicationStrategy: synth.communicationStrategy,
    targetAudience: synth.targetAudience,
    marketGaps: synth.marketGaps,
    positioning,
    sources: allSources,
    generatedAt,
    cost: computeCost(runUsage, resolveModel()),
  };
};

// ---------------------------------------------------------------------------
// Agregar competidores a un reporte EXISTENTE (sin rehacer lo ya presentado).
// Solo investiga y anexa los nuevos; conserva resumen, estrategia y puntos ya mostrados.
// ---------------------------------------------------------------------------

const setDateNote = (): string => {
  const now = new Date();
  currentDateNote = `Contexto temporal: hoy es ${now.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })} y estamos en el año ${now.getFullYear()}. Usa ${now.getFullYear()} como referencia temporal; NO asumas años anteriores.`;
  return now.toISOString();
};

// Identifica N competidores ADICIONALES distintos a los ya existentes.
const identifyMore = async (
  client: Anthropic,
  context: string,
  existingNames: string[],
  n: number,
  docBlocks: any[]
): Promise<Array<{ name: string; url: string; location: string }>> => {
  const prompt = `Ya identificamos estos competidores: ${existingNames.join(", ") || "(ninguno)"}.
Identifica ${n} competidores ADICIONALES y DISTINTOS a los anteriores para el siguiente negocio
(directos o medianamente directos: variantes, sustitutos cercanos, alternativas del mismo mercado).
EXCLUYE estrictamente los ya listados. ${currentDateNote} ${SECTOR_HINT} ${PRICING_HINT}

CONTEXTO DEL NEGOCIO:
${context}

Responde SOLO con JSON puro:
{"competitors":[{"name":"Nombre real","url":"URL oficial o ''","location":"Ciudad/Zona"}]}`;

  const { text: out } = await runWithSearch(client, [...docBlocks, { type: "text", text: prompt }]);
  const data = await parseOrStructure(client, out, IDENTIFY_SCHEMA);
  const list = Array.isArray(data?.competitors) ? data.competitors : [];
  const existing = new Set(existingNames.map((s) => s.toLowerCase()));
  return list
    .filter((c: any) => c?.name && !existing.has(String(c.name).toLowerCase()))
    .slice(0, n)
    .map((c: any) => ({ name: String(c.name), url: String(c.url || ""), location: String(c.location || "") }));
};

const addCosts = (a: any, b: any) => ({
  model: b.model,
  inputTokens: (a?.inputTokens || 0) + b.inputTokens,
  outputTokens: (a?.outputTokens || 0) + b.outputTokens,
  cacheReadTokens: (a?.cacheReadTokens || 0) + b.cacheReadTokens,
  cacheWriteTokens: (a?.cacheWriteTokens || 0) + b.cacheWriteTokens,
  webSearches: (a?.webSearches || 0) + b.webSearches,
  usd: Math.round(((a?.usd || 0) + b.usd) * 10000) / 10000,
});

export const addMoreCompetitors = async (
  report: BenchmarkResult,
  opts: { names?: string[]; count?: number; context: string; files: FileData[] },
  onProgress?: ProgressFn
): Promise<{ report: BenchmarkResult; addedCost: ReturnType<typeof computeCost> }> => {
  runUsage = zeroUsage();
  const client = new Anthropic({ apiKey: getApiKey(), dangerouslyAllowBrowser: true });
  const emit = (m: string) => onProgress?.(m);
  setDateNote();

  const existingNames = report.competitors.map((c) => c.name);
  const existingLower = new Set(existingNames.map((s) => s.toLowerCase()));

  // Semillas: nombres indicados por el usuario, o descubrir N adicionales.
  let seeds: Array<{ name: string; url: string; location: string }>;
  const wanted = (opts.names || []).map((s) => s.trim()).filter(Boolean);
  if (wanted.length) {
    seeds = wanted
      .filter((n) => !existingLower.has(n.toLowerCase()))
      .map((n) => ({ name: n, url: "", location: "" }));
  } else {
    emit("Buscando competidores adicionales...");
    const { blocks } = budgetedDocBlocks(opts.files || []);
    seeds = await identifyMore(client, opts.context, existingNames, Math.max(1, opts.count || 2), blocks);
  }

  if (seeds.length === 0) {
    throw userError(
      "No encontramos competidores nuevos distintos a los actuales. " +
        "Prueba indicando nombres específicos."
    );
  }

  emit(`Investigando ${seeds.length} competidor(es) nuevo(s)...`);
  const researched = await Promise.allSettled(seeds.map((s) => researchCompetitor(client, opts.context, s)));
  let fresh: Competitor[] = researched
    .filter((r): r is PromiseFulfilledResult<Competitor> => r.status === "fulfilled")
    .map((r) => r.value);

  if (fresh.length === 0) {
    const firstRejected = researched.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw firstRejected ? classifyError(firstRejected.reason) : userError("No pudimos investigar a los nuevos competidores.");
  }

  emit("Verificando...");
  try {
    fresh = await verifyCompetitors(client, opts.context, fresh);
  } catch (e) {
    console.warn("Verificación de nuevos omitida:", e);
  }

  // Anexa sin tocar lo ya presentado (resumen, estrategia, huecos, puntos previos).
  const competitors = [...report.competitors, ...fresh];
  const newPoints: PositioningPoint[] = fresh.map((c) => ({
    name: c.name,
    priceScore: c.priceScore ?? 50,
    valueScore: c.valueScore ?? 50,
  }));
  const positioning = [...report.positioning, ...newPoints];
  const sources = dedupeSources([...report.sources, ...fresh.flatMap((c) => c.sources || [])]);

  const addedCost = computeCost(runUsage, resolveModel());
  const cost = addCosts(report.cost, addedCost);

  return { report: { ...report, competitors, positioning, sources, cost }, addedCost };
};
