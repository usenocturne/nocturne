import React from "react";
import type { PhoneCallOverlayProps } from "../hooks/usePhoneCalls";

const MockingbirdShell = React.lazy(() => import("./ui/MockingbirdShell"));
const MockingbirdIncomingCallOverlay = React.lazy(
  () => import("./ui/components/PhoneCall/MockingbirdIncomingCallOverlay"),
);

export function MockingbirdPhoneCallOverlay(props: PhoneCallOverlayProps) {
  if (!props.call) return null;

  return (
    <React.Suspense fallback={null}>
      <MockingbirdIncomingCallOverlay {...props} />
    </React.Suspense>
  );
}

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

export default function UIShell({
  isMockingbird,
  children,
  mockingbirdProps,
}: UiComponentProps) {
  if (!isMockingbird) {
    return <>{children}</>;
  }

  return (
    <React.Suspense fallback={<SplashFallback />}>
      <MockingbirdShell {...mockingbirdProps} />
    </React.Suspense>
  );
}
