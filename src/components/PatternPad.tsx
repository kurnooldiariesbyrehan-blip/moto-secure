import React, { useCallback, useRef, useState } from 'react';

interface PatternPadProps {
  onComplete: (pattern: string) => void;
  error?: boolean;
  disabled?: boolean;
  accentColor?: string;
}

const DOT_COORDS: { id: number; x: number; y: number }[] = [
  { id: 1, x: 48, y: 48 },
  { id: 2, x: 136, y: 48 },
  { id: 3, x: 224, y: 48 },
  { id: 4, x: 48, y: 136 },
  { id: 5, x: 136, y: 136 },
  { id: 6, x: 224, y: 136 },
  { id: 7, x: 48, y: 224 },
  { id: 8, x: 136, y: 224 },
  { id: 9, x: 224, y: 224 },
];

export const PatternPad: React.FC<PatternPadProps> = ({
  onComplete,
  error = false,
  disabled = false,
  accentColor = '#1B6BFF',
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);

  const getSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scaleX = 272 / rect.width;
    const scaleY = 272 / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const hitTestDot = useCallback((x: number, y: number): number | null => {
    for (const dot of DOT_COORDS) {
      if (Math.hypot(dot.x - x, dot.y - y) <= 28) {
        return dot.id;
      }
    }
    return null;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getSvgCoords(e.clientX, e.clientY);
    if (!pos) return;
    setDrawing(true);
    setPointerPos(pos);
    const hit = hitTestDot(pos.x, pos.y);
    setSelected(hit ? [hit] : []);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || disabled) return;
    const pos = getSvgCoords(e.clientX, e.clientY);
    if (!pos) return;
    setPointerPos(pos);
    const hit = hitTestDot(pos.x, pos.y);
    if (hit) {
      setSelected((prev) => (prev.includes(hit) ? prev : [...prev, hit]));
    }
  };

  const finishPattern = () => {
    if (!drawing) return;
    setDrawing(false);
    setPointerPos(null);
    if (selected.length >= 4) {
      onComplete(selected.join('-'));
    }
    setTimeout(() => setSelected([]), 180);
  };

  const strokeColor = error ? '#E11D48' : accentColor;

  const polylinePoints = selected
    .map((id) => {
      const d = DOT_COORDS.find((pt) => pt.id === id)!;
      return `${d.x},${d.y}`;
    })
    .join(' ');

  const lastDot = selected.length > 0 ? DOT_COORDS.find((pt) => pt.id === selected[selected.length - 1]) : null;

  return (
    <div className={`flex flex-col items-center select-none ${error ? 'animate-shake' : ''}`}>
      <svg
        ref={svgRef}
        viewBox="0 0 272 272"
        className="w-[260px] h-[260px] touch-none cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPattern}
        onPointerCancel={finishPattern}
        role="application"
        aria-label="3 by 3 unlock pattern grid"
      >
        {selected.length > 1 && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke={strokeColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.72"
          />
        )}
        {drawing && lastDot && pointerPos && (
          <line
            x1={lastDot.x}
            y1={lastDot.y}
            x2={pointerPos.x}
            y2={pointerPos.y}
            stroke={strokeColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeOpacity="0.45"
          />
        )}
        {DOT_COORDS.map((dot) => {
          const isActive = selected.includes(dot.id);
          return (
            <g key={dot.id}>
              <circle
                cx={dot.x}
                cy={dot.y}
                r={isActive ? 22 : 18}
                fill={isActive ? `${strokeColor}22` : 'transparent'}
                stroke={isActive ? strokeColor : 'transparent'}
                strokeWidth="1.5"
              />
              <circle
                cx={dot.x}
                cy={dot.y}
                r={isActive ? 8 : 6}
                fill={isActive ? strokeColor : '#94A3B8'}
              />
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-[#5C6575] dark:text-slate-400 mt-1">
        Connect at least 4 dots
      </p>
    </div>
  );
};
