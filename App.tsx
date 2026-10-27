
import React, { useState, useEffect } from 'react';
import { FileData, BenchmarkResult, PreAnalysis } from './types';
import FileUploader from './components/FileUploader';
import BenchmarkReport from './components/BenchmarkReport';
import ThemeToggle from './components/ThemeToggle';
import LoadingScreen from './components/LoadingScreen';
import PreAnalysisPanel from './components/PreAnalysisPanel';
import HistoryPanel from './components/HistoryPanel';
import AdminPanel from './components/AdminPanel';
import { analyzeBenchmark, preAnalyze, addMoreCompetitors } from './services/researchService';
import { saveBenchmark, updateBenchmark, migrateLocalBenchmarks } from './services/storage';
import { getSession } from './services/auth';
import { reportGuestSpend, reportGuestAddonSpend } from './services/reporting';

const LOADING_STEPS = [
  "Consultando fuentes globales...",
  "Mapeando competidores del área...",
  "Extrayendo precios y modelos de negocio...",
  "Contrastando fuentes reales...",
  "Modelando la audiencia ideal...",
  "Diseñando la estrategia de comunicación...",
  "Finalizando el reporte de inteligencia...",
];

type Stage = 'input' | 'refine' | 'loading' | 'report' | 'history' | 'admin';

