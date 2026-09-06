import { useEffect, useState, memo } from "react";
import SpotifyImage from "../SpotifyImage";
import {
  getActivePresetDeviceId,
  getButtonMappingValue,
} from "../../../utils/presetStorage";

type PresetArtwork = {
  image: string | null;
  type: string | null;
};

interface ButtonMappingOverlayProps {
  show: boolean;
  activeButton?: string | number | null;
}

const ButtonMappingOverlay = memo(function ButtonMappingOverlay({
  show,
  activeButton: externalActiveButton,
}: ButtonMappingOverlayProps) {
  const [artwork, setArtwork] = useState<PresetArtwork[]>([]);
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [internalActiveButton, setInternalActiveButton] = useState<
    string | number | null | undefined
  >(null);

  useEffect(() => {
    if (!show) return;

    const refresh = () => {
      const deviceId = getActivePresetDeviceId();
      const next = [1, 2, 3, 4].map((button) => ({
        image: getButtonMappingValue(button, "Image", deviceId),
        type: getButtonMappingValue(button, "Type", deviceId),
      }));
      setArtwork((previous) =>
        next.every(
          (entry, index) =>
            entry.image === previous[index]?.image &&
            entry.type === previous[index]?.type,
        )
          ? previous
          : next,
      );
    };

    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [show]);

  useEffect(() => {
    if (show) {
      setInternalActiveButton(externalActiveButton);
      setShouldRender(true);

      const fadeInTimer = setTimeout(() => {
        setIsVisible(true);
      }, 10);

      return () => clearTimeout(fadeInTimer);
    } else {
      setIsVisible(false);

      const unmountTimer = setTimeout(() => {
        setShouldRender(false);
        setInternalActiveButton(null);
      }, 300);

      return () => clearTimeout(unmountTimer);
    }
  }, [show, externalActiveButton]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center transition-opacity duration-300 ease-in-out ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/80" />
      <div className="relative w-[800px] pt-4 px-[23px]">
        <div
          className={
            isVisible ? "mapping-overlay-enter" : "mapping-overlay-exit"
          }
        >
          {[1, 2, 3, 4].map((buttonNum, index) => {
            const image = artwork[index]?.image;
            const contentType = artwork[index]?.type;
            const isArtist = contentType === "artist";
            const isActive = String(buttonNum) === String(internalActiveButton);
            const marginClass = index > 0 ? "ml-[40px]" : "";

            return (
              <div key={buttonNum} className={`relative ${marginClass}`}>
                <div className="flex flex-col items-center w-[160px]">
                  <div
                    className={`w-20 h-1.5 rounded-full mb-4 transition-colors duration-300 ${
                      isActive ? "bg-white" : "bg-white/25"
                    }`}
                    aria-hidden="true"
                  />
                  <div
                    className={`text-[28px] font-[560] mb-4 transition-colors duration-300 ${
                      isActive ? "text-white" : "text-white/60"
                    }`}
                  >
                    {buttonNum}
                  </div>
                  {image && (
                    <div className="aspect-square w-full p-1 transition-all duration-300">
                      <SpotifyImage
                        images={image}
                        priority={10}
                        alt={`Button ${buttonNum} mapping`}
                        className={`w-full h-full object-cover shadow-lg max-w-[152px] max-h-[152px] ${
                          isArtist ? "rounded-full" : "rounded-lg"
                        }`}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default ButtonMappingOverlay;
