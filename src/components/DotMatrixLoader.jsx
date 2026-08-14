const COORDS = [6, 17, 28, 39, 50];

function delayFor(column, row) {
  const xDistance = column - 2;
  const yDistance = row - 2;
  const ring = Math.max(Math.abs(xDistance), Math.abs(yDistance));
  const spiral = ((column + row * 2) % 5) * 90;

  if (ring === 0) return 0;
  if (ring === 1) return 280 + spiral * 0.55;
  return 620 + spiral * 0.85 + (column + row) * 40;
}

export default function DotMatrixLoader({ size = 20, className = "" }) {
  const litDots = [];

  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      litDots.push({
        key: `${column}-${row}`,
        x: COORDS[column],
        y: COORDS[row],
        delay: delayFor(column, row),
        ring: Math.max(Math.abs(column - 2), Math.abs(row - 2))
      });
    }
  }

  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 56 56"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <circle id="jd-dot-base" r="2.4" fill="currentColor" opacity="0.1" />
        <circle id="jd-dot-lit" r="3.1" fill="currentColor" />
      </defs>
      <style>{`
        .jd-dot-lit {
          opacity: 0;
          animation: jd-dot-flash 1700ms cubic-bezier(0.65, 0, 0.35, 1) infinite both;
        }
        .jd-dot-lit.jd-dot-ring-0 { animation-name: jd-dot-flash-core; }
        .jd-dot-lit.jd-dot-ring-1 { animation-name: jd-dot-flash-mid; }
        .jd-dot-lit.jd-dot-ring-2 { animation-name: jd-dot-flash-outer; }
        @keyframes jd-dot-flash-core {
          0%, 22%, 100% { opacity: 0.08; }
          34% { opacity: 1; }
          52% { opacity: 0.12; }
        }
        @keyframes jd-dot-flash-mid {
          0%, 18%, 100% { opacity: 0.06; }
          32% { opacity: 0.92; }
          50% { opacity: 0.1; }
        }
        @keyframes jd-dot-flash-outer {
          0%, 14%, 100% { opacity: 0.05; }
          30% { opacity: 0.78; }
          48% { opacity: 0.08; }
        }
        @media (prefers-reduced-motion: reduce) {
          .jd-dot-lit { animation: none; opacity: 0.4; }
        }
      `}</style>

      {COORDS.map((y) =>
        COORDS.map((x) => (
          <use key={`base-${x}-${y}`} href="#jd-dot-base" x={x} y={y} />
        ))
      )}

      {litDots.map((dot) => (
        <use
          key={dot.key}
          className={`jd-dot-lit jd-dot-ring-${dot.ring}`}
          href="#jd-dot-lit"
          x={dot.x}
          y={dot.y}
          style={{ animationDelay: `${Math.round(dot.delay)}ms` }}
        />
      ))}
    </svg>
  );
}
