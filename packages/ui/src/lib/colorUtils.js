import ColorThief from "color-thief-browser";
export const calculateBrightness = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
export const calculateHue = (hex) => {
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
};
export const hexToRgb = (hex) => {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
};
export const rgbToHex = ({ r, g, b }) => {
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};
export const generateMeshGradient = (colors) => {
  if (colors.length === 0) return "#191414";
  const positions = ["at 0% 25%", "at 25% 0%", "at 100% 75%", "at 75% 100%"];
  const radialGradients = positions.map((position, index) => {
    const color = colors[index % colors.length];
    return `radial-gradient(${position}, ${color} 0%, transparent 80%)`;
  });
  return `${radialGradients.join(", ")}`;
};
export const getNextColor = (current, target) => {
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
export const extractPaletteFromImage = (imageUrl) => {
  return new Promise((resolve) => {
    const colorThief = new ColorThief();
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      const palette = colorThief.getPalette(img, 4);
      const hexColors = palette.map((color) =>
        rgbToHex({ r: color[0], g: color[1], b: color[2] })
      );
      resolve(hexColors);
    };
  });
};
export const extractFilteredColors = async (imageUrl, setColors) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageUrl;
  img.onload = () => {
    const palette = createPaletteFromImage(img);
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
};
export const createPaletteFromImage = (img) => {
  const colorThief = new ColorThief();
  return colorThief.getPalette(img, 8);
};