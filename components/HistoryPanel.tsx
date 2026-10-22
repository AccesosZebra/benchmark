
import React, { useState } from 'react';
import { StoredBenchmark, listBenchmarks, listAllBenchmarks, deleteBenchmark } from '../services/storage';
import { downloadBenchmarkHtml, downloadBenchmarkJson } from '../services/exportBenchmark';
import { getSession } from '../services/auth';

interface HistoryPanelProps {
  onOpen: (record: StoredBenchmark) => void;
  onClose: () => void;
}

const fmtUsd = (n: number) => `$${(n || 0).toFixed(4)}`;
const fmtNum = (n: number) => (n || 0).toLocaleString('es-MX');
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

const HistoryPanel: React.FC<HistoryPanelProps> = ({ onOpen, onClose }) => {
  // Los invitados ven solo lo suyo; los usuarios internos (Zebra) ven todo.
  const isGuest = getSession()?.provider === 'guest';
  const load = () => (isGuest ? listBenchmarks() : listAllBenchmarks());
  const [items, setItems] = useState<StoredBenchmark[]>(load);
  const total = items.reduce((s, b) => s + (b.result?.cost?.usd || 0), 0);

  const handleDelete = (id: string) => {
    deleteBenchmark(id);
    setItems(load());
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text">Historial de benchmarks</h2>
          <p className="text-xs text-muted font-normal mt-1">
            {items.length} guardados{!isGuest ? ' (todos los usuarios)' : ''} · costo acumulado{' '}
            <span className="text-text font-medium font-mono">{fmtUsd(total)}</span> USD
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-btn border border-line text-[10px] font-medium text-muted hover:text-text hover:bg-surface-2 transition-all uppercase tracking-widest font-mono"
        >
          Cerrar
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-surface rounded-card border border-line shadow-sm p-10 text-center">
          <p className="text-sm text-muted font-normal">Aún no hay benchmarks guardados. Lanza una investigación y aparecerá aquí.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((b) => (
            <li key={b.id} className="bg-surface rounded-card border border-line shadow-sm p-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text truncate">{b.title}</p>
                <p className="text-[10px] text-muted font-mono uppercase tracking-wider mt-1">
                  {fmtDate(b.createdAt)} · {b.result?.competitors?.length || 0} competidores
                  {!isGuest && b.owner && b.owner !== 'anon' ? ` · ${b.owner}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-text font-mono">{fmtUsd(b.result?.cost?.usd || 0)}</p>
                <p className="text-[9px] text-muted font-mono">
                  {fmtNum((b.result?.cost?.inputTokens || 0) + (b.result?.cost?.outputTokens || 0))} tok
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onOpen(b)}
                  className="px-3 py-1.5 rounded-btn bg-accent text-bg text-[10px] font-medium uppercase tracking-widest font-mono hover:-translate-y-0.5 transition-all"
                >
                  Abrir
                </button>
                <button
                  onClick={() => downloadBenchmarkHtml(b)}
                  title="Descargar reporte HTML (imprimible a PDF)"
                  className="px-2.5 py-1.5 rounded-btn border border-line text-[10px] font-medium text-muted hover:text-text hover:border-accent transition-all uppercase tracking-wider font-mono"
                >
                  HTML
                </button>
                <button
                  onClick={() => downloadBenchmarkJson(b)}
                  title="Descargar datos en JSON"
                  className="px-2.5 py-1.5 rounded-btn border border-line text-[10px] font-medium text-muted hover:text-text hover:border-accent transition-all uppercase tracking-wider font-mono"
                >
                  JSON
                </button>
                <button
                  onClick={() => handleDelete(b.id)}
                  aria-label="Eliminar"
                  className="p-1.5 rounded-btn text-muted hover:text-text hover:bg-surface-2 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default HistoryPanel;
