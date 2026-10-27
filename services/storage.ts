// Almacenamiento global de benchmarks en el servidor (Postgres vía /api/benchmarks).
// Los usuarios internos ven todos; los invitados solo los suyos (lo aplica el servidor).
import { BenchmarkResult, CostBreakdown } from '../types';
import { request } from './api';
import { getSession } from './auth';

export interface StoredBenchmark {
  id: string;
  title: string;
  createdAt: string; // ISO
  context: string;   // input usado (para referencia / re-lanzar)
  result: BenchmarkResult;
  owner?: string;    // correo del usuario dueño
}

// Fila del listado: sin el reporte completo (se pide al abrir/descargar).
export interface BenchmarkSummary {
  id: string;
  title: string;
  createdAt: string;
  owner: string;
  competitors: number;
  cost: CostBreakdown | null;
}

export const listBenchmarks = (): Promise<BenchmarkSummary[]> => request('/api/benchmarks');

export const getBenchmark = (id: string): Promise<StoredBenchmark> =>
  request(`/api/benchmarks/${encodeURIComponent(id)}`);

export const saveBenchmark = (context: string, result: BenchmarkResult): Promise<StoredBenchmark> =>
  request('/api/benchmarks', { method: 'POST', body: JSON.stringify({ context, result }) });

export const deleteBenchmark = (id: string): Promise<{ ok: boolean }> =>
  request(`/api/benchmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const updateBenchmark = (id: string, result: BenchmarkResult): Promise<{ ok: boolean }> =>
  request(`/api/benchmarks/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ result }) });

// ---- Migración única desde localStorage (historial previo al backend) ----
// Sube los benchmarks guardados en este navegador para el usuario actual (y la
// clave vieja sin sufijo). Se respetan los ids, así que repetirla no duplica.
// No borra lo local: queda como respaldo y se marca como migrado.
const LEGACY_KEY = 'ZEBRA_BENCHMARKS';

export const migrateLocalBenchmarks = async (): Promise<number> => {
  const email = getSession()?.email?.toLowerCase();
  if (!email) return 0;
  const doneKey = `ZEBRA_BENCHMARKS_MIGRATED::${email}`;
  try {
    if (localStorage.getItem(doneKey)) return 0;
    const items: StoredBenchmark[] = [];
    for (const key of [`${LEGACY_KEY}::${email}`, LEGACY_KEY]) {
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) items.push(...list);
    }
    for (const b of items) {
      if (!b?.id || !b.result) continue;
      await request('/api/benchmarks', {
        method: 'POST',
        body: JSON.stringify({ id: b.id, title: b.title, createdAt: b.createdAt, context: b.context, result: b.result }),
      });
    }
    localStorage.setItem(doneKey, new Date().toISOString());
    return items.length;
  } catch {
    return 0; // se reintenta en la próxima carga
  }
};
