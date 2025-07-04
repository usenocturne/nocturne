export function createFontFace(fontFamily, fontFiles) {
  const fontFaceDefinitions = fontFiles.map(({ path, weight, style }) => {
    return `
        @font-face {
          font-family: '${fontFamily}';
          src: url('${path}') format('woff2');
          font-weight: ${weight};
          font-style: ${style};
          font-display: swap;
        }
      `;
  });

  return fontFaceDefinitions.join("\n");
}

export const interFontConfig = {
  name: "Inter",
  variable: "--font-inter",
  files: [
    {
      path: "/fonts/Inter-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "/fonts/Inter-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "/fonts/Inter-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "/fonts/Inter-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
};

export const notoSansSCConfig = {
  name: "Noto Sans SC",
  variable: "--font-noto-sans-sc",
  files: [
    {
      path: "/fonts/NotoSansSC-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansTCConfig = {
  name: "Noto Sans TC",
  variable: "--font-noto-sans-tc",
  files: [
    {
      path: "/fonts/NotoSansTC-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSerifJPConfig = {
  name: "Noto Serif JP",
  variable: "--font-noto-serif-jp",
  files: [
    {
      path: "/fonts/NotoSerifJP-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSerifKRConfig = {
  name: "Noto Serif KR",
  variable: "--font-noto-sans-kr",
  files: [
    {
      path: "/fonts/NotoSerifKR-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoNaskhARConfig = {
  name: "Noto Naskh AR",
  variable: "--font-noto-naskh-ar",
  files: [
    {
      path: "/fonts/NotoNaskhAR-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansBNConfig = {
  name: "Noto Sans BN",
  variable: "--font-noto-sans-bn",
  files: [
    {
      path: "/fonts/NotoSansBN-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansDVConfig = {
  name: "Noto Sans DV",
  variable: "--font-noto-sans-dv",
  files: [
    {
      path: "/fonts/NotoSansDV-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansGKConfig = {
  name: "Noto Sans GK",
  variable: "--font-noto-sans-gk",
  files: [
    {
      path: "/fonts/NotoSansGK-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansHEConfig = {
  name: "Noto Sans HE",
  variable: "--font-noto-sans-he",
  files: [
    {
      path: "/fonts/NotoSansHE-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansTAConfig = {
  name: "Noto Sans TA",
  variable: "--font-noto-sans-ta",
  files: [
    {
      path: "/fonts/NotoSansTA-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoSansTHConfig = {
  name: "Noto Sans TH",
  variable: "--font-noto-sans-th",
  files: [
    {
      path: "/fonts/NotoSansTH-VF.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
};

export const notoColorEmojiConfig = {
  name: "Noto Color Emoji",
  variable: "--font-noto-color-emoji",
  files: [
    {
      path: "/fonts/NotoColorEmoji-Regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
};

export function detectTextScript(text) {
  if (!text) return "latin";

  const scripts = {
    chinese:
      /[\u4E00-\u9FFF\u3400-\u4DBF\u20000-\u2A6DF\u2A700-\u2B73F\u2B740-\u2B81F]/,
    traditionalChinese: /[\u4E00-\u9FFF]/,
    japanese: /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/,
    korean: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
    arabic:
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
    devanagari: /[\u0900-\u097F]/,
    hebrew: /[\u0590-\u05FF]/,
    bengali: /[\u0980-\u09FF]/,
    tamil: /[\u0B80-\u0BFF]/,
    thai: /[\u0E00-\u0E7F]/,
    gurmukhi: /[\u0A00-\u0A7F]/,
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
    hebrew: /[\u0590-\u05FF]/,
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
  latin: `var(--font-inter), var(--font-noto-color-emoji)`,
  chinese: `var(--font-noto-sans-sc), var(--font-inter), var(--font-noto-color-emoji)`,
  traditionalChinese: `var(--font-noto-sans-tc), var(--font-inter), var(--font-noto-color-emoji)`,
  japanese: `var(--font-noto-serif-jp), var(--font-inter), var(--font-noto-color-emoji)`,
  korean: `var(--font-noto-sans-kr), var(--font-inter), var(--font-noto-color-emoji)`,
  arabic: `var(--font-noto-naskh-ar), var(--font-inter), var(--font-noto-color-emoji)`,
  devanagari: `var(--font-noto-sans-dv), var(--font-inter), var(--font-noto-color-emoji)`,
  hebrew: `var(--font-noto-sans-he), var(--font-inter), var(--font-noto-color-emoji)`,
  bengali: `var(--font-noto-sans-bn), var(--font-inter), var(--font-noto-color-emoji)`,
  tamil: `var(--font-noto-sans-ta), var(--font-inter), var(--font-noto-color-emoji)`,
  thai: `var(--font-noto-sans-th), var(--font-inter), var(--font-noto-color-emoji)`,
  gurmukhi: `var(--font-noto-sans-gk), var(--font-inter), var(--font-noto-color-emoji)`,
};

export function generateAllFontFaces() {
  return `
      ${createFontFace(interFontConfig.name, interFontConfig.files)}
      ${createFontFace(notoSansSCConfig.name, notoSansSCConfig.files)}
      ${createFontFace(notoSansTCConfig.name, notoSansTCConfig.files)}
      ${createFontFace(notoSerifJPConfig.name, notoSerifJPConfig.files)}
      ${createFontFace(notoSerifKRConfig.name, notoSerifKRConfig.files)}
      ${createFontFace(notoNaskhARConfig.name, notoNaskhARConfig.files)}
      ${createFontFace(notoSansBNConfig.name, notoSansBNConfig.files)}
      ${createFontFace(notoSansDVConfig.name, notoSansDVConfig.files)}
      ${createFontFace(notoSansGKConfig.name, notoSansGKConfig.files)}
      ${createFontFace(notoSansHEConfig.name, notoSansHEConfig.files)}
      ${createFontFace(notoSansTAConfig.name, notoSansTAConfig.files)}
      ${createFontFace(notoSansTHConfig.name, notoSansTHConfig.files)}
      ${createFontFace(notoColorEmojiConfig.name, notoColorEmojiConfig.files)}
      
      :root {
        ${interFontConfig.variable}: ${interFontConfig.name}, sans-serif;
        ${notoSansSCConfig.variable}: ${notoSansSCConfig.name}, sans-serif;
        ${notoSansTCConfig.variable}: ${notoSansTCConfig.name}, sans-serif;
        ${notoSerifJPConfig.variable}: ${notoSerifJPConfig.name}, serif;
        ${notoSerifKRConfig.variable}: ${notoSerifKRConfig.name}, serif;
        ${notoNaskhARConfig.variable}: ${notoNaskhARConfig.name}, serif;
        ${notoSansBNConfig.variable}: ${notoSansBNConfig.name}, sans-serif;
        ${notoSansDVConfig.variable}: ${notoSansDVConfig.name}, sans-serif;
        ${notoSansGKConfig.variable}: ${notoSansGKConfig.name}, sans-serif;
        ${notoSansHEConfig.variable}: ${notoSansHEConfig.name}, sans-serif;
        ${notoSansTAConfig.variable}: ${notoSansTAConfig.name}, sans-serif;
        ${notoSansTHConfig.variable}: ${notoSansTHConfig.name}, sans-serif;
        ${notoColorEmojiConfig.variable}: ${notoColorEmojiConfig.name}, sans-serif;
      }
    `;
}
