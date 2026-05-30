import { VolumeLoudIcon, VolumeOffIcon } from "../../../common/icons";

const VolumeConfirmation = ({ volumeTarget }) => {
  const pct = Math.max(0, Math.min(100, Math.round(Number(volumeTarget) || 0)));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "300px",
      }}
    >
      <div style={{ flexShrink: 0, width: "28px", height: "28px" }}>
        {pct === 0 ? <VolumeOffIcon /> : <VolumeLoudIcon />}
      </div>
      <div
        style={{
          flex: 1,
          marginLeft: "12px",
          marginRight: "12px",
          height: "4px",
          borderRadius: "9999px",
          background: "rgba(255,255,255,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "#FFFFFF",
            borderRadius: "9999px",
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        style={{
          flexShrink: 0,
          fontSize: "22px",
          fontWeight: 600,
          color: "#FFFFFF",
          minWidth: "44px",
          textAlign: "right",
        }}
      >
        {pct}%
      </span>
    </div>
  );
};

export default VolumeConfirmation;
