// Isometric brick drawing for the live model. Units are studs on the ground
// plane (x to the lower right, y to the lower left) and pixels for height.
import type { CSSProperties } from "react";
import type { BrickColor } from "../book";
import type { SlopeDir } from "../designs";

export const STUD = 13;
const COS = STUD * 0.8660254;
const SIN = STUD * 0.5;
export const BRICK_HEIGHT = STUD * 0.92;
export const PLATE_HEIGHT = STUD * 0.34;
/** One plate (a third of a brick) in px. */
export const PLATE_PX = BRICK_HEIGHT / 3;
const STUD_RX = STUD * 0.36;
const STUD_RY = STUD_RX * 0.5774;
const STUD_HEIGHT = STUD * 0.2;

export const BRICK_HEX: Record<BrickColor, string> = {
  red: "#D01012",
  blue: "#0A5BBF",
  yellow: "#F5C518",
  green: "#00852B",
  orange: "#F57D20",
  azure: "#36AEBF",
  lime: "#A5CA18",
  purple: "#6C3FA8",
  pink: "#E86FA7",
  tan: "#DCC48E",
  teal: "#00A29C",
  magenta: "#B40F6E",
};

export function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const raw = (value >> shift) & 0xff;
    const next = factor >= 1 ? raw + (255 - raw) * (factor - 1) : raw * factor;
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

export function iso(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS, (x + y) * SIN - z];
}

const point = (x: number, y: number, z: number) => iso(x, y, z).map((n) => n.toFixed(2)).join(",");

export interface Box {
  x: number;
  y: number;
  /** Base height in px. */
  z: number;
  w: number;
  d: number;
  /** Height in px. */
  h: number;
}

export type BrickVariant = "solid" | "ghost" | "next" | "faded";

type Vec = [number, number, number];
interface Face {
  points: Vec[];
  /** Brightness factor from the face's orientation. */
  light: number;
}

/** Visible faces of a roof slope: a wedge falling towards `dir` with a small lip. */
function slopeFaces(box: Box, dir: SlopeDir): Face[] {
  const { x, y, z, w, d, h } = box;
  const lip = h * 0.22;
  const height = (cx: 0 | 1, cy: 0 | 1) => {
    if (dir === "+x") return cx === 0 ? h : lip;
    if (dir === "-x") return cx === 1 ? h : lip;
    if (dir === "+y") return cy === 0 ? h : lip;
    return cy === 1 ? h : lip;
  };
  const top = (cx: 0 | 1, cy: 0 | 1): Vec => [x + cx * w, y + cy * d, z + height(cx, cy)];
  const bottom = (cx: 0 | 1, cy: 0 | 1): Vec => [x + cx * w, y + cy * d, z];
  // Normal of the sloped top, with heights in stud units so it matches the view axis.
  const a = top(0, 0);
  const u: Vec = [w, 0, (top(1, 0)[2] - a[2]) / STUD];
  const v: Vec = [0, d, (top(0, 1)[2] - a[2]) / STUD];
  const n: Vec = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  const nx = n[0] / length;
  const ny = n[1] / length;
  const nz = n[2] / length;
  const faces: Face[] = [
    { points: [bottom(1, 0), bottom(1, 1), top(1, 1), top(1, 0)], light: 0.84 },
    { points: [bottom(0, 1), bottom(1, 1), top(1, 1), top(0, 1)], light: 0.68 },
  ];
  // The sloped face is seen whenever it points at all towards the viewer.
  if (nx + ny + nz > 0) {
    faces.push({ points: [top(0, 0), top(1, 0), top(1, 1), top(0, 1)], light: 0.68 + 0.42 * nz + 0.16 * nx - 0.04 * ny });
  }
  return faces;
}

const facePoints = (face: Face) => face.points.map(([px, py, pz]) => point(px, py, pz)).join(" ");

