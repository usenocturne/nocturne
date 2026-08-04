import { useCallback, useMemo, useState } from "react";
import type {
  ActiveSection,
  GradientState,
  UpdateGradientColors,
} from "../types";

export function useGradientState(
  activeSection: ActiveSection | null = null,
): [GradientState, UpdateGradientColors] {
  const [imageURL, setImageURL] = useState<string | null>(null);
  const [section, setSection] = useState<string | null>(activeSection);
  const gradientState = useMemo(
    () => ({
      imageURL,
      section,
    }),
    [imageURL, section],
  );

  const setGradientState = useCallback(
    (newImageURL: string | null = null, newSection: string | null = null) => {
      setImageURL(newImageURL);
      setSection(newSection);
    },
    [],
  );

  return [gradientState, setGradientState];
}
