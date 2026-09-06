/// <reference types="vite/client" />

interface Window {
  carThingVolumeUp?: () => void;
  carThingVolumeDown?: () => void;
  carThingShowVolume?: () => void;
  carThingRootStore?: import("./mockingbird/ui/stores/RootStore").RootStore;
  testShelf?: import("./mockingbird/ui/stores/RootStore").RootStore["shelfStore"];
  testPresets?: import("./mockingbird/ui/stores/RootStore").RootStore["presetsController"];
  showPresets?: () => void;
  testHardware?: {
    dialPress: () => void;
    dialLeft: () => void;
    dialRight: () => void;
    getCurrentSelection: () =>
      | import("./mockingbird/ui/stores/RootStore").RootStore["shelfStore"]["shelfController"]["swiperUiState"]["allShelfItems"][number]
      | undefined;
  };
  umami?: {
    track?: (event: string, data?: Record<string, unknown>) => void;
  };
  scrubbingHardwareDialHandler?: (direction: "left" | "right") => void;
  scrubbingCommit?: () => void | Promise<void>;
  carThingSkipNext?: () => void | Promise<void>;
  carThingSkipPrev?: () => void | Promise<void>;
}

interface Document {
  rootStore?: import("./mockingbird/ui/stores/RootStore").RootStore;
}

declare module "*.module.scss" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.scss";

declare module "swiper/css";
declare module "swiper/scss";
declare module "swiper/scss/*";
