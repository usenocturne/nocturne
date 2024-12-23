import { useEffect } from "react";
import { useRouter } from "next/router";

export function useAppState({
  currentPlayback,
  setActiveSection,
  updateGradientColors,
  drawerOpen,
  setDrawerOpen,
}) {
  const router = useRouter();

  useEffect(() => {
    const handleAppEscape = () => {
      if (drawerOpen) {
        setDrawerOpen(false);
      }
    };

    window.addEventListener("app-escape-pressed", handleAppEscape);
    return () => {
      window.removeEventListener("app-escape-pressed", handleAppEscape);
    };
  }, [drawerOpen, setDrawerOpen]);

  useEffect(() => {
    if (currentPlayback && currentPlayback.item) {
      setActiveSection("nowPlaying");
      const albumImage = currentPlayback.item.album?.images?.[0]?.url;
      updateGradientColors(albumImage || null, "nowPlaying");
    }
  }, [currentPlayback, updateGradientColors, setActiveSection]);

  useEffect(() => {
    if (router.pathname === "/now-playing") {
      if (!currentPlayback || !currentPlayback.is_playing) {
        updateGradientColors(null);
      } else {
        const albumImages = currentPlayback?.item?.album?.images;
        const podcastImages = currentPlayback?.item?.images;

        if (albumImages?.[0]?.url) {
          updateGradientColors(albumImages[0].url, "nowPlaying");
        } else if (podcastImages?.[0]?.url) {
          updateGradientColors(podcastImages[0].url, "nowPlaying");
        } else {
          updateGradientColors(null);
        }
      }
    }
  }, [router.pathname, currentPlayback, updateGradientColors]);
}
