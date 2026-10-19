// Shared motion for the banner and the side panel. A view snapshots what was
// already true when it first saw a book; anything that becomes true later is
// "fresh" and gets the snap, drop, or celebration, while what was already
// there plays a quick staggered build-up instead.
import { useRef, type CSSProperties } from "react";
import type { BookState } from "../book";
import { BRICK_HEX } from "./iso";

export interface Motion {
  /** True when `key` became true after this view first saw the book. */
  isFresh(key: string): boolean;
  /** Class and delay for a solid brick: build-up on first sight, snap when fresh. */
  brick(key: string, order: number): { className: string; style?: CSSProperties };
}

/** Facts about a book that animations key off. */
export function bookFacts(book: BookState): Set<string> {
  const facts = new Set<string>();
  for (const bag of book.bags) {
    bag.steps.forEach((step, index) => {
      if (step.done) facts.add(`${bag.id}:${index}`);
    });
    if (bag.status === "built" || bag.status === "attached") facts.add(`${bag.id}:built`);
    if (bag.status === "attached") facts.add(`${bag.id}:attached`);
  }
  book.master.steps.forEach((step, index) => {
    if (step.done) facts.add(`master:${index}`);
  });
  facts.add(`status:${book.status}`);
  return facts;
}

const INTRO_STEP_MS = 22;
const INTRO_MAX_ORDER = 60;

export function useMotion(book: BookState | null | undefined): Motion {
  const snapshot = useRef<{ bookId: string; facts: Set<string> } | null>(null);
  if (book && snapshot.current?.bookId !== book.id) {
    snapshot.current = { bookId: book.id, facts: bookFacts(book) };
  }
  const seen = snapshot.current?.facts ?? new Set<string>();
  return {
    isFresh: (key) => !seen.has(key),
    brick: (key, order) =>
      seen.has(key)
        ? {
            className: "lego-intro",
            style: { animationDelay: `${Math.min(order, INTRO_MAX_ORDER) * INTRO_STEP_MS}ms` },
          }
        : { className: "lego-snap" },
  };
}

const CONFETTI_COLORS = ["red", "blue", "yellow", "green", "orange", "azure", "lime", "pink"] as const;

/** Deterministic 0..1 noise so confetti looks random but renders stably. */
function noise(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** A burst of tiny bricks from a point; mount it to fire once. */
export function Confetti({
  pieces = 18,
  spread = 75,
  reach = 70,
  x = "50%",
  y = "50%",
}: {
  pieces?: number;
  /** Half-angle of the fan, in degrees either side of straight up. */
  spread?: number;
  /** Typical travel in px before gravity takes over. */
  reach?: number;
  x?: string;
  y?: string;
}) {
  return (
    <span className="lego-confetti" style={{ left: x, top: y }} aria-hidden="true">
      {Array.from({ length: pieces }, (_, index) => {
        const angle = ((-90 + (noise(index, 1) * 2 - 1) * spread) * Math.PI) / 180;
        const distance = reach * (0.55 + noise(index, 2) * 0.7);
        const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length] ?? "red";
        return (
          <i
            key={index}
            style={
              {
                "--dx": `${(Math.cos(angle) * distance).toFixed(1)}px`,
                "--dy": `${(Math.sin(angle) * distance).toFixed(1)}px`,
                "--r": `${Math.round((noise(index, 3) * 2 - 1) * 540)}deg`,
                "--d": `${Math.round(noise(index, 4) * 120)}ms`,
                "--c": BRICK_HEX[color],
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
