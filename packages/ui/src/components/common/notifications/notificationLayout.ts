import type { AppNotification } from "../../../types";

export const NOTIFICATION_DESCRIPTION_LINE_HEIGHT_PX = 27;

export const hasMultipleNotificationDescriptionLines = (scrollHeight: number) =>
  scrollHeight > NOTIFICATION_DESCRIPTION_LINE_HEIGHT_PX + 1;

export const shouldEmphasizeNotificationFirstLine = (
  iconSrc: string | null | undefined,
  scrollHeight: number,
) => Boolean(iconSrc && hasMultipleNotificationDescriptionLines(scrollHeight));

export const notificationDescriptionClassName = (
  expanded: boolean,
  emphasizeFirstLine = false,
  showsAppName = false,
) =>
  `${
    expanded
      ? `-mt-px text-[20px] font-medium leading-[27px] tracking-tight text-[#b8b8c0] whitespace-pre-wrap break-words ${
          showsAppName ? "max-h-[54px]" : "max-h-[81px]"
        } overflow-y-auto overscroll-contain scrollbar-hide`
      : "-mt-px text-[20px] font-medium leading-[27px] tracking-tight text-[#b8b8c0] whitespace-pre-wrap break-words line-clamp-2"
  }${emphasizeFirstLine ? " first-line:font-bold" : ""}`;

export const visibleNotificationsForExpandedId = (
  notifications: AppNotification[],
  expandedNotificationId: string | null,
): AppNotification[] => {
  if (!expandedNotificationId) return notifications;
  const expandedNotification = notifications.find(
    ({ id }) => id === expandedNotificationId,
  );
  return expandedNotification ? [expandedNotification] : notifications;
};
