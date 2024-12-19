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
  display: "swap",
});

export const notoSansSC = localFont({
  src: "../fonts/NotoSansSC-VF.woff2",
  variable: "--font-noto-sans-sc",
});

export const notoSerifJP = localFont({
  src: "../fonts/NotoSerifJP-VF.woff2",
  variable: "--font-noto-sans-jp",
});

export const notoSansKR = localFont({
  src: "../fonts/NotoSerifKR-VF.woff2",
  variable: "--font-noto-sans-kr",
});

export const notoSerifKR = localFont({
  src: "../fonts/NotoSerifKR-VF.woff2",
  variable: "--font-noto-sans-kr",
});

export const notoNaskhAR = localFont({
  src: "../fonts/NotoNaskhAR-VF.woff2",
  variable: "--font-noto-naskh-ar",
});
