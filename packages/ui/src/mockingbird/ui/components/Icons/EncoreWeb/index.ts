import React from "react";
import type { SVGProps } from "react";

export interface EncoreIconGlyph {
  size: number;
  svgContent: string;
}

export type EncoreIconProps = SVGProps<SVGSVGElement> & {
  autoMirror?: boolean;
  desc?: string;
  descId?: string;
  iconSize?: number;
  title?: string;
  titleId?: string;
  viewBox?: string;
};

export function findClosestGlyphAvailable(
  iconList: EncoreIconGlyph[],
  targetSize: number,
): EncoreIconGlyph {
  let best = iconList[0];
  for (const icon of iconList) {
    if (icon.size <= targetSize && icon.size > best.size) {
      best = icon;
    }
  }
  return best;
}

export function Icon({
  iconSize: requestedSize,
  autoMirror: _autoMirror,
  desc: _desc,
  descId: _descId,
  titleId: _titleId,
  ...svgProps
}: EncoreIconProps) {
  const iconSize = requestedSize || 24;
  return React.createElement("svg", {
    ...svgProps,
    width: iconSize,
    height: iconSize,
    fill: "currentColor",
  });
}
