export function extractColorsFromImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const size = 150;
        canvas.width = size;
        canvas.height = size;

        ctx.drawImage(img, 0, 0, size, size);

        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;

        const colorCounts = new Map();
        const step = 4;

        for (let i = 0; i < data.length; i += step * 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const alpha = data[i + 3];

          if (alpha < 128 || (r > 240 && g > 240 && b > 240)) continue;

          const qr = Math.floor(r / 16) * 16;
          const qg = Math.floor(g / 16) * 16;
          const qb = Math.floor(b / 16) * 16;

          const colorKey = `${qr},${qg},${qb}`;
          colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);
        }

        const sortedColors = Array.from(colorCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([color, count]) => {
            const [r, g, b] = color.split(",").map(Number);
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            const saturation = Math.max(r, g, b) - Math.min(r, g, b);
            return { r, g, b, brightness, saturation, count };
          })
          .filter((color) => {
            return color.brightness > 50 && color.brightness < 200;
          });

        if (sortedColors.length === 0) {
          resolve([[26, 26, 26]]);
          return;
        }

        sortedColors.sort((a, b) => {
          const aScore =
            a.saturation * 0.6 + a.brightness * 0.2 + a.count * 0.2;
          const bScore =
            b.saturation * 0.6 + b.brightness * 0.2 + b.count * 0.2;
          return bScore - aScore;
        });

        const dominantColor = sortedColors[0] || { r: 26, g: 26, b: 26 };
        const darkened = {
          r: Math.max(0, Math.floor(dominantColor.r * 0.3)),
          g: Math.max(0, Math.floor(dominantColor.g * 0.3)),
          b: Math.max(0, Math.floor(dominantColor.b * 0.3)),
        };

        const selectedColors = [
          dominantColor,
          darkened,
          sortedColors[1] || dominantColor,
          sortedColors[2] || dominantColor,
        ].map(
          (color) =>
            `#${color.r.toString(16).padStart(2, "0")}${color.g
              .toString(16)
              .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`,
        );

        resolve(selectedColors);
      } catch (err) {
        console.error("Error extracting colors:", err);
        resolve(["#191414", "#1E1B1B", "#222222", "#1A1A1A"]);
      }
    };

    img.onerror = (error) => {
      console.warn(
        "ColorExtractor: Image load error:",
        error,
        "for URL:",
        imageUrl,
      );
      resolve(["#191414", "#1E1B1B", "#222222", "#1A1A1A"]);
    };

    img.src = imageUrl;
  });
}

export function getBackgroundColor(imageBase64) {
  return extractColorsFromImage(`data:image/jpeg;base64,${imageBase64}`)
    .then((colors) => {
      const darkColor = colors[1];
      if (darkColor.startsWith("#")) {
        const r = parseInt(darkColor.slice(1, 3), 16);
        const g = parseInt(darkColor.slice(3, 5), 16);
        const b = parseInt(darkColor.slice(5, 7), 16);
        return [r, g, b];
      }
      return [26, 26, 26];
    })
    .catch(() => [26, 26, 26]);
}
