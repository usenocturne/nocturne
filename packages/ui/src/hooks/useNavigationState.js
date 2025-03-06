import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";

export function useNavigationState() {
  const [navigationHistory, setNavigationHistory] = useState([
    { pathname: "/", query: {}, section: "recents" },
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
      if (isHandlingBack.current) return;

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

    if (lastActiveSection === "nowPlaying") {
      const sectionToRestore = previousSection.current || "recents";
      return {
        pathname: router.pathname,
        query: router.query,
        section: sectionToRestore,
        shouldAnimate: true,
      };
    }

    if (navigationHistory.length > 1) {
      const newHistory = [...navigationHistory];
      newHistory.pop();
      const previousPage = newHistory[newHistory.length - 1];
      setNavigationHistory(newHistory);

      return {
        pathname: previousPage.pathname,
        query: previousPage.query,
        section: null,
      };
    }

    return {
      pathname: "/",
      query: {},
      section: "recents",
    };
  };

  const updateSectionHistory = (section) => {
    if (!section) return;

    if (isHandlingBack.current) {
      isHandlingBack.current = false;
      return;
    }

    if (section === "nowPlaying" && lastActiveSection !== "nowPlaying") {
      previousSection.current = lastActiveSection;
    }

    setLastActiveSection(section);
  };

  return {
    navigationHistory,
    handleBack,
    updateSectionHistory,
  };
}
