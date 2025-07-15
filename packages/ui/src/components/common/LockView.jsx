import { useEffect } from "react";
import { useCurrentTime } from "../../hooks/useCurrentTime";

export default function LockView({ onClose }) {
  const { currentTime } = useCurrentTime();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "m") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="flex items-center justify-center h-screen w-full z-10 fadeIn-animation text-white">
      <div className="text-[20vw] leading-none font-semibold tracking-tight">
        {currentTime}
      </div>
    </div>
  );
}
