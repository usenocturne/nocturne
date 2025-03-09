export function extractColorsFromImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const size = 100;
        canvas.width = size;
        canvas.height = size;

        ctx.drawImage(img, 0, 0, size, size);

        const colorSamples = [];
        for (let x = 0; x < 5; x++) {
          for (let y = 0; y < 5; y++) {
            const pixelData = ctx.getImageData(
              Math.floor((x * size) / 5),
              Math.floor((y * size) / 5),
              1,
              1
            ).data;
            colorSamples.push({
              r: pixelData[0],
              g: pixelData[1],
              b: pixelData[2],
              brightness:
                0.299 * pixelData[0] +
                0.587 * pixelData[1] +
                0.114 * pixelData[2],
            });
          }
        }

        colorSamples.sort((a, b) => b.brightness - a.brightness);

        const brightColors = colorSamples.slice(0, 5);
        const midColors = colorSamples.slice(
          Math.floor(colorSamples.length / 2) - 2,
          Math.floor(colorSamples.length / 2) + 3
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
              .padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`
        );

        resolve(selectedColors);
      } catch (err) {
        resolve(["#191414", "#1E1B1B", "#222222", "#1A1A1A"]);
        console.error("Error extracting colors:", err);
      }
    };

    img.onerror = () => {
      resolve(["#191414", "#1E1B1B", "#222222", "#1A1A1A"]);
    };

    img.src = imageUrl;
  });
}
