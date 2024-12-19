import localFont from "next/font/local";

export const inter = localFont({
  src: [
    {
      path: "../fonts/Inter-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/Inter-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../fonts/Inter-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/Inter-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-inter",
  preload: true,
  display: "swap",
});

export const notoSansSC = localFont({
  src: "../fonts/NotoSansSC-VF.woff2",
  variable: "--font-noto-sans-sc",
  preload: false,
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  unicode: [
    "\u4E00-\u9FFF",
    "\u3400-\u4DBF",
    "\u20000-\u2A6DF",
    "\u2A700-\u2B73F",
    "\u2B740-\u2B81F",
  ],
});

export const notoSerifJP = localFont({
  src: "../fonts/NotoSerifJP-VF.woff2",
  variable: "--font-noto-serif-jp",
  preload: false,
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  unicode: ["\u3040-\u309F", "\u30A0-\u30FF", "\u31F0-\u31FF"],
});

export const notoSansKR = localFont({
  src: "../fonts/NotoSerifKR-VF.woff2",
  variable: "--font-noto-sans-kr",
  preload: false,
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  unicode: ["\uAC00-\uD7AF", "\u1100-\u11FF", "\u3130-\u318F"],
});

export const notoNaskhAR = localFont({
  src: "../fonts/NotoNaskhAR-VF.woff2",
  variable: "--font-noto-naskh-ar",
  preload: false,
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  unicode: [
    "\u0600-\u06FF",
    "\u0750-\u077F",
    "\u08A0-\u08FF",
    "\uFB50-\uFDFF",
    "\uFE70-\uFEFF",
  ],
});

export const notoSansDV = localFont({
  src: "../fonts/NotoSansDV-VF.woff2",
  variable: "--font-noto-sans-dv",
  preload: false,
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  unicode: ["\u0900-\u097F"],
});

export function detectTextScript(text) {
  if (!text) return "latin";

  const scripts = {
    chinese: /[\u4E00-\u9FFF\u3400-\u4DBF]/,
    japanese: /[\u3040-\u309F\u30A0-\u30FF]/,
    korean: /[\uAC00-\uD7AF\u1100-\u11FF]/,
    arabic: /[\u0600-\u06FF\u0750-\u077F]/,
    devanagari: /[\u0900-\u097F]/,
  };

  for (const [script, regex] of Object.entries(scripts)) {
    if (regex.test(text)) return script;
  }

  return "latin";
}

export function getTextDirection(text) {
  const rtlScripts = {
    arabic:
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
  };

  for (const [script, regex] of Object.entries(rtlScripts)) {
    if (regex.test(text)) {
      return {
        direction: "rtl",
        script,
      };
    }
  }

  return {
    direction: "ltr",
    script: "latin",
  };
}

export const fontFamilyForScript = {
  latin: `var(--font-inter)`,
  chinese: `var(--font-noto-sans-sc), var(--font-inter)`,
  japanese: `var(--font-noto-serif-jp), var(--font-inter)`,
  korean: `var(--font-noto-sans-kr), var(--font-inter)`,
  arabic: `var(--font-noto-naskh-ar), var(--font-inter)`,
  devanagari: `var(--font-noto-sans-dv), var(--font-inter)`,
};

export function useDynamicFont(text) {
  const script = detectTextScript(text);
  return fontFamilyForScript[script] || fontFamilyForScript.latin;
}
