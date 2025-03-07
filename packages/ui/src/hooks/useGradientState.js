import { useState, useEffect, useCallback } from "react";

export function useGradientState() {
  const [currentColor1, setCurrentColor1] = useState("#191414");
  const [currentColor2, setCurrentColor2] = useState("#191414");
  const [currentColor3, setCurrentColor3] = useState("#191414");
  const [currentColor4, setCurrentColor4] = useState("#191414");
  const [targetColor1, setTargetColor1] = useState("#191414");
  const [targetColor2, setTargetColor2] = useState("#191414");
  const [targetColor3, setTargetColor3] = useState("#191414");
  const [targetColor4, setTargetColor4] = useState("#191414");
  const [transitionSpeed] = useState(30);

  const hexToRgb = (hex) => {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = ({ r, g, b }) => {
    const toHex = (n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
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

  const generateMeshGradient = useCallback((colors) => {
    if (!colors || colors.length === 0) return "#191414";

    const positions = ["at 0% 25%", "at 25% 0%", "at 100% 75%", "at 75% 100%"];
    const radialGradients = positions.map((position, index) => {
      const color = colors[index % colors.length];
      return `radial-gradient(${position}, ${color} 0%, transparent 80%)`;
    });

    return radialGradients.join(", ");
  }, []);

  const updateGradientColors = useCallback(() => {
    const authColors = ["#2C1E3D", "#532E5D", "#8D5DA7", "#B98BC9"];

    setTargetColor1(authColors[0]);
    setTargetColor2(authColors[1]);
    setTargetColor3(authColors[2]);
    setTargetColor4(authColors[3]);
  }, []);

  return {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    setTargetColor1,
    setTargetColor2,
    setTargetColor3,
    setTargetColor4,
    generateMeshGradient,
    updateGradientColors,
  };
}
