import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { extractColorsFromImage } from "../utils/colorExtractor";

const DEFAULT_HEX_COLORS = ["#191414", "#191414", "#191414", "#191414"];

export function useGradientTransition(activeSection) {
  const [currentGradientHexColors, setCurrentGradientHexColors] =
    useState(DEFAULT_HEX_COLORS);
  const [sectionGradients, setSectionGradients] = useState({
    recents: null,
    library: null,
    artists: null,
    radio: null,
    podcasts: null,
    nowPlaying: null,
  });
  const [gradientTransitionDurationMs] = useState(3000);

  const lastProcessedUrlRef = useRef(null);
  const lastProcessedSectionRef = useRef(null);

  const MAX_BRIGHTNESS_THRESHOLD = 200;

  const hexToRgb = useCallback((hex) => {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  }, []);

  const rgbToHex = useCallback(({ r, g, b }) => {
    const toHex = (n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }, []);

  const calculateBrightness = useCallback((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }, []);

  const limitColorBrightness = useCallback(
    (hexColor) => {
      const rgb = hexToRgb(hexColor);
      const brightness = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;

      if (brightness <= MAX_BRIGHTNESS_THRESHOLD) {
        return hexColor;
      }

      const reduction = brightness / MAX_BRIGHTNESS_THRESHOLD;

      return rgbToHex({
        r: Math.round(rgb.r / reduction),
        g: Math.round(rgb.g / reduction),
        b: Math.round(rgb.b / reduction),
      });
    },
    [MAX_BRIGHTNESS_THRESHOLD, hexToRgb, rgbToHex],
  );

  const calculateHue = useCallback((hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h;

    if (max === min) {
      h = 0;
    } else {
      const d = max - min;
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return h * 360;
  }, []);

  const generateMeshGradient = useCallback((colors) => {
    if (!colors || colors.length === 0) {
      return `radial-gradient(at 0% 25%, ${DEFAULT_HEX_COLORS[0]} 0%, transparent 80%), radial-gradient(at 25% 0%, ${DEFAULT_HEX_COLORS[1]} 0%, transparent 80%), radial-gradient(at 100% 75%, ${DEFAULT_HEX_COLORS[2]} 0%, transparent 80%), radial-gradient(at 75% 100%, ${DEFAULT_HEX_COLORS[3]} 0%, transparent 80%)`;
    }

    const positions = ["at 0% 25%", "at 25% 0%", "at 100% 75%", "at 75% 100%"];
    const radialGradients = positions.map((position, index) => {
      const color = colors[index % colors.length];
      return `radial-gradient(${position}, ${color} 0%, transparent 80%)`;
    });

    return radialGradients.join(", ");
  }, []);

  const initialMeshGradient = useMemo(
    () => generateMeshGradient(DEFAULT_HEX_COLORS),
    [generateMeshGradient],
  );

  const needsDarkGradientEnhancement = useCallback(
    (colors) => {
      if (!colors || colors.length < 2) return true;

      let darkColorCount = 0;
      let totalBrightness = 0;

      for (const color of colors) {
        const brightness = calculateBrightness(color);
        totalBrightness += brightness;

        if (brightness < 30) {
          darkColorCount++;
        }
      }

      const avgBrightness = totalBrightness / colors.length;

      return (
        darkColorCount >= Math.ceil(colors.length * 0.75) || avgBrightness < 25
      );
    },
    [calculateBrightness],
  );

  const createEnhancedDarkGradient = useCallback(
    (colors, accentColor = null) => {
      let accent = accentColor;

      if (!accent) {
        for (const color of colors) {
          const rgb = hexToRgb(color);
          const isNotBlack = rgb.r > 30 || rgb.g > 30 || rgb.b > 30;

          if (isNotBlack) {
            accent = color;
            break;
          }
        }

        if (!accent) {
          const baseColor = colors[0] || "#191414";
          const baseRgb = hexToRgb(baseColor);

          if (baseRgb.r >= baseRgb.g && baseRgb.r >= baseRgb.b) {
            accent = "#3D2828";
          } else if (baseRgb.g >= baseRgb.r && baseRgb.g >= baseRgb.b) {
            accent = "#283D28";
          } else {
            accent = "#28283D";
          }
        }
      }

      const accentRgb = hexToRgb(accent);

      return [
        rgbToHex({
          r: Math.min(255, Math.round(accentRgb.r * 0.3)),
          g: Math.min(255, Math.round(accentRgb.g * 0.3)),
          b: Math.min(255, Math.round(accentRgb.b * 0.3)),
        }),
        rgbToHex({
          r: Math.min(255, Math.round(accentRgb.r * 0.2)),
          g: Math.min(255, Math.round(accentRgb.g * 0.2)),
          b: Math.min(255, Math.round(accentRgb.b * 0.2)),
        }),
        accent,
        rgbToHex({
          r: Math.max(1, Math.round(accentRgb.r * 0.1)),
          g: Math.max(1, Math.round(accentRgb.g * 0.1)),
          b: Math.max(1, Math.round(accentRgb.b * 0.1)),
        }),
      ];
    },
    [hexToRgb, rgbToHex],
  );

  const filterColors = useCallback(
    (colors) => {
      if (!colors || colors.length === 0) return colors;

      const brightnessLimitedColors = colors.map((color) =>
        limitColorBrightness(color),
      );

      if (needsDarkGradientEnhancement(brightnessLimitedColors)) {
        let accentColor = null;
        for (const color of brightnessLimitedColors) {
          const brightness = calculateBrightness(color);
          if (brightness > 30) {
            accentColor = color;
            break;
          }
        }

        return createEnhancedDarkGradient(brightnessLimitedColors, accentColor);
      }

      const withBrightness = brightnessLimitedColors.map((color) => ({
        color,
        brightness: calculateBrightness(color),
        hue: calculateHue(color),
      }));

      withBrightness.sort((a, b) => b.brightness - a.brightness);

      const brightColors = withBrightness.filter((c) => c.brightness > 120);
      const darkColors = withBrightness.filter((c) => c.brightness < 60);
      const midColors = withBrightness.filter(
        (c) => c.brightness >= 60 && c.brightness <= 120,
      );

      const result = [];

      if (brightColors.length > 0) {
        result.push(brightColors[0].color);
      }

      if (midColors.length > 0) {
        result.push(midColors[0].color);
        if (midColors.length > 1) {
          result.push(midColors[midColors.length - 1].color);
        }
      }

      if (darkColors.length > 0) {
        result.push(darkColors[0].color);
      }

      while (result.length < 4 && withBrightness.length > 0) {
        const nextColor = withBrightness.shift().color;
        if (!result.includes(nextColor)) {
          result.push(nextColor);
        }
      }

      while (result.length < 4) {
        const baseColor = result[0];
        const r = parseInt(baseColor.slice(1, 3), 16);
        const g = parseInt(baseColor.slice(3, 5), 16);
        const b = parseInt(baseColor.slice(5, 7), 16);

        const variations = [
          `#${Math.max(0, r - 30)
            .toString(16)
            .padStart(2, "0")}${Math.max(0, g - 10)
            .toString(16)
            .padStart(2, "0")}${Math.min(255, b + 20)
            .toString(16)
            .padStart(2, "0")}`,
          `#${Math.min(255, r + 20)
            .toString(16)
            .padStart(2, "0")}${Math.max(0, g - 20)
            .toString(16)
            .padStart(2, "0")}${Math.max(0, b - 30)
            .toString(16)
            .padStart(2, "0")}`,
          `#${Math.max(0, r - 15)
            .toString(16)
            .padStart(2, "0")}${Math.min(255, g + 25)
            .toString(16)
            .padStart(2, "0")}${Math.max(0, b - 15)
            .toString(16)
            .padStart(2, "0")}`,
        ];

        result.push(variations[result.length - 1]);
      }

      return result.slice(0, 4);
    },
    [
      calculateBrightness,
      calculateHue,
      limitColorBrightness,
      needsDarkGradientEnhancement,
      createEnhancedDarkGradient,
    ],
  );

  const updateGradientColors = useCallback(
    async (imageUrl, imageSection = null) => {
      const skipCacheCheck =
        imageSection === "nowPlaying" || imageSection === "recents";
      const urlSectionKey = `${imageUrl || "none"}-${imageSection || "none"}`;

      if (
        !skipCacheCheck &&
        urlSectionKey ===
          `${lastProcessedUrlRef.current || "none"}-${
            lastProcessedSectionRef.current || "none"
          }`
      ) {
        return;
      }

      lastProcessedUrlRef.current = imageUrl || "none";
      lastProcessedSectionRef.current = imageSection || "none";

      let newColorsForImageSection;
      let isError = false;

      if (!imageUrl) {
        if (imageSection === "radio")
          newColorsForImageSection = [
            "#3B518B",
            "#202F57",
            "#142045",
            "#151231",
          ];
        else if (imageSection === "settings")
          newColorsForImageSection = [
            "#3B518B",
            "#202F57",
            "#142045",
            "#151231",
          ];
        else if (imageSection === "library")
          newColorsForImageSection = [
            "#7662e9",
            "#a9c1de",
            "#8f90e3",
            "#5b30ef",
          ];
        else if (imageSection === "auth")
          newColorsForImageSection = [
            "#3B518B",
            "#202F57",
            "#142045",
            "#151231",
          ];
        else
          newColorsForImageSection = [
            "#191414",
            "#191414",
            "#191414",
            "#191414",
          ];
      } else {
        try {
          let extracted = await extractColorsFromImage(imageUrl);
          newColorsForImageSection = filterColors(extracted);
        } catch (error) {
          console.error("Error updating gradient colors:", error);
          newColorsForImageSection = [
            "#191414",
            "#191414",
            "#191414",
            "#191414",
          ];
          isError = true;
        }
      }

      if (imageSection) {
        setSectionGradients((prev) => ({
          ...prev,
          [imageSection]: newColorsForImageSection,
        }));
      }

      let shouldUpdateGlobalGradient = false;
      if (isError) {
        if (activeSection && sectionGradients[activeSection]) {
          setCurrentGradientHexColors(sectionGradients[activeSection]);
        } else {
          setCurrentGradientHexColors([
            "#191414",
            "#191414",
            "#191414",
            "#191414",
          ]);
        }
        return;
      }

      if (!imageUrl) {
        if (imageSection === "auth") shouldUpdateGlobalGradient = true;
        else if (imageSection === "settings" && activeSection === "settings")
          shouldUpdateGlobalGradient = true;
        else if (
          imageSection === "radio" &&
          (activeSection === "radio" || activeSection === "nowPlaying")
        )
          shouldUpdateGlobalGradient = true;
        else if (imageSection === "library" && activeSection === "library")
          shouldUpdateGlobalGradient = true;
        else if (!imageSection) shouldUpdateGlobalGradient = true;
      } else {
        shouldUpdateGlobalGradient =
          !imageSection ||
          imageSection === activeSection ||
          imageSection === "nowPlaying" ||
          (activeSection === "nowPlaying" && imageSection) ||
          ["album", "playlist", "artist", "mix", "liked-songs"].includes(
            imageSection,
          );
      }

      if (shouldUpdateGlobalGradient) {
        setCurrentGradientHexColors(newColorsForImageSection);
      } else if (activeSection && sectionGradients[activeSection]) {
        if (
          JSON.stringify(currentGradientHexColors) !==
          JSON.stringify(sectionGradients[activeSection])
        ) {
          setCurrentGradientHexColors(sectionGradients[activeSection]);
        }
      } else if (
        JSON.stringify(currentGradientHexColors) !==
        JSON.stringify(["#191414", "#191414", "#191414", "#191414"])
      ) {
      }
    },
    [activeSection, filterColors, hexToRgb, rgbToHex],
  );

  return {
    gradientHexColors: currentGradientHexColors,
    updateGradientColors,
    generateMeshGradient,
    gradientTransitionDurationMs,
    initialMeshGradient,
  };
}
