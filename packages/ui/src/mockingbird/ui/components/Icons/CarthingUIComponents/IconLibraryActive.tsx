import type { MockIconProps } from "../IconProps";
import { IconCollectionActive } from "../EncoreWeb/IconCollectionActive";

const IconLibraryActive = ({ iconSize = 32 }: MockIconProps) => (
  <IconCollectionActive iconSize={iconSize} />
);

export default IconLibraryActive;
