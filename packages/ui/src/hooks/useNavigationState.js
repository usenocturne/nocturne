import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";

export function useNavigationState() {
  const [navigationHistory, setNavigationHistory] = useState([
    { pathname: "/", query: {} },
  ]);

  const isHandlingBack = useRef(false);
  const previousSection = useRef(null);

  const [lastActiveSection, setLastActiveSection] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("lastActiveSection") || "recents";
    }
    return "recents";
  });

  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined" && !isHandlingBack.current) {
      localStorage.setItem("lastActiveSection", lastActiveSection);
    }
  }, [lastActiveSection]);

  useEffect(() => {
    const handleRouteChange = () => {
      setNavigationHistory((prev) => {
        const newEntry = {
          pathname: router.pathname,
          query: router.query,
        };

        const lastEntry = prev[prev.length - 1];
        if (
          lastEntry.pathname === newEntry.pathname &&
          JSON.stringify(lastEntry.query) === JSON.stringify(newEntry.query)
        ) {
          return prev;
        }

        if (
          lastEntry.pathname === "/" &&
          newEntry.pathname === "/now-playing"
        ) {
          previousSection.current =
            localStorage.getItem("lastActiveSection") || "recents";
        }

        return [...prev, newEntry];
      });
    };

    if (router.isReady) {
      handleRouteChange();
    }

    router.events.on("routeChangeComplete", handleRouteChange);
    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, [router, router.isReady]);

  const handleBack = () => {
    isHandlingBack.current = true;

    const currentPath =
      navigationHistory[navigationHistory.length - 1].pathname;

    if (currentPath === "/") {
      previousSection.current =
        localStorage.getItem("lastActiveSection") || "recents";
      return {
        pathname: "/now-playing",
        query: {},
        section: null,
      };
    }

    if (navigationHistory.length > 1) {
      const newHistory = [...navigationHistory];
      newHistory.pop();
      const previousPage = newHistory[newHistory.length - 1];
      setNavigationHistory(newHistory);

      if (previousPage.pathname === "/" && currentPath === "/now-playing") {
        const sectionToRestore =
          previousSection.current ||
          localStorage.getItem("lastActiveSection") ||
          "recents";
        return {
          pathname: previousPage.pathname,
          query: previousPage.query,
          section: sectionToRestore,
        };
      }

      if (previousPage.pathname === "/") {
        const currentSection =
          localStorage.getItem("lastActiveSection") || "recents";
        return {
          pathname: previousPage.pathname,
          query: previousPage.query,
          section: currentSection,
        };
      }

      return {
        pathname: previousPage.pathname,
        query: previousPage.query,
        section: null,
      };
    }

    return {
      pathname: "/now-playing",
      query: {},
      section: null,
    };
  };

  const updateSectionHistory = (section) => {
    if (!section || section === "nowPlaying") return;

    if (isHandlingBack.current) {
      isHandlingBack.current = false;
      return;
    }

    setLastActiveSection(section);
    if (typeof window !== "undefined") {
      localStorage.setItem("lastActiveSection", section);
    }
  };

  return {
    navigationHistory,
    handleBack,
    updateSectionHistory,
  };
}