export function Brick({
  box,
  color,
  variant,
  studs = true,
  slope,
  studMask,
  lite = false,
  className,
  style,
  title,
}: {
  box: Box;
  color: string;
  variant: BrickVariant;
  studs?: boolean;
  /** One shape per stud instead of three: for scenes with many models. */
  lite?: boolean;
  /** Draw a roof slope falling towards this side instead of a box. */
  slope?: SlopeDir;
  /** Return false for top cells hidden under another brick. */
  studMask?: (i: number, j: number) => boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  // The next brick hovers over its empty spot, ready to snap down.
  if (variant === "next") {
    return (
      <g className={className} style={style}>
        {title === undefined ? null : <title>{title}</title>}
        <Brick box={box} color={color} variant="ghost" slope={slope} />
        <g className="lego-hover">
          <Brick box={box} color={color} variant="solid" studs={studs} slope={slope} />
        </g>
      </g>
    );
  }
  if (slope !== undefined) {
    const faces = slopeFaces(box, slope);
    if (variant === "ghost") {
      return (
        <g className={className} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.8} strokeDasharray="2.5 2.5" strokeLinejoin="round">
          {title === undefined ? null : <title>{title}</title>}
          {faces.map((face, index) => (
            <polygon key={index} points={facePoints(face)} />
          ))}
        </g>
      );
    }
    const edge = shade(color, 0.42);
    return (
      <g className={className} style={style} opacity={variant === "faded" ? 0.32 : undefined} strokeLinejoin="round">
        {title === undefined ? null : <title>{title}</title>}
        {faces.map((face, index) => (
          <polygon key={index} points={facePoints(face)} fill={shade(color, face.light)} stroke={edge} strokeWidth={0.6} />
        ))}
      </g>
    );
  }
  const { x, y, z, w, d, h } = box;
  const zt = z + h;
  const top = [point(x, y, zt), point(x + w, y, zt), point(x + w, y + d, zt), point(x, y + d, zt)].join(" ");
  const right = [point(x + w, y, zt), point(x + w, y + d, zt), point(x + w, y + d, z), point(x + w, y, z)].join(" ");
  const left = [point(x, y + d, zt), point(x + w, y + d, zt), point(x + w, y + d, z), point(x, y + d, z)].join(" ");

  if (variant === "ghost") {
    return (
      <g className={className} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.8} strokeDasharray="2.5 2.5" strokeLinejoin="round">
        {title === undefined ? null : <title>{title}</title>}
        <polygon points={top} />
        <polygon points={right} />
        <polygon points={left} />
      </g>
    );
  }

  const edge = shade(color, 0.42);
  const studCells: Array<[number, number]> = [];
  if (studs) {
    for (let i = 0; i < w; i += 1) for (let j = 0; j < d; j += 1) if (!studMask || studMask(i, j)) studCells.push([i, j]);
    studCells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  }
  return (
    <g className={className} style={style} opacity={variant === "faded" ? 0.32 : undefined} strokeLinejoin="round">
      {title === undefined ? null : <title>{title}</title>}
      <polygon points={left} fill={shade(color, 0.68)} stroke={edge} strokeWidth={0.6} />
      <polygon points={right} fill={shade(color, 0.84)} stroke={edge} strokeWidth={0.6} />
      <polygon points={top} fill={shade(color, 1.1)} stroke={edge} strokeWidth={0.6} />
      {studCells.map(([i, j]) => {
        const [cx, cy] = iso(x + i + 0.5, y + j + 0.5, zt);
        if (lite) {
          return <ellipse key={`${i}-${j}`} cx={cx} cy={cy - STUD_HEIGHT * 0.6} rx={STUD_RX} ry={STUD_RY} fill={shade(color, 1.2)} stroke={edge} strokeWidth={0.45} />;
        }
        return (
          <g key={`${i}-${j}`}>
            <ellipse cx={cx} cy={cy} rx={STUD_RX} ry={STUD_RY} fill={shade(color, 0.74)} />
            <rect x={cx - STUD_RX} y={cy - STUD_HEIGHT} width={STUD_RX * 2} height={STUD_HEIGHT} fill={shade(color, 0.78)} />
            <ellipse cx={cx} cy={cy - STUD_HEIGHT} rx={STUD_RX} ry={STUD_RY} fill={shade(color, 1.22)} stroke={edge} strokeWidth={0.45} />
          </g>
        );
      })}
    </g>
  );
}

