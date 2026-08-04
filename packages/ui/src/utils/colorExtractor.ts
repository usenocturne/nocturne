type ColorPalette = [string, string, string, string] | string[];
type ImageFetchResult = { data?: ImageInput };
type ImageInput = string | ArrayBuffer | Uint8Array;

const FALLBACK_COLORS: ColorPalette = [
  "#191414",
  "#1E1B1B",
  "#222222",
  "#1A1A1A",
];

export function extractColorsFromImageUrl(
  imageUrl: string,
  fetchImageFn?: (
    imageUrl: string,
  ) => Promise<ImageFetchResult | null | undefined>,
): Promise<ColorPalette> {
  return new Promise(async (resolve) => {
    if (!fetchImageFn) {
      resolve(extractColorsFromImage(imageUrl));
      return;
    }

    try {
      const result = await fetchImageFn(imageUrl);
      if (result && result.data) {
        const colors = await extractColorsFromImageData(result.data);
        resolve(colors);
      } else {
        resolve(FALLBACK_COLORS);
      }
    } catch (error) {
      console.error("Error extracting colors from websocket image:", error);
      resolve(FALLBACK_COLORS);
    }
  });
}

export function extractColorsFromImage(
  imageUrl: string,
): Promise<ColorPalette> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        resolve(extractColorsFromCanvasImage(img));
      } catch (err) {
        resolve(FALLBACK_COLORS);
        console.error("Error extracting colors:", err);
      }
    };

    img.onerror = () => {
      resolve(FALLBACK_COLORS);
    };

    img.src = imageUrl;
  });
}

export function extractColorsFromImageData(
  imageData: ImageInput,
): Promise<ColorPalette> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      let objectUrl: string | null = null;

      img.onload = () => {
        try {
          const colors = extractColorsFromCanvasImage(img);
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
          resolve(colors);
        } catch (err) {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
          resolve(FALLBACK_COLORS);
          console.error("Error extracting colors from image data:", err);
        }
      };

      img.onerror = () => {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        resolve(FALLBACK_COLORS);
      };

      if (typeof imageData === "string") {
        if (
          imageData.startsWith("data:") ||
          imageData.startsWith("blob:") ||
          imageData.startsWith("http")
        ) {
          img.src = imageData;
        } else {
          img.src = `data:image/jpeg;base64,${imageData}`;
        }
      } else if (imageData instanceof ArrayBuffer) {
        const blob = new Blob([imageData], { type: "image/jpeg" });
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      } else if (imageData instanceof Uint8Array) {
        const bytes = imageData.buffer.slice(
          imageData.byteOffset,
          imageData.byteOffset + imageData.byteLength,
        ) as ArrayBuffer;
        const blob = new Blob([bytes], { type: "image/jpeg" });
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      } else {
        img.src = String(imageData);
      }
    } catch (error) {
      resolve(FALLBACK_COLORS);
      console.error("Error processing image data for color extraction:", error);
    }
  });
}

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

function extractColorsFromCanvasImage(img: CanvasImageSource): ColorPalette {
  if (!_canvas) {
    _canvas = document.createElement("canvas");
    _ctx = _canvas.getContext("2d", { willReadFrequently: true });
  }
  const canvas = _canvas;
  const ctx = _ctx;
  if (!ctx) {
    return FALLBACK_COLORS;
  }

  const size = 100;
  canvas.width = size;
  canvas.height = size;

  ctx.drawImage(img, 0, 0, size, size);

  const imageData = ctx.getImageData(0, 0, size, size);
  const d = imageData.data;

  const pixel = (col: number, row: number): [number, number, number] => {
    const idx = (row * size + col) * 4;
    return [d[idx], d[idx + 1], d[idx + 2]];
  };

  const colorSamples: Array<{
    r: number;
    g: number;
    b: number;
    brightness: number;
  }> = [];
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 5; y++) {
      const col = Math.floor((x * size) / 5);
      const row = Math.floor((y * size) / 5);
      const [r, g, b] = pixel(col, row);
      colorSamples.push({
        r,
        g,
        b,
        brightness: 0.299 * r + 0.587 * g + 0.114 * b,
      });
    }
  }

  colorSamples.sort((a, b) => b.brightness - a.brightness);

  const brightColors = colorSamples.slice(0, 5);
  const midColors = colorSamples.slice(
    Math.floor(colorSamples.length / 2) - 2,
    Math.floor(colorSamples.length / 2) + 3,
  );
  const darkColors = colorSamples.slice(-5);

  const selectedColors = [
    brightColors[0],
    midColors[0],
    midColors[2],
    darkColors[0],
  ].map(
    (color) =>
      `#${color.r.toString(16).padStart(2, "0")}${color.g
        .toString(16)
        .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`,
  );

  return selectedColors;
}
