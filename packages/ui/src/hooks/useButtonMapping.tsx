import { useState, useRef, useCallback, useEffect } from "react";
import {
  getActivePresetDeviceId,
  setButtonMappingValue,
} from "../utils/presetStorage";

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
  }, [contentType]);

  const saveButtonMapping = useCallback(
    (buttonNumber) => {
      if (!contentId || !contentType) return;

      const deviceId = getActivePresetDeviceId();

      setButtonMappingValue(buttonNumber, "Id", contentId, deviceId);
      setButtonMappingValue(buttonNumber, "Type", contentType, deviceId);
      let imageToSave = contentImage;
      if (contentId === "37i9dQZF1EYkqdzj48dyYq") {
        imageToSave = "/images/radio-cover/dj.webp";
      } else if (contentType === "liked-songs" && !imageToSave) {
        imageToSave = "/images/liked-songs.webp";
      }
      setButtonMappingValue(buttonNumber, "Image", imageToSave || "", deviceId);
      setButtonMappingValue(buttonNumber, "Name", contentName || "", deviceId);

      if (
        (contentType === "mix" || contentType === "liked-songs") &&
        trackUrisRef.current.length > 0
      ) {
        setButtonMappingValue(
          buttonNumber,
          "Tracks",
          JSON.stringify(trackUrisRef.current),
          deviceId,
        );
      }

      setMappingInProgress(false);
    },
    [contentId, contentType, contentImage, contentName],
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
