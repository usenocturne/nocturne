import { useState, useEffect, useCallback, useRef } from "react";
import { extractColorsFromImage } from "../utils/colorExtractor";

export function useGradientTransition(activeSection) {
  const [currentColor1, setCurrentColor1] = useState("#191414");
  const [currentColor2, setCurrentColor2] = useState("#191414");
  const [currentColor3, setCurrentColor3] = useState("#191414");
  const [currentColor4, setCurrentColor4] = useState("#191414");
  const [targetColor1, setTargetColor1] = useState("#191414");
  const [targetColor2, setTargetColor2] = useState("#191414");
  const [targetColor3, setTargetColor3] = useState("#191414");
  const [targetColor4, setTargetColor4] = useState("#191414");
  const [sectionGradients, setSectionGradients] = useState({
    recents: null,
    library: null,
    artists: null,
    radio: null,
    nowPlaying: null,
  });
  const [transitionSpeed] = useState(30);

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

  const getNextColor = (current, target) => {
    const easeStep = (start, end) => {
      if (Math.abs(start - end) < 1) return end;
      const diff = end - start;
      return start + diff * 0.05;
    };

    return {
      r: easeStep(current.r, target.r),
      g: easeStep(current.g, target.g),
      b: easeStep(current.b, target.b),
    };
  };

  useEffect(() => {
    const current1 = hexToRgb(currentColor1);
    const current2 = hexToRgb(currentColor2);
    const current3 = hexToRgb(currentColor3);
    const current4 = hexToRgb(currentColor4);

    const target1 = hexToRgb(targetColor1);
    const target2 = hexToRgb(targetColor2);
    const target3 = hexToRgb(targetColor3);
    const target4 = hexToRgb(targetColor4);

    const intervalId = setInterval(() => {
      const nextColor1 = getNextColor(current1, target1);
      const nextColor2 = getNextColor(current2, target2);
      const nextColor3 = getNextColor(current3, target3);
      const nextColor4 = getNextColor(current4, target4);

      setCurrentColor1(rgbToHex(nextColor1));
      setCurrentColor2(rgbToHex(nextColor2));
      setCurrentColor3(rgbToHex(nextColor3));
      setCurrentColor4(rgbToHex(nextColor4));

      current1.r = nextColor1.r;
      current1.g = nextColor1.g;
      current1.b = nextColor1.b;

      current2.r = nextColor2.r;
      current2.g = nextColor2.g;
      current2.b = nextColor2.b;

      current3.r = nextColor3.r;
      current3.g = nextColor3.g;
      current3.b = nextColor3.b;

      current4.r = nextColor4.r;
      current4.g = nextColor4.g;
      current4.b = nextColor4.b;

      const allReachedTarget =
        Math.abs(nextColor1.r - target1.r) < 1 &&
        Math.abs(nextColor1.g - target1.g) < 1 &&
        Math.abs(nextColor1.b - target1.b) < 1 &&
        Math.abs(nextColor2.r - target2.r) < 1 &&
        Math.abs(nextColor2.g - target2.g) < 1 &&
        Math.abs(nextColor2.b - target2.b) < 1 &&
        Math.abs(nextColor3.r - target3.r) < 1 &&
        Math.abs(nextColor3.g - target3.g) < 1 &&
        Math.abs(nextColor3.b - target3.b) < 1 &&
        Math.abs(nextColor4.r - target4.r) < 1 &&
        Math.abs(nextColor4.g - target4.g) < 1 &&
        Math.abs(nextColor4.b - target4.b) < 1;

      if (allReachedTarget) {
        clearInterval(intervalId);
      }
    }, transitionSpeed);

    return () => clearInterval(intervalId);
  }, [
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    targetColor1,
    targetColor2,
    targetColor3,
    targetColor4,
    transitionSpeed,
    hexToRgb,
    rgbToHex,
  ]);

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
    [MAX_BRIGHTNESS_THRESHOLD, hexToRgb, rgbToHex]
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
    if (!colors || colors.length === 0) return "#191414";

    const positions = ["at 0% 25%", "at 25% 0%", "at 100% 75%", "at 75% 100%"];
    const radialGradients = positions.map((position, index) => {
      const color = colors[index % colors.length];
      return `radial-gradient(${position}, ${color} 0%, transparent 80%)`;
    });

    return radialGradients.join(", ");
  }, []);

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
    [calculateBrightness]
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
    [hexToRgb, rgbToHex]
  );

  const filterColors = useCallback(
    (colors) => {
      if (!colors || colors.length === 0) return colors;

      const brightnessLimitedColors = colors.map((color) =>
        limitColorBrightness(color)
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
        (c) => c.brightness >= 60 && c.brightness <= 120
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
    ]
  );

  const updateGradientColors = useCallback(
    async (imageUrl, section = null) => {
      const skipCacheCheck = section === "nowPlaying" || section === "recents";

      const urlSectionKey = `${imageUrl || "none"}-${section || "none"}`;
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
      lastProcessedSectionRef.current = section || "none";

      if (!imageUrl) {
        if (section === "radio") {
          const radioColors = ["#3B518B", "#202F57", "#142045", "#151231"];
          setSectionGradients((prev) => ({ ...prev, [section]: radioColors }));

          if (activeSection === "radio" || activeSection === "nowPlaying") {
            setTargetColor1(radioColors[0]);
            setTargetColor2(radioColors[1]);
            setTargetColor3(radioColors[2]);
            setTargetColor4(radioColors[3]);
          }
        } else if (section === "settings") {
          const settingsColors = ["#3B518B", "#202F57", "#142045", "#151231"];
          setSectionGradients((prev) => ({
            ...prev,
            [section]: settingsColors,
          }));

          if (activeSection === "settings") {
            setTargetColor1(settingsColors[0]);
            setTargetColor2(settingsColors[1]);
            setTargetColor3(settingsColors[2]);
            setTargetColor4(settingsColors[3]);
          }
        } else if (section === "library") {
          const libraryColors = ["#7662e9", "#a9c1de", "#8f90e3", "#5b30ef"];
          setSectionGradients((prev) => ({
            ...prev,
            [section]: libraryColors,
          }));

          if (activeSection === "library") {
            setTargetColor1(libraryColors[0]);
            setTargetColor2(libraryColors[1]);
            setTargetColor3(libraryColors[2]);
            setTargetColor4(libraryColors[3]);
          }
        } else if (section === "auth") {
          const authColors = ["#3B518B", "#202F57", "#142045", "#151231"];
          setSectionGradients((prev) => ({ ...prev, [section]: authColors }));

          setTargetColor1(authColors[0]);
          setTargetColor2(authColors[1]);
          setTargetColor3(authColors[2]);
          setTargetColor4(authColors[3]);
        } else {
          setTargetColor1("#191414");
          setTargetColor2("#191414");
          setTargetColor3("#191414");
          setTargetColor4("#191414");
        }
        return;
      }

      try {
        let hexColors = await extractColorsFromImage(imageUrl);

        hexColors = filterColors(hexColors);

        if (section) {
          setSectionGradients((prev) => ({
            ...prev,
            [section]: hexColors,
          }));
        }

        if (
          !section ||
          section === activeSection ||
          section === "nowPlaying" ||
          activeSection === "nowPlaying" ||
          section === "album" ||
          section === "playlist" ||
          section === "artist" ||
          section === "mix" ||
          section === "liked-songs"
        ) {
          setTargetColor1(hexColors[0]);
          setTargetColor2(hexColors[1]);
          setTargetColor3(hexColors[2]);
          setTargetColor4(hexColors[3]);
        }
      } catch (error) {
        console.error("Error updating gradient colors:", error);

        setTargetColor1("#191414");
        setTargetColor2("#191414");
        setTargetColor3("#191414");
        setTargetColor4("#191414");
      }
    },
    [activeSection, filterColors]
  );

  return {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    targetColor1,
    targetColor2,
    targetColor3,
    targetColor4,
    sectionGradients,
    setTargetColor1,
    setTargetColor2,
    setTargetColor3,
    setTargetColor4,
    calculateBrightness,
    calculateHue,
    updateGradientColors,
    generateMeshGradient,
  };
}
