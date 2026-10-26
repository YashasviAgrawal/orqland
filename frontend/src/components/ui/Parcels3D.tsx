/** Isometric stack of cardboard parcels with a floating location pin — decorative 3D art for hero cards. */

const K = 0.866; // cos 30°

function Box({ x, y, s, h, id }: { x: number; y: number; s: number; h: number; id: string }) {
  const top = `${x},${y - s / 2} ${x + K * s},${y} ${x},${y + s / 2} ${x - K * s},${y}`;
  const left = `${x - K * s},${y} ${x},${y + s / 2} ${x},${y + s / 2 + h} ${x - K * s},${y + h}`;
  const right = `${x},${y + s / 2} ${x + K * s},${y} ${x + K * s},${y + h} ${x},${y + s / 2 + h}`;
  const ax = x - (K * s) / 2;
  const ay = y - s / 4;
  const bx = x + (K * s) / 2;
  const by = y + s / 4;
  return (
    <g>
      <ellipse cx={x} cy={y + s / 2 + h + 2} rx={K * s * 1.05} ry={s * 0.28} fill="url(#p3d-shadow)" />
      <polygon points={left} fill={`url(#${id}-l)`} />
      <polygon points={right} fill={`url(#${id}-r)`} />
      <polygon points={top} fill={`url(#${id}-t)`} />
      <polyline points={`${ax},${ay} ${bx},${by} ${bx},${by + h}`} fill="none" stroke="#fff4dc" strokeOpacity={0.75} strokeWidth={s * 0.16} strokeLinejoin="round" />
      <polyline points={`${x - K * s},${y} ${x},${y + s / 2} ${x + K * s},${y}`} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={1.2} />
    </g>
  );
}

function Grads({ id }: { id: string }) {
  return (
    <>
      <linearGradient id={`${id}-t`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffe3b0" />
        <stop offset="1" stopColor="#f6b552" />
      </linearGradient>
      <linearGradient id={`${id}-l`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f0a440" />
        <stop offset="1" stopColor="#d4842a" />
      </linearGradient>
      <linearGradient id={`${id}-r`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c97820" />
        <stop offset="1" stopColor="#9c5810" />
      </linearGradient>
    </>
  );
}

export function Parcels3D({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 190" aria-hidden focusable="false">
      <defs>
        <Grads id="a" />
        <Grads id="b" />
        <Grads id="c" />
        <radialGradient id="p3d-shadow">
          <stop offset="0" stopColor="#000" stopOpacity={0.35} />
          <stop offset="1" stopColor="#000" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="p3d-pin" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.25" stopColor="#7ef0c4" />
          <stop offset="1" stopColor="#0f8a5f" />
        </radialGradient>
      </defs>
      <Box id="a" x={128} y={62} s={50} h={56} />
      <Box id="b" x={66} y={118} s={28} h={30} />
      <Box id="c" x={176} y={128} s={22} h={24} />
      <g className="p3d-float">
        <ellipse cx={196} cy={78} rx={10} ry={3} fill="#000" opacity={0.18} />
        <path d="M196 70c-9-10-14-17-14-24a14 14 0 1 1 28 0c0 7-5 14-14 24z" fill="url(#p3d-pin)" />
        <circle cx={196} cy={46} r={5} fill="#fff" opacity={0.9} />
      </g>
    </svg>
  );
}
