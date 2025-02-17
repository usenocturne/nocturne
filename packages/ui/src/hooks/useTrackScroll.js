import { getDefaultSettingValue } from "@/components/settings/Settings";
import { useState, useEffect, useRef } from "react";

export function useTrackScroll(trackName, containerWidth = 380) {
  const [trackNameScrollingEnabled, setTrackNameScrollingEnabled] =
    useState(false);
  const [shouldScroll, setShouldScroll] = useState(false);
  const trackNameRef = useRef(null);
  const scrollSpeed = 40;

  useEffect(() => {
    const scrollingEnabled = localStorage.getItem("trackNameScrollingEnabled");
    if (scrollingEnabled === null) {
      const trackNameScrollingDefaultValue = getDefaultSettingValue("playback", "trackNameScrollingEnabled");
      localStorage.setItem("trackNameScrollingEnabled", trackNameScrollingDefaultValue);
      setTrackNameScrollingEnabled(trackNameScrollingDefaultValue);
    } else {
      setTrackNameScrollingEnabled(scrollingEnabled === "true");
    }
  }, []);

  useEffect(() => {
    if (trackNameRef.current && trackName) {
      const trackNameWidth = trackNameRef.current.offsetWidth;
      const scrollDistance = Math.max(0, trackNameWidth - containerWidth);
      const scrollDuration = (scrollDistance / scrollSpeed) * 2;

      trackNameRef.current.style.setProperty(
        "--scroll-duration",
        `${scrollDuration}s`
      );
      trackNameRef.current.style.setProperty(
        "--final-position",
        `-${scrollDistance}px`
      );

      setShouldScroll(trackNameWidth > containerWidth);
    }
  }, [trackName, containerWidth]);

  return {
    trackNameScrollingEnabled,
    shouldScroll,
    trackNameRef,
  };
}
