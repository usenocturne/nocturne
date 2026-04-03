import React from "react";

const MockingbirdShell = React.lazy(() => import("./ui/MockingbirdShell"));

function SplashFallback() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#2d2d2d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <img
        src="/images/appstart.png"
        alt="Nocturne"
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

export default function UIShell({ isMockingbird, children, mockingbirdProps }) {
  if (!isMockingbird) {
    return <>{children}</>;
  }

  return (
    <React.Suspense fallback={<SplashFallback />}>
      <MockingbirdShell {...mockingbirdProps} />
    </React.Suspense>
  );
}
