import { useMemo } from 'react';
import { useCallback } from 'react';
import { useState } from 'react';

export function useGradientState(activeSection = null) {
  const [imageURL, setImageURL] = useState(null);
  const [section, setSection] = useState(activeSection);

  const gradientState = useMemo(
    () => ({
      imageURL,
      section,
    }),
    [imageURL, section],
  );

  const setGradientState = useCallback(
    (newImageURL = null, newSection = null) => {
      setImageURL(newImageURL);
      setSection(newSection);
    },
    [],
  );

  return [gradientState, setGradientState];
}
