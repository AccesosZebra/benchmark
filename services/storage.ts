// Almacenamiento de benchmarks en el navegador (localStorage). Sin backend.
// Cada usuario ve SOLO sus propios benchmarks: la clave se separa por correo.
import { BenchmarkResult } from '../types';
import { getSession } from './auth';

export interface StoredBenchmark {
  id: string;
  title: string;
  createdAt: string; // ISO
  context: string;   // input usado (para referencia / re-lanzar)
  result: BenchmarkResult;
  owner?: string;    // correo del usuario dueño (se rellena al listar "todos")
}

const BASE_KEY = 'ZEBRA_BENCHMARKS';
const MAX = 60; // tope para no reventar la cuota de localStorage

// Clave separada por usuario autenticado (correo). Sin sesión => 'anon'.
const userKey = (): string => {
  const email = getSession()?.email || 'anon';
  return `${BASE_KEY}::${email.toLowerCase()}`;
};

// Migración única: el historial viejo (antes del acceso por usuario) vivía en la
// clave sin sufijo `ZEBRA_BENCHMARKS`. Lo adoptamos al usuario actual para que no
// se vea como "borrado", y luego quitamos la clave vieja.
const migrateLegacy = (): void => {
  try {
    const legacy = localStorage.getItem(BASE_KEY);
    if (!legacy || legacy[0] !== '[') return; // nada o formato inesperado
    const key = userKey();
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, legacy); // el usuario actual aún no tiene nada → adopta el viejo
    }
    localStorage.removeItem(BASE_KEY); // una sola vez
  } catch {
    /* noop */
  }
};

export const listBenchmarks = (): StoredBenchmark[] => {
  try {
    migrateLegacy();
    const raw = localStorage.getItem(userKey());
    const list = raw ? (JSON.parse(raw) as StoredBenchmark[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const deriveTitle = (context: string): string => {
  const firstLine = (context || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '';
  const clean = firstLine.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Benchmark sin título';
  return clean.length > 70 ? clean.slice(0, 70) + '…' : clean;
};

// ---- Lectura/escritura por clave arbitraria (para operar entre usuarios) ----
const allKeys = (): string[] => {
  try {
    return Object.keys(localStorage).filter((k) => k === BASE_KEY || k.startsWith(`${BASE_KEY}::`));
  } catch {
    return [];
  }
};

const ownerOf = (key: string): string => (key === BASE_KEY ? 'anterior' : key.slice(`${BASE_KEY}::`.length));

const readKey = (key: string): StoredBenchmark[] => {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as StoredBenchmark[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const persistTo = (key: string, list: StoredBenchmark[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Cuota excedida: conserva solo la mitad más reciente y reintenta.
    try {
      localStorage.setItem(key, JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2)))));
    } catch {
      /* sin remedio: se pierde el guardado */
    }
  }
};

const persist = (list: StoredBenchmark[]): void => persistTo(userKey(), list);

// Todos los benchmarks de TODOS los usuarios de este navegador (para vista interna).
export const listAllBenchmarks = (): StoredBenchmark[] => {
  migrateLegacy();
  const out: StoredBenchmark[] = [];
  for (const key of allKeys()) {
    const owner = ownerOf(key);
    for (const b of readKey(key)) out.push({ ...b, owner });
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
};

export const saveBenchmark = (context: string, result: BenchmarkResult): StoredBenchmark => {
  const record: StoredBenchmark = {
    id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: deriveTitle(context),
    createdAt: result.generatedAt || new Date().toISOString(),
    context,
    result,
  };
  const list = [record, ...listBenchmarks()].slice(0, MAX);
  persist(list);
  return record;
};

// Borra/actualiza buscando el id en cualquier usuario (para que la vista interna
// pueda operar sobre benchmarks de invitados).
export const deleteBenchmark = (id: string): void => {
  for (const key of allKeys()) {
    const list = readKey(key);
    if (list.some((b) => b.id === id)) persistTo(key, list.filter((b) => b.id !== id));
  }
};

export const updateBenchmark = (id: string, result: BenchmarkResult): void => {
  for (const key of allKeys()) {
    const list = readKey(key);
    const idx = list.findIndex((b) => b.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], result };
      persistTo(key, list);
    }
  }
};

// Suma de costo de todos los benchmarks guardados (USD).
export const totalSpent = (): number =>
  listBenchmarks().reduce((sum, b) => sum + (b.result?.cost?.usd || 0), 0);
