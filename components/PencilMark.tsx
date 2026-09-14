// The PropPencil mark: a checkmark whose long arm sharpens to a pencil
// point — "the deal pencils" and the instrument in one glyph. Pure
// geometry, no assets. Never a house, a roof, a dollar sign, or a literal
// pencil illustration.

function Glyph({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-label="PropPencil"
    >
      <path
        d="M9 26 L19 36 L33.5 19.5"
        stroke={stroke}
        strokeWidth={6.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M31 16 L41 11.5 L37 22 Z" fill="#f4c542" />
    </svg>
  );
}

/** Yellow glyph inside the graphite app square. */
export function AppMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[7px] bg-ink"
      style={{ width: size, height: size }}
    >
      <Glyph size={Math.round(size * 0.63)} stroke="#f4c542" />
    </span>
  );
}

/** Inverted for dark grounds: graphite glyph inside the yellow square. */
export function AppMarkInverted({ size = 32 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[7px] bg-pencil"
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.63)}
        height={Math.round(size * 0.63)}
        viewBox="0 0 48 48"
        fill="none"
        aria-label="PropPencil"
      >
        <path
          d="M9 26 L19 36 L33.5 19.5"
          stroke="#171717"
          strokeWidth={6.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M31 16 L41 11.5 L37 22 Z" fill="#171717" />
      </svg>
    </span>
  );
}

/** Graphite-stroke variant for light grounds (beside section headings). */
export function MarkOnLight({ size = 14 }: { size?: number }) {
  return <Glyph size={size} stroke="#171717" />;
}

/** App mark + wordmark + the yellow pencil line. */
export function Lockup({ hero = false }: { hero?: boolean }) {
  return (
    <div className="flex items-center gap-[10px]">
      <AppMark size={hero ? 40 : 30} />
      <div className="flex flex-col gap-[2px]">
        <span
          className="font-extrabold leading-none tracking-[-.032em]"
          style={{ fontSize: hero ? 26 : 18 }}
        >
          PropPencil
        </span>
        <span
          className="block rounded-[2px] bg-pencil"
          style={{ width: hero ? 132 : 66, height: hero ? 5 : 3 }}
        />
      </div>
    </div>
  );
}
