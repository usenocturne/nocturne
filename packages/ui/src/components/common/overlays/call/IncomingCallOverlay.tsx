import type { PhoneCallOverlayProps } from "../../../../hooks/usePhoneCalls";
import { FilledPhoneIcon, UserRoundIcon } from "../../icons";

const callKind = (service: string | undefined) => {
  if (service === "facetime_audio") return "Incoming FaceTime audio";
  if (service === "facetime_video") return "Incoming FaceTime video";
  return "Incoming call";
};

export const INCOMING_CALL_GRADIENT = [
  "radial-gradient(at 0% 25%, #3B518B 0%, transparent 80%)",
  "radial-gradient(at 25% 0%, #202F57 0%, transparent 80%)",
  "radial-gradient(at 100% 75%, #142045 0%, transparent 80%)",
  "radial-gradient(at 75% 100%, #151231 0%, transparent 80%)",
].join(", ");

export default function IncomingCallOverlay({
  call,
  pendingAction,
  error,
  onAccept,
  onDecline,
}: PhoneCallOverlayProps) {
  if (!call) return null;

  const displayName = call.displayName.trim();
  const remoteId = call.remoteId.trim();
  const callerName =
    displayName && displayName !== remoteId ? displayName : "Unknown caller";
  const phoneNumber = remoteId || "No caller ID";
  const isPending = pendingAction?.callKey === `${call.device}:${call.callId}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${callKind(call.service)} from ${callerName}`}
      className="fixed inset-0 z-[20000] overflow-hidden rounded-2xl bg-black text-white nocturne-font-stack"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: INCOMING_CALL_GRADIENT }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,12,30,0)_0%,rgba(4,8,24,0.08)_48%,rgba(2,5,17,0.4)_100%)]"
      />

      <div className="relative flex h-full flex-col px-[72px] pb-10 pt-[56px]">
        <div className="mt-[68px] flex w-full min-w-0 items-center gap-10">
          <div className="min-w-0 flex-1 text-left">
            <h1
              dir="auto"
              className="truncate text-[60px] font-[580] leading-[1.02] tracking-[-0.05em]"
            >
              {callerName}
            </h1>
            <div className="mt-3 min-w-0 text-left text-[30px] font-normal leading-tight tracking-[-0.025em] text-white/60">
              <span dir="auto" className="block max-w-full truncate">
                {phoneNumber}
              </span>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="flex h-[156px] w-[156px] shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 shadow-[0_18px_44px_rgba(8,20,39,0.2)]"
          >
            <UserRoundIcon
              strokeWidth={1.5}
              className="h-[92px] w-[92px] text-white/55"
            />
          </div>
        </div>

        <div className="mt-auto w-full">
          <div
            role="status"
            aria-live="polite"
            className="mb-2 min-h-5 text-center text-[15px] leading-5 text-red-100"
          >
            {error}
          </div>
          <div className="flex items-center justify-center gap-[96px]">
            <button
              type="button"
              aria-label={`Accept call from ${callerName}`}
              disabled={isPending}
              onClick={() => void onAccept()}
              className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-full border border-white/15 bg-[linear-gradient(135deg,rgba(52,211,153,0.96),rgba(16,185,129,0.88))] p-0 text-white shadow-[0_18px_44px_rgba(8,20,39,0.24)] transition active:scale-[0.96] disabled:opacity-55"
            >
              <FilledPhoneIcon className="h-[52px] w-[52px]" />
            </button>
            <button
              type="button"
              aria-label={`Decline call from ${callerName}`}
              disabled={isPending}
              onClick={() => void onDecline()}
              className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-full border border-white/15 bg-[linear-gradient(135deg,rgba(248,113,113,0.96),rgba(239,68,68,0.88))] p-0 text-white shadow-[0_18px_44px_rgba(8,20,39,0.24)] transition active:scale-[0.96] disabled:opacity-55"
            >
              <FilledPhoneIcon className="h-[52px] w-[52px] rotate-[135deg]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
