
import React from 'react';
import { PositioningPoint } from '../types';

interface PositioningMapProps {
  points: PositioningPoint[];
}

// Mapa precio (eje X) vs valor percibido (eje Y). Theme-aware: usa currentColor (--text)
// y --accent vía las clases; el punto del usuario se resalta.
const PositioningMap: React.FC<PositioningMapProps> = ({ points }) => {
  const W = 420;
  const H = 320;
  const M = 40; // margen para ejes
  const plotW = W - M * 2;
  const plotH = H - M * 2;

  const x = (price: number) => M + (price / 100) * plotW;
  const y = (value: number) => M + (1 - value / 100) * plotH; // invertido: arriba = más valor

  return (
    <section className="bg-surface p-8 rounded-card border border-line shadow-sm">
      <h3 className="text-xl font-semibold text-text mb-2">Mapa de Posicionamiento</h3>
      <p className="text-sm text-muted font-normal mb-6">Precio frente a valor percibido. Tu negocio está resaltado.</p>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl mx-auto" role="img" aria-label="Mapa de posicionamiento precio vs valor">
          {/* Marco y cuadrícula (hairline) */}
          <rect x={M} y={M} width={plotW} height={plotH} fill="none" stroke="currentColor" strokeOpacity="0.12" />
          <line x1={M + plotW / 2} y1={M} x2={M + plotW / 2} y2={M + plotH} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 3" />
          <line x1={M} y1={M + plotH / 2} x2={M + plotW} y2={M + plotH / 2} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 3" />

          {/* Etiquetas de ejes (mono) */}
          <text x={M} y={H - 14} className="font-mono" fontSize="9" letterSpacing="1.5" fill="currentColor" fillOpacity="0.55">ECONOMICO</text>
          <text x={M + plotW} y={H - 14} textAnchor="end" className="font-mono" fontSize="9" letterSpacing="1.5" fill="currentColor" fillOpacity="0.55">PREMIUM</text>
          <text x={14} y={M + 4} className="font-mono" fontSize="9" letterSpacing="1.5" fill="currentColor" fillOpacity="0.55" transform={`rotate(-90 14 ${M + 4})`} textAnchor="end">+ VALOR</text>
          <text x={14} y={M + plotH} className="font-mono" fontSize="9" letterSpacing="1.5" fill="currentColor" fillOpacity="0.55" transform={`rotate(-90 14 ${M + plotH})`}>- VALOR</text>

          {/* Puntos */}
          {points.map((p, i) => {
            const cx = x(p.priceScore);
            const cy = y(p.valueScore);
            if (p.isUser) {
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r="7" fill="var(--accent)" />
                  <circle cx={cx} cy={cy} r="11" fill="none" stroke="var(--accent)" strokeOpacity="0.4" />
                  <text x={cx} y={cy - 16} textAnchor="middle" className="font-mono" fontSize="10" fontWeight="600" fill="currentColor">{p.name}</text>
                </g>
              );
            }
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r="4" fill="currentColor" fillOpacity="0.45" />
                <text x={cx + 8} y={cy + 3} fontSize="9" fill="currentColor" fillOpacity="0.7">{p.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-4 text-[11px] text-muted font-normal leading-relaxed border-t border-line pt-3">
        <span className="font-medium text-text">¿En qué se basa?</span> Es una <span className="font-medium">estimación de la IA</span>, no
        reseñas ni un índice oficial. El eje de <span className="font-medium">precio</span> ubica cada competidor según su precio real
        hallado (p. ej. por m² o lote) frente a los comparables de la zona; el de <span className="font-medium">valor</span> según qué tan
        completa es su oferta (amenidades, acabados, ubicación, servicios). Un competidor sale "premium" si su precio y/o su oferta
        son altos frente al set, no por su reputación.
      </p>
    </section>
  );
};

export default PositioningMap;
