import { useState, useEffect, useCallback } from "react";
import ColorThief from "color-thief-browser";

export function useGradientState(activeSection) {
  const [colors, setColors] = useState([]);
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
  });
  const [transitionSpeed] = useState(30);

  const hexToRgb = (hex) => {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = ({ r, g, b }) => {
    const toHex = (n) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const getNextColor = (current, target) => {
    const step = (start, end) => {
      if (start === end) return start;
      const diff = end - start;
      return start + (diff > 0 ? Math.min(1, diff) : Math.max(-1, diff));
    };

    return {
      r: step(current.r, target.r),
      g: step(current.g, target.g),
      b: step(current.b, target.b),
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

      if (
        nextColor1.r === target1.r &&
        nextColor1.g === target1.g &&
        nextColor1.b === target1.b &&
        nextColor2.r === target2.r &&
        nextColor2.g === target2.g &&
        nextColor2.b === target2.b &&
        nextColor3.r === target3.r &&
        nextColor3.g === target3.g &&
        nextColor3.b === target3.b &&
        nextColor4.r === target4.r &&
        nextColor4.g === target4.g &&
        nextColor4.b === target4.b
      ) {
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
  ]);

  const calculateBrightness = useCallback((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }, []);

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

  const extractColors = useCallback(
    (imageUrl) => {
      const colorThief = new ColorThief();
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      img.onload = () => {
        const palette = colorThief.getPalette(img, 8);
        const filteredColors = palette
          .map(
            (color) =>
              `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`
          )
          .filter((color) => {
            const brightness = calculateBrightness(color);
            return brightness > 120 || brightness < 10;
          })
          .sort((a, b) => calculateHue(a) - calculateHue(b));

        setColors(filteredColors);
      };
    },
    [calculateBrightness, calculateHue]
  );

  const updateGradientColors = useCallback(
    (imageUrl, section = null) => {
      if (!imageUrl) {
        if (section === "radio") {
          const radioColors = ["#d5f2c0", "#daf4c7", "#da90c9", "#db3dcb"];
          setSectionGradients((prev) => ({ ...prev, [section]: radioColors }));
          if (activeSection === "radio" || activeSection === "nowPlaying") {
            setTargetColor1(radioColors[0]);
            setTargetColor2(radioColors[1]);
            setTargetColor3(radioColors[2]);
            setTargetColor4(radioColors[3]);
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
        } else if (section === "settings") {
          const settingsColors = ["#1f1e23", "#aeb7ba", "#8c6764", "#968479"];
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
        } else {
          setTargetColor1("#191414");
          setTargetColor2("#191414");
          setTargetColor3("#191414");
          setTargetColor4("#191414");
        }
        return;
      }

      const colorThief = new ColorThief();
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      img.onload = () => {
        const dominantColors = colorThief.getPalette(img, 4);
        const hexColors = dominantColors.map(
          (color) =>
            `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`
        );

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
          activeSection === "nowPlaying"
        ) {
          setTargetColor1(hexColors[0]);
          setTargetColor2(hexColors[1]);
          setTargetColor3(hexColors[2]);
          setTargetColor4(hexColors[3]);
        }
      };
    },
    [activeSection]
  );

  return {
    colors,
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    targetColor1,
    targetColor2,
    targetColor3,
    targetColor4,
    sectionGradients,
    setColors,
    setCurrentColor1,
    setCurrentColor2,
    setCurrentColor3,
    setCurrentColor4,
    setTargetColor1,
    setTargetColor2,
    setTargetColor3,
    setTargetColor4,
    setSectionGradients,
    calculateBrightness,
    calculateHue,
    extractColors,
    updateGradientColors,
    generateMeshGradient,
  };
}
