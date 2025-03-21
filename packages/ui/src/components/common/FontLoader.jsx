import React, { useEffect } from "react";
import { generateAllFontFaces } from "../../constants/fonts";

const FontLoader = () => {
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("id", "font-styles");

    styleEl.textContent = generateAllFontFaces();

    document.head.appendChild(styleEl);

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
