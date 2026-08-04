import type { PhoneCallOverlayProps } from "../../../../hooks/usePhoneCalls";
import Type from "../CarthingUIComponents/Type/Type";
import {
  IconPhoneAnswer,
  IconPhoneDecline,
  IconUserCircle64,
} from "../Icons/CarthingUIComponents";
import styles from "./MockingbirdIncomingCallOverlay.module.scss";

const callKind = (service: string | undefined) => {
  if (service === "facetime_audio") return "Incoming FaceTime audio";
  if (service === "facetime_video") return "Incoming FaceTime video";
  return "Incoming call";
};

export default function MockingbirdIncomingCallOverlay({
  call,
  pendingAction,
  error,
  onAccept,
  onDecline,
}: PhoneCallOverlayProps) {
  if (!call) return null;

  const displayName = call.displayName.trim();
  const remoteId = call.remoteId.trim();
  const hasCallerName = Boolean(displayName && displayName !== remoteId);
  const callerTitle = hasCallerName
    ? displayName
    : remoteId || "Number unavailable";
  const callerSubtitle = hasCallerName ? remoteId : "Incoming call";
  const isPending = pendingAction?.callKey === `${call.device}:${call.callId}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${callKind(call.service)} from ${callerTitle}`}
      className={styles.overlay}
    >
      <div className={styles.infoWrapper}>
        <IconUserCircle64 className={styles.avatar} />
        <Type name="brioBold" className={styles.title}>
          <span dir="auto">{callerTitle}</span>
        </Type>
        {callerSubtitle && (
          <Type name="celloBook" className={styles.subtitle}>
            <span dir="auto">{callerSubtitle}</span>
          </Type>
        )}
        <div role="status" aria-live="polite" className={styles.status}>
          {error}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          aria-label={`Accept call from ${callerTitle}`}
          disabled={isPending}
          onClick={() => void onAccept()}
          className={styles.action}
        >
          <IconPhoneAnswer />
        </button>
        <button
          type="button"
          aria-label={`Decline call from ${callerTitle}`}
          disabled={isPending}
          onClick={() => void onDecline()}
          className={`${styles.action} ${styles.decline}`}
        >
          <IconPhoneDecline />
        </button>
      </div>
    </div>
  );
}
