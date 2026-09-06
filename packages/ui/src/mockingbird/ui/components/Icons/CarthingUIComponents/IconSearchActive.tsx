import type { MockIconProps } from "../IconProps";
import { IconSearchActive as BaseIconSearchActive } from "../EncoreWeb/IconSearchActive";

const IconSearchActive = ({ iconSize = 32 }: MockIconProps) => (
  <BaseIconSearchActive iconSize={iconSize} />
);

export default IconSearchActive;
