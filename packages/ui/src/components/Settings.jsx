"use client";

import { useState, useEffect } from "react";
import { Field, Label, Switch } from "@headlessui/react";

export default function Settings() {
  const [trackNameScrollingEnabled, setTrackNameScrollingEnabled] = useState(
    () => {
      const storedValue = localStorage.getItem("trackNameScrollingEnabled");
      return storedValue !== null ? storedValue === "true" : true;
    }
  );

  const [lyricsMenuEnabled, setLyricsMenuEnabled] = useState(() => {
    const storedValue = localStorage.getItem("lyricsMenuEnabled");
    return storedValue !== null ? storedValue === "true" : true;
  });

  useEffect(() => {
    localStorage.setItem(
      "trackNameScrollingEnabled",
      trackNameScrollingEnabled.toString()
    );
  }, [trackNameScrollingEnabled]);

  useEffect(() => {
    localStorage.setItem("lyricsMenuEnabled", lyricsMenuEnabled.toString());
  }, [lyricsMenuEnabled]);

  useEffect(() => {
    if (localStorage.getItem("trackNameScrollingEnabled") === null) {
      localStorage.setItem("trackNameScrollingEnabled", "true");
    }
    if (localStorage.getItem("lyricsMenuEnabled") === null) {
      localStorage.setItem("lyricsMenuEnabled", "true");
    }
  }, []);

  return (
    <div className="pt-12 space-y-8">
      <div>
        <Field className="flex items-center">
          <Switch
            checked={trackNameScrollingEnabled}
            onChange={setTrackNameScrollingEnabled}
            className="group relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none data-[checked]:bg-white/40"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out group-data-[checked]:translate-x-9"
            />
          </Switch>
          <Label as="span" className="ml-3 text-sm">
            <span className="text-[32px] font-[580] text-white tracking-tight">
              Track Name Scrolling
            </span>
          </Label>
        </Field>
        <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
          Enable or disable the scrolling animation for the track name in the
          player.
        </p>
      </div>
      <div>
        <Field className="flex items-center">
          <Switch
            checked={lyricsMenuEnabled}
            onChange={setLyricsMenuEnabled}
            className="group relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none data-[checked]:bg-white/40"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out group-data-[checked]:translate-x-9"
            />
          </Switch>
          <Label as="span" className="ml-3 text-sm">
            <span className="text-[32px] font-[580] text-white tracking-tight">
              Lyrics Menu Option
            </span>
          </Label>
        </Field>
        <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
          Enable or disable the lyrics menu option in the player.
        </p>
      </div>
    </div>
  );
}
