import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { SpotifyImage as SpotifyImageEntry } from "../../types";
import { useSpotifyWebSocket } from "../../hooks/useSpotifyWebSocket";
import { TRANSITION_DURATION_MS as CAROUSEL_TRANSITION_MS } from "../../hooks/useSwiperNavigation";
import SpotifyImage from "../common/SpotifyImage";
import ScrollingText from "../common/ScrollingText";
import {
  createCubicBezierEasing,
  getQueueDragOffset,
  getQueueScrollTarget,
  getQueueSkipParams,
  normalizeQueueResponse,
  QUEUE_SHEET_EXIT_MS,
  shouldDismissQueueDrag,
  NOW_PLAYING_ROW_INDEX,
  stepQueueSelection,
  type QueueEntry,
} from "./queue";

interface QueueViewProps {
  currentTrackUri: string | null;
  contextUri: string | null;
  contextName: string;
  trackName: string;
  artistName: string;
  albumImages: SpotifyImageEntry[] | null;
  isPlaying: boolean;
  isClosing: boolean;
  underlayRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

type QueueLoadState = "loading" | "ready" | "error";

const TEXT_MAX_WIDTH = "560px";
const SELECTION_IDLE_MS = 3000;
const SELECTION_SETTLE_MS = 250;
const DRAG_LOCK_PX = 10;
const DRAG_VELOCITY_WINDOW_MS = 100;
const SHEET_ENTER_MS = 380;
const SPRING_BACK_MS = 300;
const SHEET_ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const SHEET_EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
const DRAG_RELEASE_EASING = "cubic-bezier(0.25, 0.8, 0.5, 1)";
const CAROUSEL_EASING = createCubicBezierEasing(0.16, 1, 0.3, 1);
const QUEUE_KEYS = new Set(["Escape", "Enter", "ArrowDown", "ArrowUp"]);

const clipBelow = (edge: number) => `inset(${Math.max(0, edge)}px 0 0 0)`;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface SheetDrag {
  startX: number;
  startY: number;
  canDrag: boolean;
  axis: "pending" | "drag" | "native";
  offset: number;
  samples: Array<{ y: number; time: number }>;
}

interface QueueRowProps {
  index: number;
  images: SpotifyImageEntry[] | string | null;
  title: string;
  subtitle: string;
  isSelected: boolean;
  showMarquee: boolean;
  isDimmed?: boolean;
  isPending?: boolean;
  isNowPlaying?: boolean;
  isPlaying?: boolean;
  onClick: () => void;
}

function QueueRow({
  index,
  images,
  title,
  subtitle,
  isSelected,
  showMarquee,
  isDimmed = false,
  isPending = false,
  isNowPlaying = false,
  isPlaying = false,
  onClick,
}: QueueRowProps) {
  const firstUrl = Array.isArray(images) ? images[0]?.url : images;

  return (
    <div
      data-queue-index={index}
      className={`flex items-center mb-5 origin-top-left select-none transition-transform duration-200 ease-out ${
        isSelected ? "scale-105" : ""
      } ${isDimmed ? "opacity-50" : ""} ${isPending ? "animate-pulse" : ""}`}
      onClick={onClick}
    >
      <div className="relative w-20 h-20 flex-shrink-0 mr-6">
        <SpotifyImage
          images={images}
          preferredSizeIndex={1}
          alt={`${title} Cover`}
          width={80}
          height={80}
          priority={isNowPlaying ? 100 : 20}
          fallbackSrc="/images/not-playing.webp"
          useDirectUrl={
            isNowPlaying &&
            (firstUrl?.includes("/images/not-playing.webp") ||
              firstUrl?.startsWith("blob:"))
          }
          className="w-20 h-20 object-cover rounded-[10px]"
        />
        {isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/50">
            <section className="pt-0 scale-[1.75]">
              <div className="wave0"></div>
              <div className="wave1"></div>
              <div className="wave2"></div>
              <div className="wave3"></div>
            </section>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-grow">
        {isSelected && showMarquee ? (
          <ScrollingText
            text={title}
            className="text-[32px] font-[580] text-white tracking-tight"
            maxWidth={TEXT_MAX_WIDTH}
            pauseDuration={1000}
            pixelsPerSecond={40}
          />
        ) : (
          <p
            className="text-[32px] font-[580] text-white truncate tracking-tight"
            style={{ maxWidth: TEXT_MAX_WIDTH }}
          >
            {title}
          </p>
        )}
        <p
          className="text-[28px] font-[560] text-white/60 truncate tracking-tight"
          style={{ maxWidth: TEXT_MAX_WIDTH }}
        >
          {subtitle}
        </p>
      </div>
    </div>
  );
}

export default function QueueView({
  currentTrackUri,
  contextUri,
  contextName,
  trackName,
  artistName,
  albumImages,
  isPlaying,
  isClosing,
  underlayRef,
  onClose,
}: QueueViewProps) {
  const { sendSpotifyCommand } = useSpotifyWebSocket();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loadState, setLoadState] = useState<QueueLoadState>("loading");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSelectionVisible, setIsSelectionVisible] = useState(false);
  const [isSelectionSettled, setIsSelectionSettled] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [isDragDismissed, setIsDragDismissed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const playAbortRef = useRef<AbortController | null>(null);
  const selectedIndexRef = useRef(-1);
  const scrollFrameRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isClosingRef = useRef(isClosing);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    isClosingRef.current = isClosing;
    onCloseRef.current = onClose;
  });

  const rowCount = 1 + (loadState === "ready" ? entries.length : 0);

  useEffect(() => {
    const abortController = new AbortController();
    if (!hasLoadedRef.current) setLoadState("loading");

    sendSpotifyCommand("spotify.player.queue", {}, abortController.signal)
      .then((response) => {
        if (abortController.signal.aborted) return;
        hasLoadedRef.current = true;
        setEntries(normalizeQueueResponse(response));
        setLoadState("ready");
      })
      .catch((error) => {
        if (abortController.signal.aborted) return;
        console.error("Failed to fetch queue:", error);
        if (!hasLoadedRef.current) setLoadState("error");
      });

    return () => abortController.abort();
  }, [currentTrackUri, sendSpotifyCommand]);

  useEffect(() => {
    selectedIndexRef.current = -1;
    setSelectedIndex(-1);
    setIsSelectionVisible(false);
  }, [currentTrackUri]);

  useEffect(() => {
    if (selectedIndexRef.current >= rowCount) {
      selectedIndexRef.current = rowCount - 1;
      setSelectedIndex(rowCount - 1);
    }
  }, [rowCount]);

  useEffect(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  useEffect(
    () => () => {
      playAbortRef.current?.abort();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const playEntry = useCallback(
    async (entry: QueueEntry) => {
      const params = getQueueSkipParams(entry, contextUri);
      if (!params || playAbortRef.current || isClosing) return;

      const abortController = new AbortController();
      playAbortRef.current = abortController;
      setPendingKey(entry.key);
      setPlayError(null);
      try {
        await sendSpotifyCommand(
          "spotify.player.next",
          params,
          abortController.signal,
        );
        if (!abortController.signal.aborted) onClose();
      } catch (error) {
        if (abortController.signal.aborted) return;
        console.error("Failed to play queue item:", error);
        setPlayError(`Could not play ${entry.name}`);
      } finally {
        if (playAbortRef.current === abortController) {
          playAbortRef.current = null;
          setPendingKey(null);
        }
      }
    },
    [contextUri, isClosing, onClose, sendSpotifyCommand],
  );

  const activateRow = useCallback(
    (index: number) => {
      if (index === NOW_PLAYING_ROW_INDEX) {
        onClose();
        return;
      }
      const entry = entries[index - 1];
      if (entry) void playEntry(entry);
    },
    [entries, onClose, playEntry],
  );

  const cancelListScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }, []);

  const scrollRowToTop = useCallback(
    (index: number) => {
      const list = listRef.current;
      const row = list?.querySelector<HTMLElement>(
        `[data-queue-index="${index}"]`,
      );
      if (!list || !row) return;
      cancelListScroll();

      const from = list.scrollTop;
      const distance =
        getQueueScrollTarget(
          row.offsetTop,
          list.scrollHeight,
          list.clientHeight,
        ) - from;
      if (Math.abs(distance) < 1 || prefersReducedMotion()) {
        list.scrollTop = from + distance;
        return;
      }

      const startedAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min(
          1,
          (now - startedAt) / CAROUSEL_TRANSITION_MS,
        );
        list.scrollTop = from + distance * CAROUSEL_EASING(progress);
        scrollFrameRef.current =
          progress < 1 ? requestAnimationFrame(step) : null;
      };
      scrollFrameRef.current = requestAnimationFrame(step);
    },
    [cancelListScroll],
  );

  useEffect(() => {
    const list = listRef.current;
    list?.addEventListener("touchstart", cancelListScroll, { passive: true });
    return () => {
      list?.removeEventListener("touchstart", cancelListScroll);
      cancelListScroll();
    };
  }, [cancelListScroll]);

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      const next = stepQueueSelection(
        selectedIndexRef.current,
        direction,
        rowCount,
      );
      selectedIndexRef.current = next;
      setSelectedIndex(next);
      setIsSelectionVisible(true);
      setIsSelectionSettled(false);
      scrollRowToTop(next);

      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(
        () => setIsSelectionSettled(true),
        SELECTION_SETTLE_MS,
      );
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(
        () => setIsSelectionVisible(false),
        SELECTION_IDLE_MS,
      );
    },
    [rowCount, scrollRowToTop],
  );

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const delta =
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!isClosing) moveSelection(delta > 0 ? 1 : -1);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!QUEUE_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (isClosing) return;

      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Enter") {
        if (isSelectionVisible && selectedIndexRef.current >= 0) {
          activateRow(selectedIndexRef.current);
        }
      } else {
        moveSelection(event.key === "ArrowDown" ? 1 : -1);
      }
    };

    document.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activateRow, isClosing, isSelectionVisible, moveSelection, onClose]);

  const underlayAnimationRef = useRef<Animation | null>(null);

  const getUnderlayEdge = useCallback(
    (sheetOffset: number) => {
      const sheet = rootRef.current;
      const underlay = underlayRef.current;
      if (!sheet || !underlay) return 0;
      return (
        sheet.clientHeight + sheetOffset - underlay.getBoundingClientRect().top
      );
    },
    [underlayRef],
  );

  const setUnderlayEdge = useCallback(
    (edge: number) => {
      const underlay = underlayRef.current;
      if (!underlay) return;
      underlayAnimationRef.current?.cancel();
      underlayAnimationRef.current = null;
      underlay.style.clipPath = clipBelow(edge);
    },
    [underlayRef],
  );

  const animateUnderlayEdge = useCallback(
    (edge: number, duration: number, easing: string) => {
      const underlay = underlayRef.current;
      if (!underlay) return;
      const from = getComputedStyle(underlay).clipPath;
      underlayAnimationRef.current?.cancel();
      underlay.style.clipPath = clipBelow(edge);
      underlayAnimationRef.current = underlay.animate(
        [
          { clipPath: from === "none" ? clipBelow(0) : from },
          { clipPath: clipBelow(edge) },
        ],
        { duration: prefersReducedMotion() ? 0 : duration, easing },
      );
    },
    [underlayRef],
  );

  useLayoutEffect(() => {
    animateUnderlayEdge(getUnderlayEdge(0), SHEET_ENTER_MS, SHEET_ENTER_EASING);
    const underlay = underlayRef.current;
    return () => {
      underlayAnimationRef.current?.cancel();
      if (underlay) underlay.style.clipPath = "";
    };
  }, [animateUnderlayEdge, getUnderlayEdge, underlayRef]);

  useEffect(() => {
    if (isClosing && !isDragDismissed) {
      animateUnderlayEdge(0, QUEUE_SHEET_EXIT_MS, SHEET_EXIT_EASING);
    }
  }, [animateUnderlayEdge, isClosing, isDragDismissed]);

  useEffect(() => {
    const sheet = rootRef.current;
    if (!sheet) return;
    let drag: SheetDrag | null = null;
    let frame: number | null = null;

    const renderDrag = () => {
      frame = null;
      if (!drag) return;
      sheet.style.transform = `translate3d(0, ${drag.offset}px, 0)`;
      setUnderlayEdge(getUnderlayEdge(drag.offset));
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (isClosingRef.current || event.touches.length !== 1) {
        drag = null;
        return;
      }
      const list = listRef.current;
      const target = event.target instanceof Node ? event.target : null;
      const startedInList = !!list && !!target && list.contains(target);
      const listScrolls = !!list && list.scrollHeight > list.clientHeight + 1;
      const listAtBottom =
        !!list && list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      const touch = event.touches[0];
      drag = {
        startX: touch.clientX,
        startY: touch.clientY,
        canDrag: !startedInList || !listScrolls || listAtBottom,
        axis: "pending",
        offset: 0,
        samples: [{ y: touch.clientY, time: event.timeStamp }],
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!drag) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - drag.startX;
      const deltaY = touch.clientY - drag.startY;

      if (drag.axis === "pending") {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DRAG_LOCK_PX) {
          return;
        }
        drag.axis =
          drag.canDrag && deltaY < 0 && Math.abs(deltaY) > Math.abs(deltaX)
            ? "drag"
            : "native";
        if (drag.axis === "drag") {
          sheet.style.animation = "none";
          sheet.style.transition = "none";
        }
      }
      if (drag.axis !== "drag") return;

      if (event.cancelable) event.preventDefault();
      drag.offset = getQueueDragOffset(deltaY);
      drag.samples.push({ y: touch.clientY, time: event.timeStamp });
      while (
        drag.samples.length > 2 &&
        event.timeStamp - drag.samples[0].time > DRAG_VELOCITY_WINDOW_MS
      ) {
        drag.samples.shift();
      }
      if (frame === null) frame = requestAnimationFrame(renderDrag);
    };

    const handleTouchEnd = () => {
      const finished = drag;
      drag = null;
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (!finished || finished.axis !== "drag") return;

      const first = finished.samples[0];
      const last = finished.samples[finished.samples.length - 1];
      const elapsed = last.time - first.time;
      const velocity = elapsed > 0 ? (last.y - first.y) / elapsed : 0;

      if (
        shouldDismissQueueDrag(finished.offset, velocity, sheet.clientHeight)
      ) {
        sheet.style.transition = `transform ${QUEUE_SHEET_EXIT_MS}ms ${DRAG_RELEASE_EASING}`;
        sheet.style.transform = "translate3d(0, -100%, 0)";
        animateUnderlayEdge(0, QUEUE_SHEET_EXIT_MS, DRAG_RELEASE_EASING);
        setIsDragDismissed(true);
        onCloseRef.current();
      } else {
        sheet.style.transition = `transform ${SPRING_BACK_MS}ms ${SHEET_ENTER_EASING}`;
        sheet.style.transform = "translate3d(0, 0, 0)";
        animateUnderlayEdge(
          getUnderlayEdge(0),
          SPRING_BACK_MS,
          SHEET_ENTER_EASING,
        );
      }
    };

    sheet.addEventListener("touchstart", handleTouchStart, { passive: true });
    sheet.addEventListener("touchmove", handleTouchMove, { passive: false });
    sheet.addEventListener("touchend", handleTouchEnd);
    sheet.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      sheet.removeEventListener("touchstart", handleTouchStart);
      sheet.removeEventListener("touchmove", handleTouchMove);
      sheet.removeEventListener("touchend", handleTouchEnd);
      sheet.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [animateUnderlayEdge, getUnderlayEdge, setUnderlayEdge]);

  const isRowSelected = (index: number) =>
    isSelectionVisible && selectedIndex === index;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Queue"
      className={`fixed inset-0 z-40 flex flex-col overflow-hidden rounded-2xl bg-black/40 shadow-[0_24px_48px_rgba(0,0,0,0.5)] ${
        isClosing
          ? isDragDismissed
            ? ""
            : "queue-sheet-exit"
          : "queue-sheet-enter"
      }`}
    >
      <div className="flex items-baseline justify-between gap-8 px-12 pt-10 pb-5">
        <h2 className="flex-shrink-0 text-[46px] font-[580] text-white tracking-tight">
          Queue
        </h2>
        {contextName && (
          <p className="min-w-0 truncate text-[28px] font-[560] text-white/60 tracking-tight">
            Playing from {contextName}
          </p>
        )}
      </div>

      <div
        ref={listRef}
        className="relative flex-1 overflow-y-auto scroll-container px-12 pb-2"
      >
        <QueueRow
          index={NOW_PLAYING_ROW_INDEX}
          images={albumImages}
          title={trackName}
          subtitle={artistName}
          isSelected={isRowSelected(NOW_PLAYING_ROW_INDEX)}
          showMarquee={isSelectionSettled}
          isNowPlaying
          isPlaying={isPlaying}
          onClick={onClose}
        />

        <p className="text-[28px] font-[560] text-white/60 tracking-tight mb-5">
          Up Next
        </p>

        {loadState === "loading" &&
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center mb-5">
              <div className="w-20 h-20 bg-white/10 animate-pulse rounded-[10px] mr-6" />
              <div className="flex-grow">
                <div className="h-8 w-[320px] bg-white/10 animate-pulse rounded mb-2" />
                <div className="h-6 w-[220px] bg-white/10 animate-pulse rounded" />
              </div>
            </div>
          ))}

        {loadState === "error" && (
          <p className="text-[32px] font-[580] text-white/80 tracking-tight">
            Could not load the queue
          </p>
        )}

        {loadState === "ready" && entries.length === 0 && (
          <p className="text-[32px] font-[580] text-white/80 tracking-tight">
            Nothing up next
          </p>
        )}

        {loadState === "ready" &&
          entries.map((entry, entryIndex) => (
            <QueueRow
              key={entry.key}
              index={entryIndex + 1}
              images={entry.imageUrl}
              title={entry.name}
              subtitle={entry.subtitle}
              isSelected={isRowSelected(entryIndex + 1)}
              showMarquee={isSelectionSettled}
              isDimmed={entry.uid === null}
              isPending={pendingKey === entry.key}
              onClick={() => void playEntry(entry)}
            />
          ))}

        {playError && (
          <div className="mt-4 p-4 bg-red-500/20 rounded-lg">
            <p className="text-white/80">{playError}</p>
          </div>
        )}
      </div>

      <div
        aria-hidden="true"
        className="flex h-14 flex-shrink-0 items-center justify-center"
      >
        <div className="w-24 h-2 rounded-full bg-white/40" />
      </div>
    </div>
  );
}
