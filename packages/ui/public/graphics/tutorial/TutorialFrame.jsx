import React from "react";

const TutorialFrame = ({ currentScreen }) => {
  const getAnimationStyles = (elementType, buttonIndex) => {
    switch (currentScreen) {
      case 1:
        return elementType === "dial"
          ? {
              transform: "rotate(0deg)",
              animation:
                "spinInPlace 3s cubic-bezier(0.68, -0.6, 0.32, 1.6) infinite",
              transformBox: "fill-box",
              transformOrigin: "center",
            }
          : {};

      case 2:
        return elementType === "smallCircle"
          ? {
              animation: "pulse 2s ease-in-out infinite",
            }
          : {};

      case 3:
        return elementType === "presetButton"
          ? {
              animation: `pressButton 2s ease-in-out infinite`,
              animationDelay: `${buttonIndex * 2}s`,
              transformBox: "fill-box",
              transformOrigin: "bottom",
              willChange: "transform",
            }
          : {};

      case 4:
        return elementType === "presetButton"
          ? {
              animation: `quickPress 4s ease-in-out infinite`,
              animationDelay: `${buttonIndex * 1}s`,
              transformBox: "fill-box",
              transformOrigin: "bottom",
              willChange: "transform",
            }
          : {};

      case 5:
        return elementType === "brightnessButton"
          ? {
              animation: "quickPress 2s ease-in-out infinite",
              transformBox: "fill-box",
              transformOrigin: "bottom",
              willChange: "transform",
            }
          : {};

      case 6:
        return elementType === "dial"
          ? {
              transform: "rotate(0deg)",
              animation:
                "spinInPlace 3s cubic-bezier(0.68, -0.6, 0.32, 1.6) infinite",
              transformBox: "fill-box",
              transformOrigin: "center",
            }
          : {};

      case 8:
        if (elementType === "swipeIndicator") {
          return {
            animation: "swipeGestures 4s ease-in-out infinite",
            transformBox: "fill-box",
            transformOrigin: "center",
          };
        }
        return {};

      default:
        return {};
    }
  };

  return (
    <>
      <style>
        {`
          @keyframes spinInPlace {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
          
          @keyframes pressButton {
            0%, 100% { 
              transform: scaleY(1);
              fill: white;
              stroke: white;
            }
            50% { 
              transform: scaleY(0.5);
              fill: #7a7a7a;
              stroke: #7a7a7a;
            }
          }
          
          @keyframes quickPress {
            0%, 5%, 100% { 
              transform: scaleY(1);
              fill: white;
              stroke: white;
            }
            10% { 
              transform: scaleY(0.7);
              fill: #7a7a7a;
              stroke: #7a7a7a;
            }
            15% {
              transform: scaleY(1);
              fill: white;
              stroke: white;
            }
          }
          
          @keyframes volumeAdjust {
            0% { transform: rotate(-20deg); }
            50% { transform: rotate(20deg); }
            100% { transform: rotate(-20deg); }
          }

          @keyframes swipeGestures {
            0%, 20% { 
                transform: translateX(0);
            }
            30%, 45% { 
                transform: translateX(200px); /* Swipe right */
            }
            55%, 70% { 
                transform: translateX(-200px); /* Swipe left */
            }
            80%, 100% { 
                transform: translateX(0);
            }
          }
        `}
      </style>

      <svg
        className="mr-8"
        width="320"
        viewBox="0 0 1853 991"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="6.18164"
          y="18.75"
          width="1788.96"
          height="965.523"
          rx="81"
          stroke="white"
          strokeWidth="12"
        />
        <rect
          x="67.5146"
          y="112.684"
          width="1351.24"
          height="812.945"
          rx="26"
          stroke="white"
          strokeWidth="12"
        />

        {currentScreen === 8 && (
          <>
            <defs>
              <clipPath id="screenBounds">
                <rect
                  x="67.5146"
                  y="112.684"
                  width="1351.24"
                  height="812.945"
                  rx="26"
                />
              </clipPath>
            </defs>

            <rect
              x="67.5146"
              y="112.684"
              width="1351.24"
              height="812.945"
              clipPath="url(#screenBounds)"
              fill="url(#swipeGradient)"
              style={getAnimationStyles("swipeIndicator")}
            />

            <defs>
              <linearGradient id="swipeGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="white" stopOpacity="0" />
                <stop offset="35%" stopColor="white" stopOpacity="0" />
                <stop offset="50%" stopColor="white" stopOpacity="0.2" />
                <stop offset="65%" stopColor="white" stopOpacity="0" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
          </>
        )}

        {[
          [182.383, "1"],
          [515.383, "2"],
          [851.383, "3"],
          [1184.38, "4"],
        ].map(([x, key], index) => (
          <g key={key} style={{ transform: `translate(${x}px, 6.02734px)` }}>
            <rect
              width="138.829"
              height="12.373"
              rx="6.18652"
              fill="white"
              stroke="white"
              strokeWidth="12"
              style={getAnimationStyles("presetButton", index)}
            />
          </g>
        ))}

        <g style={{ transform: `translate(1531.38px, 10.0273px)` }}>
          <rect
            width="134.829"
            height="8.2"
            rx="4.1"
            fill="white"
            stroke="white"
            strokeWidth="8"
            style={getAnimationStyles("brightnessButton")}
          />
        </g>

        <g style={getAnimationStyles("dial")}>
          <circle
            cx="1601.92"
            cy="367.076"
            r="250.465"
            fill="url(#paint0_linear_542_1487)"
          />
        </g>

        <circle
          cx="1601.92"
          cy="793.891"
          r="79.8281"
          fill="url(#paint1_linear_542_1487)"
          style={getAnimationStyles("smallCircle")}
        />

        <defs>
          <linearGradient
            id="paint0_linear_542_1487"
            x1="1601.92"
            y1="367.076"
            x2="1601.92"
            y2="617.541"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" />
            <stop offset="1" stopColor="#7A7A7A" />
          </linearGradient>
          <linearGradient
            id="paint1_linear_542_1487"
            x1="1601.92"
            y1="793.891"
            x2="1601.92"
            y2="873.719"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" />
            <stop offset="1" stopColor="#7A7A7A" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
};

export default TutorialFrame;