export function viewBoxFor(boxes: Box[], pad = 6, extraTop = 0): { viewBox: string; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    for (const [px, py, pz] of [
      [box.x, box.y, box.z],
      [box.x + box.w, box.y, box.z],
      [box.x, box.y + box.d, box.z],
      [box.x + box.w, box.y + box.d, box.z],
      [box.x, box.y, box.z + box.h + STUD_HEIGHT + STUD_RY],
      [box.x + box.w, box.y, box.z + box.h + STUD_HEIGHT + STUD_RY],
      [box.x, box.y + box.d, box.z + box.h + STUD_HEIGHT + STUD_RY],
    ] as const) {
      const [sx, sy] = iso(px, py, pz);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
  }
  minY -= extraTop;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  return {
    viewBox: `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`,
    width,
    height,
  };
}

/** A sealed, numbered parts bag, as printed in instruction books. */
export function BagGlyph({ number, color, size = 28 }: { number: number | string; color: string; size?: number }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 28 32" aria-hidden="true" className="lego-bag-glyph">
      <path d="M4 6 Q4 3 7 3 H21 Q24 3 24 6 L25.5 27 Q25.6 30 22.5 30 H5.5 Q2.4 30 2.5 27 Z" fill="var(--lego-bag-fill)" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.2} />
      <path d="M4.2 8 H23.8" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="1.6 1.4" />
      <rect x={8.5} y={12} width={11} height={3} rx={1.5} fill={color} />
      <text x={14} y={26} textAnchor="middle" fontSize={number.toString().length > 1 ? 10 : 12} fontWeight={800} fill="currentColor">
        {number}
      </text>
    </svg>
  );
}

/** A minifigure head; the Master Builder wears a hard hat. */
export function MinifigHead({ master = false, size = 22, busy = false }: { master?: boolean; size?: number; busy?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={busy ? "lego-head-busy" : undefined}>
      <rect x={9} y={1.5} width={6} height={3} rx={1} fill="#E8B500" />
      <rect x={4.5} y={4} width={15} height={16} rx={5} fill="#F5C518" stroke="#B88E00" strokeWidth={0.8} />
      <circle cx={9.5} cy={11} r={1.2} fill="#1d1d1b" />
      <circle cx={14.5} cy={11} r={1.2} fill="#1d1d1b" />
      <path d="M8.5 14.5 Q12 17.5 15.5 14.5" stroke="#1d1d1b" strokeWidth={1.1} fill="none" strokeLinecap="round" />
      {master ? (
        <g>
          <path d="M3.5 8.5 Q12 -1.5 20.5 8.5 Z" fill="#F57D20" stroke="#B85A10" strokeWidth={0.8} />
          <rect x={2.5} y={7.6} width={19} height={2} rx={1} fill="#F57D20" stroke="#B85A10" strokeWidth={0.6} />
          <rect x={11.2} y={2.6} width={1.6} height={5} fill="#FFB25E" />
        </g>
      ) : null}
    </svg>
  );
}

// --------------------------------------------------------------- figures

/** Shirt colours for builders, by builder number. */
export const BUILDER_SHIRTS = ["#C91A09", "#1E6FD0", "#237841", "#6C3FA8", "#36AEBF", "#E86FA7", "#A5CA18", "#B40F6E"];
const SKIN = "#F5C518";
const SKIN_EDGE = "#B88E00";
const INK = "#1d1d1b";

export type FigurePose = "idle" | "work" | "cheer";

/** Where a figure's held brick sits, relative to its feet. */
export const HAND_OFFSET: [number, number] = [0, -43];

function Arm({ side, shirt, edge }: { side: "l" | "r"; shirt: string; edge: string }) {
  const sign = side === "l" ? -1 : 1;
  return (
    <g className={`lego-fig-arm lego-fig-arm-${side}`}>
      <g transform={`translate(${sign * 5.1} -22.6) rotate(${-sign * 14})`}>
        <rect x={-1.75} y={-0.6} width={3.5} height={9.4} rx={1.75} fill={shirt} stroke={edge} strokeWidth={0.4} />
        <circle cx={0} cy={10.2} r={2.05} fill={SKIN} stroke={SKIN_EDGE} strokeWidth={0.4} />
        <circle cx={0} cy={11} r={0.85} fill={shade(SKIN, 0.62)} />
      </g>
    </g>
  );
}

