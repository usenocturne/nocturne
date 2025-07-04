import React, { useEffect } from "react";
import { generateAllFontFaces } from "../../constants/fonts";

const FontLoader = () => {
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("id", "font-styles");
    styleEl.textContent = generateAllFontFaces();
    document.head.appendChild(styleEl);

    const loadFonts = async () => {
      try {
        const fontLoadPromises = [
          document.fonts.load("400 16px Inter"),
          document.fonts.load("500 16px Inter"),
          document.fonts.load("600 16px Inter"), 
          document.fonts.load("700 16px Inter"),
          document.fonts.load("400 16px 'Noto Sans SC'"),
          document.fonts.load("400 16px 'Noto Sans TC'"),
          document.fonts.load("400 16px 'Noto Serif JP'"),
          document.fonts.load("400 16px 'Noto Serif KR'"),
          document.fonts.load("400 16px 'Noto Naskh AR'"),
          document.fonts.load("400 16px 'Noto Sans BN'"),
          document.fonts.load("400 16px 'Noto Sans DV'"),
          document.fonts.load("400 16px 'Noto Sans GK'"),
          document.fonts.load("400 16px 'Noto Sans HE'"),
          document.fonts.load("400 16px 'Noto Sans TA'"),
          document.fonts.load("400 16px 'Noto Sans TH'"),
          document.fonts.load("400 16px 'Noto Color Emoji'"),
        ];

        await Promise.all(fontLoadPromises);
      } catch (error) {
        console.warn("Font loading failed, continuing anyway:", error);
      }
    };

    loadFonts();

    return () => {
      const existingStyle = document.getElementById("font-styles");
      if (existingStyle) {
        document.head.removeChild(existingStyle);
      }
    };
  }, []);

  return null;
};

export default FontLoader;
