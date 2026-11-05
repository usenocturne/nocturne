// A device list applies unless a newer one already did or the modal was closed or refreshed after it was requested.
export const shouldApplyDeviceResponse = (
  requestId: number,
  cancelledThroughId: number,
  lastAppliedId: number,
) => requestId > cancelledThroughId && requestId > lastAppliedId;