const App: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [files, setFiles] = useState<FileData[]>([]);
  const [stage, setStage] = useState<Stage>('input');
  const [prechecking, setPrechecking] = useState(false);
  const [preAnalysis, setPreAnalysis] = useState<PreAnalysis | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loadingStep, setLoadingStep] = useState(0);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BenchmarkResult | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentContext, setCurrentContext] = useState('');

  // Sube una sola vez el historial que este navegador guardaba en localStorage.
  useEffect(() => {
    migrateLocalBenchmarks();
  }, []);

  useEffect(() => {
    let interval: any;
    if (stage === 'loading') {
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 3500);
    } else {
      setLoadingStep(0);
    }
    return () => clearInterval(interval);
  }, [stage]);

  const buildContext = (): string => {
    let ctx = inputText.trim();
    if (preAnalysis) {
      const answered = preAnalysis.questions
        .filter((q) => (answers[q.id] || '').trim())
        .map((q) => `- ${q.question} ${answers[q.id].trim()}`);
      if (answered.length) ctx += `\n\nDetalles adicionales aportados:\n${answered.join('\n')}`;
    }
    return ctx;
  };

  const handleContinue = async () => {
    if (!inputText && files.length === 0) {
      setError('Por favor, introduce detalles del negocio o sube un documento PDF.');
      return;
    }
    setError(null);
    setPrechecking(true);
    try {
      const pa = await preAnalyze(inputText, files);
      setPreAnalysis(pa);
      setAnswers({});
      setStage('refine');
    } catch (err: any) {
      setError(err.message || 'No pudimos evaluar el input. Inténtalo de nuevo.');
    } finally {
      setPrechecking(false);
    }
  };

  const handleLaunch = async () => {
    setStage('loading');
    setError(null);
    setReport(null);
    setLiveStatus(null);
    try {
      const ctx = buildContext();
      const result = await analyzeBenchmark(ctx, files, setLiveStatus);
      setReport(result);
      setCurrentContext(ctx);
      setStage('report');
      try {
        const rec = await saveBenchmark(ctx, result);
        setCurrentId(rec.id);
        // Reporta el gasto al webhook solo si el usuario es invitado.
        const s = getSession();
        if (s?.provider === 'guest') reportGuestSpend(s, rec);
      } catch (err: any) {
        setError(`El reporte se generó pero no se pudo guardar en el historial: ${err.message || 'error del servidor'}. Descárgalo para no perderlo.`);
      }
    } catch (err: any) {
      setError(err.message || 'Error al investigar el mercado.');
      setStage(preAnalysis ? 'refine' : 'input');
    } finally {
      setLiveStatus(null);
    }
  };

  const handleReset = () => {
    setInputText('');
    setFiles([]);
    setReport(null);
    setError(null);
    setPreAnalysis(null);
    setAnswers({});
    setCurrentId(null);
    setCurrentContext('');
    setStage('input');
  };

  // Agrega competidores al reporte actual sin rehacer lo ya presentado.
  const handleAddCompetitors = async (opts: { names: string[]; count: number }) => {
    if (!report) return;
    const { report: updated, addedCost } = await addMoreCompetitors(
      report,
      { names: opts.names, count: opts.count, context: currentContext || inputText, files },
      undefined
    );
    setReport(updated);
    if (currentId) {
      try { await updateBenchmark(currentId, updated); } catch { /* el reporte sigue en pantalla */ }
    }
    const s = getSession();
    if (s?.provider === 'guest') {
      const title = (currentContext || inputText).split('\n')[0].slice(0, 70) || 'Benchmark';
      reportGuestAddonSpend(s, title, currentId || 'addon', addedCost);
    }
  };

  return (
    <div className="min-h-screen bg-bg pb-20 selection:bg-accent selection:text-bg">
      <header className="no-print sticky top-0 z-50 bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] backdrop-blur-xl border-b border-line">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={handleReset} className="flex items-center space-x-3">
            {/* Logo oficial: se invierte a blanco en dark, nunca se distorsiona (ZR-11, ZR-12) */}
            <img src="/assets/logo-zebra.svg" alt="Zebra" className="h-5 w-auto self-start dark-invert" />
            <div className="pl-3 border-l border-line text-left">
              <h1 className="text-lg font-semibold text-text leading-tight tracking-tight">Benchmarking</h1>
              <p className="text-[10px] text-muted font-medium uppercase tracking-[0.2em] font-mono">Intelligence Platform</p>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {getSession()?.provider !== 'guest' && (
              <button
                onClick={() => setStage('admin')}
                className="px-4 py-2 text-[10px] font-medium text-muted hover:text-text hover:bg-surface-2 rounded-btn transition-all border border-transparent uppercase tracking-widest font-mono"
              >
                Admin
              </button>
            )}
            <button
              onClick={() => setStage('history')}
              className="px-4 py-2 text-[10px] font-medium text-muted hover:text-text hover:bg-surface-2 rounded-btn transition-all border border-transparent uppercase tracking-widest font-mono"
            >
              Historial
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-[10px] font-medium text-muted hover:text-text hover:bg-surface-2 rounded-btn transition-all border border-transparent uppercase tracking-widest font-mono"
            >
              Nuevo Análisis
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-12">
        {stage === 'admin' ? (
          <AdminPanel onClose={() => setStage(report ? 'report' : 'input')} />
        ) : stage === 'history' ? (
          <HistoryPanel
            onOpen={(rec) => {
              setError(null);
              setReport(rec.result);
              setCurrentId(rec.id);
              setCurrentContext(rec.context || '');
              setStage('report');
            }}
            onClose={() => setStage(report ? 'report' : 'input')}
          />
        ) : stage === 'report' && report ? (
          <div className="space-y-6">
            {error && (
              <div className="p-4 bg-surface-2 border border-line text-text rounded-card text-xs font-medium text-center font-mono">
                {error}
              </div>
            )}
            <BenchmarkReport report={report} onAddCompetitors={handleAddCompetitors} />
          </div>
        ) : stage === 'loading' ? (
          <LoadingScreen status={liveStatus} fallback={LOADING_STEPS[loadingStep]} />
        ) : stage === 'refine' && preAnalysis ? (
          <div className="space-y-6">
            {error && (
              <div className="max-w-2xl mx-auto p-4 bg-surface-2 border border-line text-text rounded-card text-xs font-medium uppercase tracking-widest text-center font-mono">
                {error}
              </div>
            )}
            <PreAnalysisPanel
              preAnalysis={preAnalysis}
              answers={answers}
              setAnswers={setAnswers}
              onLaunch={handleLaunch}
              onBack={() => setStage('input')}
            />
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-10">
            <div className="relative text-center space-y-4">
              {/* Motif Stripes de marca: siempre detrás del contenido, nunca sobre cards (ZR-20) */}
              <span className="zebra-motif" aria-hidden="true"></span>
              <p className="text-[11px] text-muted font-medium uppercase tracking-[0.3em] font-mono">Engine v3.0</p>
              <h2 className="text-4xl font-semibold text-text tracking-tight leading-[1.1]">
                Inteligencia de Mercado en Tiempo Real
              </h2>
              <p className="text-muted text-base font-normal max-w-xl mx-auto leading-relaxed">
                Rastreamos precios, ubicaciones y estrategias de tu competencia para encontrar tu ventaja ganadora.
              </p>
            </div>

            <div className="bg-surface p-6 md:p-8 rounded-card shadow-lg border border-line">
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-end border-b border-line pb-2">
                    <label className="text-xs font-medium text-text uppercase tracking-[0.2em] font-mono">Contexto del Negocio</label>
                  </div>
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ej: Marca de moda sostenible en Madrid. Queremos analizar competidores locales con precios similares..."
                    className="w-full h-36 p-4 bg-surface-2 border border-line rounded-input focus:shadow-[0_0_0_1px_var(--accent)] focus:border-accent transition-all outline-none text-text font-normal placeholder:text-muted leading-relaxed text-sm"
                  />
                </div>

                <FileUploader files={files} setFiles={setFiles} />
              </div>

              {error && (
                <div className="mt-6 p-4 bg-surface-2 border border-line text-text rounded-card text-xs font-medium uppercase tracking-widest flex items-center justify-center font-mono">
                  <svg className="w-4 h-4 mr-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  {error}
                </div>
              )}

              <button
                onClick={handleContinue}
                disabled={prechecking}
                className={`mt-8 w-full py-4 rounded-btn font-semibold text-base transition-all transform active:scale-[0.99] uppercase tracking-[0.1em] ${
                  prechecking
                    ? 'bg-surface-2 text-muted cursor-not-allowed border border-line'
                    : 'bg-accent text-bg hover:-translate-y-0.5 shadow-md hover:shadow-lg'
                }`}
              >
                {prechecking ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="w-4 h-4 border-2 border-muted border-t-text rounded-full animate-spin" />
                    Evaluando tu input...
                  </span>
                ) : (
                  'Continuar'
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
