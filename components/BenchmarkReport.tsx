
import React, { useState } from 'react';
import { BenchmarkResult, Confidence } from '../types';
import PositioningMap from './PositioningMap';

interface BenchmarkReportProps {
  report: BenchmarkResult;
  onAddCompetitors?: (opts: { names: string[]; count: number }) => Promise<void>;
}

// Badge de confianza tras la verificación cruzada. Monocromático (ZR-05).
const ConfidenceBadge: React.FC<{ level?: Confidence; note?: string }> = ({ level, note }) => {
  if (!level) return null;
  const label = level === 'alta' ? 'Verificado' : level === 'media' ? 'Probable' : 'Sin confirmar';
  const opacity = level === 'alta' ? 'opacity-100' : level === 'media' ? 'opacity-70' : 'opacity-45';
  return (
    <span
      title={note || undefined}
      className={`inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider font-mono text-muted ${opacity}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
      {label}
    </span>
  );
};

const BenchmarkReport: React.FC<BenchmarkReportProps> = ({ report, onAddCompetitors }) => {
  const printedOn = new Date(report.generatedAt || Date.now()).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const [showAdd, setShowAdd] = useState(false);
  const [addNames, setAddNames] = useState('');
  const [addCount, setAddCount] = useState(2);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submitAdd = async () => {
    if (!onAddCompetitors || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const names = addNames.split(',').map((s) => s.trim()).filter(Boolean);
      await onAddCompetitors({ names, count: addCount });
      setShowAdd(false);
      setAddNames('');
    } catch (e: any) {
      setAddError(e?.message || 'No pudimos agregar competidores.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      {/* Encabezado de marca — solo en el PDF (oculto en pantalla) */}
      <header className="hidden print:flex items-end justify-between border-b border-line pb-4 mb-2">
        <div className="flex items-center gap-3">
          <img src="/assets/logo-zebra.svg" alt="Zebra" className="h-5 w-auto" />
          <div className="pl-3 border-l border-line">
            <p className="text-sm font-semibold text-text leading-tight">Benchmarking Competitivo</p>
            <p className="text-[9px] text-muted font-medium uppercase tracking-[0.2em] font-mono">Intelligence Platform</p>
          </div>
        </div>
        <p className="text-[9px] text-muted font-medium uppercase tracking-[0.2em] font-mono">{printedOn}</p>
      </header>

      {/* Barra de acciones (no se imprime) */}
      <div className="no-print flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-medium text-muted uppercase tracking-[0.3em] font-mono">Reporte de Inteligencia</p>
          <p className="text-[10px] text-muted font-normal font-mono mt-0.5">Investigación del {printedOn}</p>
        </div>
        <div className="flex items-center gap-2">
          {report.cost && (
            <div
              title={`Entrada: ${report.cost.inputTokens.toLocaleString('es-MX')} tok · Salida: ${report.cost.outputTokens.toLocaleString('es-MX')} tok · ${report.cost.webSearches} búsquedas · Modelo: ${report.cost.model}`}
              className="inline-flex flex-col items-end px-3 py-1.5 rounded-btn border border-line bg-surface-2"
            >
              <span className="text-[11px] font-semibold text-text font-mono leading-none">${report.cost.usd.toFixed(4)} USD</span>
              <span className="text-[8px] text-muted font-mono uppercase tracking-wider mt-0.5">
                {(report.cost.inputTokens + report.cost.outputTokens).toLocaleString('es-MX')} tok · {report.cost.webSearches} búsq.
              </span>
            </div>
          )}
          {onAddCompetitors && (
            <button
              onClick={() => { setShowAdd((v) => !v); setAddError(null); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-btn border border-line text-[10px] font-medium text-text hover:bg-surface-2 hover:border-accent transition-all uppercase tracking-widest font-mono"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Competidores
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-btn border border-line text-[10px] font-medium text-text hover:bg-surface-2 hover:border-accent transition-all uppercase tracking-widest font-mono"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
            </svg>
            Descargar PDF
          </button>
        </div>
      </div>

      {/* Agregar competidores al reporte existente (no se imprime) */}
      {showAdd && onAddCompetitors && (
        <div className="no-print bg-surface border border-line rounded-card p-4 shadow-sm">
          <p className="text-xs font-semibold text-text">Agregar competidores a este reporte</p>
          <p className="text-[11px] text-muted font-normal mt-1 mb-3">
            Se investigan y anexan sin cambiar lo ya presentado. Escribe nombres específicos (coma) o deja
            vacío para que busque automáticamente.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={addNames}
              disabled={adding}
              onChange={(e) => setAddNames(e.target.value)}
              placeholder="Ej: Grupo Cumbres, Guayacán (opcional)"
              className="flex-1 p-2.5 bg-surface-2 border border-line rounded-input focus:shadow-[0_0_0_1px_var(--accent)] focus:border-accent transition-all outline-none text-text font-normal placeholder:text-muted text-sm"
            />
            {!addNames.trim() && (
              <select
                value={addCount}
                disabled={adding}
                onChange={(e) => setAddCount(Number(e.target.value))}
                className="p-2.5 bg-surface-2 border border-line rounded-input text-text text-sm outline-none focus:border-accent"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n} más</option>
                ))}
              </select>
            )}
            <button
              onClick={submitAdd}
              disabled={adding}
              className={`px-5 py-2.5 rounded-btn text-xs font-semibold uppercase tracking-widest font-mono transition-all ${
                adding ? 'bg-surface-2 text-muted border border-line cursor-not-allowed' : 'bg-accent text-bg hover:-translate-y-0.5'
              }`}
            >
              {adding ? 'Agregando…' : 'Agregar'}
            </button>
          </div>
          {adding && (
            <p className="text-[11px] text-muted font-mono mt-2 animate-pulse">
              Investigando con búsqueda web… puede tomar un momento.
            </p>
          )}
          {addError && (
            <p className="text-[11px] text-text font-medium mt-2 bg-surface-2 border border-line rounded-control p-2">{addError}</p>
          )}
        </div>
      )}

      {/* Resumen Ejecutivo */}
      <section className="bg-surface p-6 rounded-card shadow-sm border border-line break-inside-avoid">
        <h2 className="text-lg font-semibold text-text mb-3 flex items-center">
          <span className="bg-accent text-bg p-1.5 rounded-control mr-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </span>
          Diagnóstico Estratégico
        </h2>
        <p className="text-muted text-sm leading-relaxed font-normal">{report.summary}</p>
      </section>

      {/* Grid de Competencia */}
      <section>
        <div className="flex items-center justify-between mb-4 border-b border-line pb-3">
          <h3 className="text-base font-semibold text-text flex items-center">
            <svg className="w-5 h-5 mr-2.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Competidores ({report.competitors.length})
          </h3>
          <span className="text-[9px] font-medium text-muted uppercase tracking-[0.2em] font-mono">Datos en vivo</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {report.competitors.map((comp, idx) => (
            <div key={idx} className="bg-surface rounded-card border border-line shadow-sm overflow-hidden flex flex-col hover:border-accent transition-all break-inside-avoid">
              <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <div className="space-y-1">
                    <h4 className="text-lg font-semibold text-text leading-tight">{comp.name}</h4>
                    <ConfidenceBadge level={comp.confidence} note={comp.verificationNote} />
                  </div>
                  {comp.url && (
                    <a href={comp.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${comp.name}`} className="p-2 bg-surface-2 rounded-control text-muted hover:text-text transition-all flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="inline-flex items-center px-2.5 py-1 bg-surface-2 text-muted rounded-chip text-[9px] font-medium uppercase tracking-wider border border-line font-mono">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    {comp.location}
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 bg-accent text-bg rounded-chip text-[9px] font-medium uppercase tracking-wider font-mono">
                    {comp.pricing}
                  </span>
                </div>

                <p className="text-xs text-muted font-normal mb-4 leading-relaxed border-l border-line pl-3 italic">
                  {comp.differentiator}
                </p>

                <div className="space-y-2">
                  <p className="text-[9px] font-medium text-muted uppercase tracking-[0.2em] font-mono">Atributos Clave</p>
                  <ul className="space-y-1.5">
                    {comp.advantages.map((adv, aIdx) => (
                      <li key={aIdx} className="flex items-start text-xs text-text font-normal leading-relaxed">
                        <span className="mr-2 mt-1.5 w-1 h-1 bg-accent rounded-full flex-shrink-0" />
                        {adv}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-auto bg-surface-2 px-5 py-3 border-t border-line">
                <p className="text-[9px] font-medium text-muted uppercase tracking-[0.2em] font-mono mb-1.5">
                  Fuentes ({comp.sources?.length || 0})
                </p>
                {comp.sources && comp.sources.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {comp.sources.slice(0, 3).map((s, sIdx) => (
                      <a
                        key={sIdx}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 bg-surface border border-line rounded-chip text-[9px] font-medium text-muted hover:text-text hover:border-accent transition-all truncate max-w-[130px]"
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] text-muted font-normal">Sin fuentes directas.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Mapa de posicionamiento precio vs valor */}
      {report.positioning && report.positioning.length > 1 && (
        <div className="break-inside-avoid">
          <PositioningMap points={report.positioning} />
        </div>
      )}

      {/* Huecos de mercado */}
      {report.marketGaps && report.marketGaps.length > 0 && (
        <section className="bg-surface p-6 rounded-card border border-line shadow-sm break-inside-avoid">
          <h3 className="text-base font-semibold text-text mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Huecos de Mercado
          </h3>
          <ul className="space-y-2">
            {report.marketGaps.map((gap, idx) => (
              <li key={idx} className="flex items-start text-sm text-text font-normal bg-surface-2 p-3 rounded-control border border-line">
                <span className="mr-2.5 mt-1.5 w-1 h-1 bg-accent rounded-full flex-shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Estrategia: Audiencia y Comunicación */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-surface p-6 rounded-card border border-line shadow-sm break-inside-avoid">
          <h3 className="text-base font-semibold text-text mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Perfil de Audiencia
          </h3>
          <div className="text-sm text-text leading-relaxed bg-surface-2 p-4 rounded-control border border-line font-normal">
            {report.targetAudience}
          </div>
        </section>

        <section className="bg-surface p-6 rounded-card border border-line shadow-sm break-inside-avoid">
          <h3 className="text-base font-semibold text-text mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            Ruta de Comunicación
          </h3>
          <div className="text-sm text-text leading-relaxed bg-surface-2 p-4 rounded-control border border-line font-normal">
            {report.communicationStrategy}
          </div>
        </section>
      </div>

      {/* Propuesta de Valor Única — card de énfasis: invierte light<->dark via tokens (ZR-25b) */}
      <section className="bg-accent p-8 rounded-card text-bg relative overflow-hidden break-inside-avoid">
        <div className="relative z-10">
          <div className="flex items-center mb-5">
            <div className="p-2.5 bg-[color-mix(in_srgb,var(--bg)_12%,transparent)] rounded-control mr-4 border border-[color-mix(in_srgb,var(--bg)_22%,transparent)]">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold tracking-tight uppercase">Ventaja Competitiva Final</h3>
          </div>
          <div className="bg-[color-mix(in_srgb,var(--bg)_8%,transparent)] p-6 rounded-control border border-[color-mix(in_srgb,var(--bg)_12%,transparent)]">
            <p className="text-xl font-semibold leading-relaxed tracking-tight">
              {report.userDifferentiator}
            </p>
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {report.suggestions.map((sug, idx) => (
              <div key={idx} className="flex items-start p-3 bg-[color-mix(in_srgb,var(--bg)_8%,transparent)] rounded-control text-xs font-normal border border-[color-mix(in_srgb,var(--bg)_12%,transparent)]">
                <svg className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {sug}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Análisis Estratégico Completo */}
      <section className="bg-surface p-6 rounded-card border border-line shadow-sm break-inside-avoid">
        <h3 className="text-[10px] font-medium text-muted mb-4 uppercase tracking-[0.3em] font-mono">Análisis a Fondo</h3>
        <div className="max-w-none text-sm text-text font-normal leading-relaxed whitespace-pre-line">
          {report.analysis}
        </div>
      </section>

      {/* Fuentes globales */}
      {report.sources.length > 0 && (
        <section className="pt-6 border-t border-line break-inside-avoid">
          <p className="text-[10px] font-medium text-muted uppercase tracking-[0.3em] flex items-center font-mono mb-4">
            <svg className="w-4 h-4 mr-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Fuentes Consultadas ({report.sources.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {report.sources.map((source, idx) => (
              <a key={idx} href={source.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-surface border border-line rounded-control text-[9px] font-medium text-muted hover:border-accent hover:text-text transition-all shadow-sm truncate max-w-[260px] uppercase tracking-wider font-mono">
                {source.title}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Pie de marca — solo en el PDF (ZR-13) */}
      <footer className="hidden print:flex items-center justify-between border-t border-line pt-4 mt-4">
        <img src="/assets/logo-zebra.svg" alt="Zebra" className="h-4 w-auto" />
        <p className="text-[9px] text-muted font-medium uppercase tracking-[0.2em] font-mono">
          Generado por Zebra Benchmarking · {printedOn}
        </p>
      </footer>
    </div>
  );
};

export default BenchmarkReport;
