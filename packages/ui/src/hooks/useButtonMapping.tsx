import { useState, useRef, useCallback, useEffect } from "react";
import {
  getActivePresetDeviceId,
  setButtonMapping,
} from "../utils/presetStorage";
import { buildButtonMapping } from "../utils/buttonMapping";

export function useButtonMapping({
  contentId,
  contentType,
  contentImage,
  contentName,
  playTrack,
  isActive = false,
  setIgnoreNextRelease,
}: UiComponentProps) {
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
  }, [contentId, contentType]);

  const saveButtonMapping = useCallback(
    (buttonNumber) => {
      const mapping = buildButtonMapping({
        contentId,
        contentType,
        contentImage,
        contentName,
        trackUris: trackUrisRef.current,
      });
      if (!mapping) return;

      const deviceId = getActivePresetDeviceId();
      setButtonMapping(buttonNumber, mapping, deviceId);

      setMappingInProgress(false);
    },
    [contentId, contentType, contentImage, contentName],
  );

  const setTrackUris = useCallback((uris) => {
    trackUrisRef.current = Array.isArray(uris) ? uris : [];
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
    [isActive, saveButtonMapping, setIgnoreNextRelease],
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
    [isActive],
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
