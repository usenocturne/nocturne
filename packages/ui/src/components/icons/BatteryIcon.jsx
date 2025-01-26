const BatteryIcon = ({ percentage = 100, className }) => {
  const fillColor = percentage <= 20 ? "#ff0000" : "white";

  return (
    <svg
      width="25"
      height="13"
      viewBox="0 0 25 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <clipPath id="batteryMask">
          <path d="M0 6.4C0 4.15979 0 3.03968 0.435974 2.18404C0.819467 1.43139 1.43139 0.819467 2.18404 0.435974C3.03968 0 4.15979 0 6.4 0H15.6C17.8402 0 18.9603 0 19.816 0.435974C20.5686 0.819467 21.1805 1.43139 21.564 2.18404C22 3.03968 22 4.15979 22 6.4V6.6C22 8.84021 22 9.96031 21.564 10.816C21.1805 11.5686 20.5686 12.1805 19.816 12.564C18.9603 13 17.8402 13 15.6 13H6.4C4.15979 13 3.03968 13 2.18404 12.564C1.43139 12.1805 0.819467 11.5686 0.435974 10.816C0 9.96031 0 8.84021 0 6.6V6.4Z" />
        </clipPath>
        <mask id="textCutout">
          <rect width="22" height="13" fill="white" />
          {percentage > 0 && (
            <text
              x="11"
              y="7"
              textAnchor="middle"
              alignmentBaseline="central"
              fontSize="10"
              fontWeight="600"
              fill="black"
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {percentage}
            </text>
          )}
        </mask>
        <mask id="textOnly">
          <rect width="22" height="13" fill="black" />
          {percentage > 0 && (
            <text
              x="11"
              y="7"
              textAnchor="middle"
              alignmentBaseline="central"
              fontSize="10"
              fontWeight="600"
              fill="white"
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {percentage}
            </text>
          )}
        </mask>
      </defs>

      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 6.4C0 4.15979 0 3.03968 0.435974 2.18404C0.819467 1.43139 1.43139 0.819467 2.18404 0.435974C3.03968 0 4.15979 0 6.4 0H15.6C17.8402 0 18.9603 0 19.816 0.435974C20.5686 0.819467 21.1805 1.43139 21.564 2.18404C22 3.03968 22 4.15979 22 6.4V6.6C22 8.84021 22 9.96031 21.564 10.816C21.1805 11.5686 20.5686 12.1805 19.816 12.564C18.9603 13 17.8402 13 15.6 13H6.4C4.15979 13 3.03968 13 2.18404 12.564C1.43139 12.1805 0.819467 11.5686 0.435974 10.816C0 9.96031 0 8.84021 0 6.6V6.4Z"
        fill="white"
        fillOpacity="0.25"
        mask="url(#textCutout)"
      />

      <rect
        x="0"
        y="0"
        width={`${(percentage / 100) * 22}`}
        height="13"
        fill={fillColor}
        clipPath="url(#batteryMask)"
        mask="url(#textCutout)"
      />

      <path
        d="M23 4.80762V8.86564C23.8164 8.52195 24.3473 7.72243 24.3473 6.83663C24.3473 5.95083 23.8164 5.15131 23 4.80762"
        fill="white"
        fillOpacity="0.25"
      />
    </svg>
  );
};

export default BatteryIcon;