/** A small open parts bag, the kind builders pull bricks from. */
export function PartsBag({ at, number }: { at: [number, number]; number: number }) {
  const [x, y] = at;
  return (
    <g className="lego-parts-bag" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} aria-hidden="true">
      <path d="M-5.5 0 L-4.6 -9 Q0 -11.2 4.6 -9 L5.5 0 Z" fill="rgb(255 255 255 / 0.78)" stroke="rgb(0 0 0 / 0.35)" strokeWidth={0.5} />
      <path d="M-4.4 -8.2 Q0 -10.2 4.4 -8.2" fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth={0.4} strokeDasharray="1 0.8" />
      <text x={0} y={-2.4} textAnchor="middle" fontSize={5} fontWeight={800} fill={INK}>
        {number}
      </text>
    </g>
  );
}

/**
 * A minifigure standing with its feet at `at` (screen coordinates). Builders
 * wear yellow hard hats and hold the next brick overhead; the Master Builder
 * wears white and studies the plans. Changing `beat` replays the "threw a
 * brick into place" swing; changing `stride` plays a few walking steps.
 */
export function Minifig({
  at,
  pose,
  shirt,
  master = false,
  holding = null,
  beat,
  stride,
  className,
  style,
  title,
}: {
  at: [number, number];
  pose: FigurePose;
  shirt: string;
  master?: boolean;
  holding?: string | null;
  beat?: number | string;
  stride?: number | string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const hat = master ? "#F4F4F4" : "#F2CD37";
  const legs = master ? "#1E4F9A" : "#3A3F45";
  const shirtEdge = shade(shirt, 0.5);
  const hatEdge = shade(hat, 0.58);
  return (
    <g
      className={`lego-fig lego-fig-${pose}${className ? ` ${className}` : ""}`}
      style={{ transform: `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px)`, ...style }}
    >
      {title === undefined ? null : <title>{title}</title>}
      <ellipse cx={0} cy={0.4} rx={8} ry={2.6} fill="rgb(0 0 0 / 0.22)" />
      <g key={beat ?? "still"} className={beat === undefined ? "lego-fig-lean" : "lego-fig-lean lego-fig-beat"}>
        <g className="lego-fig-bob">
          <g key={stride ?? "planted"} className={stride === undefined ? "lego-fig-legs" : "lego-fig-legs lego-fig-walk"}>
            <g className="lego-fig-leg lego-fig-leg-l">
              <rect x={-5.8} y={-11.4} width={5.5} height={11.4} rx={0.8} fill={legs} />
              <rect x={-5.8} y={-1.7} width={5.5} height={1.7} rx={0.5} fill={shade(legs, 0.7)} />
            </g>
            <g className="lego-fig-leg lego-fig-leg-r">
              <rect x={0.3} y={-11.4} width={5.5} height={11.4} rx={0.8} fill={shade(legs, 0.84)} />
              <rect x={0.3} y={-1.7} width={5.5} height={1.7} rx={0.5} fill={shade(legs, 0.6)} />
            </g>
          </g>
          <rect x={-6.1} y={-13.6} width={12.2} height={2.7} rx={0.8} fill={shade(legs, 0.72)} />
          <path d="M-6.5 -13 L6.5 -13 L4.8 -23.8 L-4.8 -23.8 Z" fill={shirt} stroke={shirtEdge} strokeWidth={0.5} strokeLinejoin="round" />
          <path d="M2.7 -13 L6.5 -13 L4.8 -23.8 L2.2 -23.8 Z" fill={shade(shirt, 0.8)} />
          {master ? (
            <g>
              <path d="M-6 -15.6 L6 -15.6 M-5.6 -18.4 L5.6 -18.4" stroke="#E8E8E8" strokeWidth={1.1} />
              <path d="M-2.2 -23.8 L0 -20.6 L2.2 -23.8" fill="#F4F4F4" />
            </g>
          ) : (
            <g>
              <path d="M-6.1 -16.8 L6.1 -16.8" stroke="#F4F4F4" strokeOpacity={0.85} strokeWidth={1.2} />
              <path d="M-1.8 -23.8 L-1.8 -13.2 M1.8 -23.8 L1.8 -13.2" stroke={shade(shirt, 0.62)} strokeWidth={0.5} />
            </g>
          )}
          <Arm side="l" shirt={shirt} edge={shirtEdge} />
          <Arm side="r" shirt={shirt} edge={shirtEdge} />
          <rect x={-1.9} y={-25.2} width={3.8} height={1.8} fill={shade(SKIN, 0.85)} />
          <g className="lego-fig-head">
            <rect x={-4.9} y={-33.6} width={9.8} height={8.6} rx={2.9} fill={SKIN} stroke={SKIN_EDGE} strokeWidth={0.5} />
            <path d="M2 -33.6 H2 A2.9 2.9 0 0 1 4.9 -30.7 V-27.9 A2.9 2.9 0 0 1 2 -25 Z" fill={shade(SKIN, 0.86)} />
            <ellipse cx={-1.9} cy={-29.6} rx={0.8} ry={1.05} fill={INK} />
            <ellipse cx={1.9} cy={-29.6} rx={0.8} ry={1.05} fill={INK} />
            <circle cx={-1.65} cy={-29.95} r={0.28} fill="#fff" />
            <circle cx={2.15} cy={-29.95} r={0.28} fill="#fff" />
            {master ? (
              <path d="M-2.4 -27.4 Q0 -25.2 2.4 -27.4 Z" fill="#fff" stroke={INK} strokeWidth={0.5} strokeLinejoin="round" />
            ) : (
              <path d="M-2.1 -27.4 Q0 -25.8 2.1 -27.4" stroke={INK} strokeWidth={0.6} fill="none" strokeLinecap="round" />
            )}
          </g>
          <path d="M-5.4 -32 Q-5.2 -38.8 0 -39 Q5.2 -38.8 5.4 -32 Z" fill={hat} stroke={hatEdge} strokeWidth={0.5} />
          <path d="M2.2 -38.6 Q5.1 -37.2 5.4 -32 L2.4 -32 Z" fill={shade(hat, 0.85)} />
          <rect x={-0.75} y={-38.7} width={1.5} height={6.5} fill={shade(hat, 1.2)} />
          <rect x={-6.8} y={-32.6} width={13.6} height={1.9} rx={0.9} fill={hat} stroke={hatEdge} strokeWidth={0.4} />
          {master && pose === "idle" ? (
            <g className="lego-fig-plan">
              <rect x={-5} y={-20.2} width={10} height={7} rx={0.6} fill="#2F6FD0" stroke="#1D4F9A" strokeWidth={0.4} transform="rotate(-6 0 -16.7)" />
              <path d="M-3.4 -18.6 H2.8 M-3.4 -16.8 H1.4 M-3.4 -15 H3.2" stroke="#fff" strokeOpacity={0.85} strokeWidth={0.5} transform="rotate(-6 0 -16.7)" />
            </g>
          ) : null}
          {holding !== null && pose === "work" ? (
            <g className="lego-fig-held">
              <rect x={-5.4} y={-45.2} width={10.8} height={5.6} rx={0.8} fill={holding} stroke={shade(holding, 0.45)} strokeWidth={0.5} />
              <rect x={1.6} y={-45.2} width={3.8} height={5.6} rx={0.6} fill={shade(holding, 0.84)} />
              <rect x={-4} y={-46.9} width={2.8} height={1.9} rx={0.5} fill={shade(holding, 1.15)} />
              <rect x={1.2} y={-46.9} width={2.8} height={1.9} rx={0.5} fill={shade(holding, 1.15)} />
            </g>
          ) : null}
        </g>
      </g>
    </g>
  );
}
