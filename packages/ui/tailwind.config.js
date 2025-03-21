/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "var(--font-noto-sans-sc)",
          "var(--font-noto-sans-tc)",
          "var(--font-noto-serif-jp)",
          "var(--font-noto-sans-kr)",
          "var(--font-noto-naskh-ar)",
          "var(--font-noto-sans-bn)",
          "var(--font-noto-sans-dv)",
          "var(--font-noto-sans-he)",
          "var(--font-noto-sans-ta)",
          "var(--font-noto-sans-th)",
          "var(--font-noto-sans-gk)",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      letterSpacing: {
        tighter: "-0.05em",
        tight: "-0.05em",
        normal: "0",
        wide: "0.025em",
        wider: "0.05em",
        widest: "0.1em",
      },
    },
  },
  plugins: [],
};
