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
  dangerouslySetInnerHTML?: { __html: string };
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

export function Icon(props: EncoreIconProps) {
  var iconSize = props.iconSize || 24;
  var viewBox = props.viewBox;
  var dangerouslySetInnerHTML = props.dangerouslySetInnerHTML;
  var className = props.className;
  var style = props.style;

  return React.createElement(
    "svg",
    Object.assign({}, props, {
      width: iconSize,
      height: iconSize,
      viewBox: viewBox,
      fill: "currentColor",
      className: className,
      style: style,
      dangerouslySetInnerHTML: dangerouslySetInnerHTML,
    }),
  );
}
