import { useState, useRef, useCallback, useEffect } from "react";

export function useButtonMapping({
  accessToken,
  contentId,
  contentType,
  contentImage,
  contentName,
  playTrack,
  isActive = false,
  setIgnoreNextRelease,
}) {
  const [mappingInProgress, setMappingInProgress] = useState(false);
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [activeButton, setActiveButton] = useState(null);
  const longPressTimers = useRef({});
  const isMappingRef = useRef(false);
  const trackUrisRef = useRef([]);

  useEffect(() => {
    if (contentType === "mix" || contentType === "liked-songs") {
      trackUrisRef.current = [];
    }
  }, [contentType]);

  const saveButtonMapping = useCallback(
    (buttonNumber) => {
      if (!contentId || !contentType) return;

      localStorage.setItem(`button${buttonNumber}Id`, contentId);
      localStorage.setItem(`button${buttonNumber}Type`, contentType);
      let imageToSave = contentImage;
      if (contentType === "liked-songs" && !imageToSave) {
        imageToSave = "https://misc.scdn.co/liked-songs/liked-songs-300.png";
      }
      localStorage.setItem(`button${buttonNumber}Image`, imageToSave || "");
      localStorage.setItem(`button${buttonNumber}Name`, contentName || "");

      if (
        (contentType === "mix" || contentType === "liked-songs") &&
        trackUrisRef.current.length > 0
      ) {
        localStorage.setItem(
          `button${buttonNumber}Tracks`,
          JSON.stringify(trackUrisRef.current)
        );
      }

      setMappingInProgress(false);
    },
    [contentId, contentType, contentImage, contentName]
  );

  const setTrackUris = useCallback((uris) => {
    if (Array.isArray(uris)) {
      trackUrisRef.current = uris;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e) => {
      if (!isActive) return;

      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;

      if (isMappingRef.current) return;

      if (!longPressTimers.current[buttonNumber]) {
        longPressTimers.current[buttonNumber] = setTimeout(() => {
          setMappingInProgress(true);
          isMappingRef.current = true;

          if (setIgnoreNextRelease) {
            setIgnoreNextRelease();
          }

          saveButtonMapping(buttonNumber);

          setActiveButton(buttonNumber);
          setShowMappingOverlay(true);

          setTimeout(() => {
            setShowMappingOverlay(false);
            setActiveButton(null);
            isMappingRef.current = false;
          }, 1500);

          longPressTimers.current[buttonNumber] = null;
        }, 2000);
      }

      e.preventDefault();
    },
    [isActive, saveButtonMapping, setIgnoreNextRelease]
  );

  const handleKeyUp = useCallback(
    (e) => {
      if (!isActive) return;

      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;

      if (longPressTimers.current[buttonNumber]) {
        clearTimeout(longPressTimers.current[buttonNumber]);
        longPressTimers.current[buttonNumber] = null;
      }

      e.preventDefault();
    },
    [isActive]
  );

  useEffect(() => {
    if (isActive) {
      window.addEventListener("keydown", handleKeyDown, { capture: true });
      window.addEventListener("keyup", handleKeyUp, { capture: true });
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });

      Object.keys(longPressTimers.current).forEach((key) => {
        if (longPressTimers.current[key]) {
          clearTimeout(longPressTimers.current[key]);
        }
      });
    };
  }, [isActive, handleKeyDown, handleKeyUp]);

  return {
    mappingInProgress,
    showMappingOverlay,
    activeButton,
    saveButtonMapping,
    setTrackUris,
    setShowMappingOverlay,
  };
}
