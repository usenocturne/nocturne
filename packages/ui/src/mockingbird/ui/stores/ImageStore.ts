import type { RootStore } from "./RootStore";
import type { InterappActions, MiddlewareActions } from "./StoreContracts";
import { makeAutoObservable, ObservableMap, runInAction } from "mobx";
import { extractColorsFromImage } from "../utils/colorExtractor";
import { resolveImageUrl } from "../utils/imageProxy";

export const ImageScale = {
  BIG: 248,
  SMALL: 96,
};

class ImageStore {
  declare colors: ObservableMap<string, number[]>;
  declare images: ObservableMap<string, string>;
  declare pendingColors: ObservableMap<string, string>;
  declare requestedColors: ObservableMap<string, string>;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  constructor(rootStore: RootStore, interappActions: InterappActions) {
    this.rootStore = rootStore;
    this.interappActions = interappActions;

    makeAutoObservable(this, {
      rootStore: false,
      interappActions: false,
    });

    this.images = new ObservableMap();
    this.colors = new ObservableMap();
    this.pendingColors = new ObservableMap();
    this.requestedColors = new ObservableMap();
  }

  getImage(url: string | null | undefined, scale = ImageScale.BIG) {
    return url || "";
  }

  getBackgroundColor(imageUrl: string) {
    const color = this.colors.get(imageUrl);
    if (color) {
      return Array.isArray(color) ? `rgb(${color.join(",")})` : color;
    }
    return "#1a1a1a";
  }

  preloadImage(url: string | null | undefined, scale = ImageScale.BIG) {
    if (!url) return Promise.resolve("");

    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(url);
      img.crossOrigin = "anonymous";
      img.src = url;
    });
  }

  setColorRequested(imageUrl: string) {
    this.requestedColors.set(imageUrl, "requested");
  }

  setColorPending(imageUrl: string) {
    this.pendingColors.set(imageUrl, "pending");
  }

  shouldCalculateColor(imageUrl: string) {
    return (
      imageUrl &&
      !this.colors.has(imageUrl) &&
      !this.pendingColors.has(imageUrl)
    );
  }

  async loadColor(imageUrl: string) {
    if (!imageUrl) {
      return;
    }

    if (this.shouldCalculateColor(imageUrl)) {
      this.setColorPending(imageUrl);

      try {
        const resolvedUrl = await resolveImageUrl(imageUrl);
        if (!resolvedUrl) {
          throw new Error("Image proxy returned null");
        }
        const colors = await extractColorsFromImage(resolvedUrl);

        const extractedColor = colors[1];
        let backgroundColor: number[];
        if (extractedColor && extractedColor.startsWith("#")) {
          const r = parseInt(extractedColor.slice(1, 3), 16);
          const g = parseInt(extractedColor.slice(3, 5), 16);
          const b = parseInt(extractedColor.slice(5, 7), 16);
          backgroundColor = [r, g, b];
        } else {
          backgroundColor = [26, 26, 26];
        }

        runInAction(() => {
          this.pendingColors.delete(imageUrl);
          this.requestedColors.delete(imageUrl);
          this.colors.set(imageUrl, backgroundColor);
        });
      } catch (error) {
        console.warn("ImageStore: Failed to extract color from image:", error);
        runInAction(() => {
          this.pendingColors.delete(imageUrl);
          this.requestedColors.delete(imageUrl);
          const hash = this.hashCode(imageUrl);
          const hue = Math.abs(hash) % 360;
          const rgb = this.hslToRgb(hue / 360, 0.3, 0.2);
          this.colors.set(imageUrl, rgb);
        });
      }
    } else if (!this.colors.has(imageUrl)) {
      this.setColorRequested(imageUrl);

      const hash = this.hashCode(imageUrl);
      const hue = Math.abs(hash) % 360;
      const rgb = this.hslToRgb(hue / 360, 0.4, 0.25);
      runInAction(() => {
        this.colors.set(imageUrl, rgb);
      });
    }
  }

  hashCode(str: string) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }

  hslToRgb(h: number, s: number, l: number) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}

export default ImageStore;
