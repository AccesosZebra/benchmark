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

const persist = (list: StoredBenchmark[]): void => {
  const key = userKey();
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

export const deleteBenchmark = (id: string): void => {
  persist(listBenchmarks().filter((b) => b.id !== id));
};

// Reemplaza el resultado de un benchmark guardado (ej. al agregar competidores).
export const updateBenchmark = (id: string, result: BenchmarkResult): void => {
  const list = listBenchmarks();
  const idx = list.findIndex((b) => b.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], result };
  persist(list);
};

// Suma de costo de todos los benchmarks guardados (USD).
export const totalSpent = (): number =>
  listBenchmarks().reduce((sum, b) => sum + (b.result?.cost?.usd || 0), 0);
