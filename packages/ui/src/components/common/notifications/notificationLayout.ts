import type { AppNotification } from "../../../types";

export const notificationDescriptionClassName = (
  expanded: boolean,
  showsAppName = false,
) =>
  `text-[26px] font-medium leading-[32px] tracking-tight text-white/70 whitespace-pre-wrap break-words ${
    expanded
      ? `${
          showsAppName ? "max-h-[64px]" : "max-h-[96px]"
        } overflow-y-auto overscroll-contain scrollbar-hide`
      : "line-clamp-2"
  }`;

export const visibleNotificationForExpandedId = (
  notifications: AppNotification[],
  expandedNotificationId: string | null,
): AppNotification | null => {
  const expandedNotification = expandedNotificationId
    ? notifications.find(({ id }) => id === expandedNotificationId)
    : undefined;
  return expandedNotification ?? notifications.at(-1) ?? null;
};
