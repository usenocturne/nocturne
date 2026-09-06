import type { SVGProps } from "react";

export type MockIconProps = SVGProps<SVGSVGElement> & {
  iconSize?: number;
  size?: number;
  autoMirror?: boolean;
  title?: string;
  titleId?: string;
  desc?: string;
  descId?: string;
};

export type FixedIconProps = SVGProps<SVGSVGElement>;
