import type { ComponentType } from "react";
import type { IconProps } from "../../../types";

export type ManeuverDirection = "left" | "right" | "straight" | "uturn";

const glyph =
  (...paths: string[]): ComponentType<IconProps> =>
  ({ className }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );

export const StraightGlyph = glyph("M8 6L12 2L16 6", "M12 2V22");
export const LeftTurnGlyph = glyph(
  "M20 20v-7a4 4 0 0 0-4-4H4",
  "M9 14 4 9l5-5",
);
export const RightTurnGlyph = glyph(
  "m15 14 5-5-5-5",
  "M4 20v-7a4 4 0 0 1 4-4h12",
);
export const UTurnGlyph = glyph(
  "M7 20 L7 11 a5 5 0 0 1 10 0 L17 19",
  "M13.5 15.5 L17 19 L20.5 15.5",
);

const GLYPHS: Record<ManeuverDirection, ComponentType<IconProps>> = {
  left: LeftTurnGlyph,
  right: RightTurnGlyph,
  straight: StraightGlyph,
  uturn: UTurnGlyph,
};

/** Classify a Maps instruction string into a maneuver direction. */
export const maneuverDirection = (instruction: string): ManeuverDirection => {
  const s = instruction.toLowerCase();
  if (s.includes("u-turn") || s.includes("u turn") || s.includes("make a u")) {
    return "uturn";
  }
  if (s.includes("left")) return "left";
  if (s.includes("right")) return "right";
  return "straight";
};

export const maneuverGlyph = (instruction: string): ComponentType<IconProps> =>
  GLYPHS[maneuverDirection(instruction)];
