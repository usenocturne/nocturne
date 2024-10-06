import { useState, useEffect } from "react";
import Link from "next/link";

const LongPressLink = ({ href, children, spotifyUrl, accessToken }) => {
  const [pressTimer, setPressTimer] = useState(null);

  const startPress = () => {
    setPressTimer(
      setTimeout(() => {
        window.open(spotifyUrl, "_blank");
      }, 3000)
    );
  };

  const endPress = () => {
    clearTimeout(pressTimer);
  };

  useEffect(() => {
    return () => {
      if (pressTimer) clearTimeout(pressTimer);
    };
  }, [pressTimer]);

  return (
    <Link href={`${href}?accessToken=${accessToken}`}>
      <div
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onMouseDown={startPress}
        onMouseUp={endPress}
        onMouseLeave={endPress}
      >
        {children}
      </div>
    </Link>
  );
};

export default LongPressLink;
