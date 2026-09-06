import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IconHeartActive48 from "./components/Icons/CarthingUIComponents/IconHeartActive48";
import IconCheckAlt48 from "./components/Icons/CarthingUIComponents/IconCheckAlt48";
import { IconCheckAlt } from "./components/Icons/EncoreWeb/IconCheckAlt";
import reactToBackButton from "./eventhandlers/BackButtonHandler";
import { View } from "./stores/ViewStore";
import { PresetsUiState } from "./stores/PresetsStore";
import { QueueItem } from "./stores/QueueStore";

describe("Mockingbird presentation and hardware contracts", () => {
  test("fixed-size confirmation icons forward their styling and accessible label", () => {
    for (const Icon of [IconHeartActive48, IconCheckAlt48]) {
      const markup = renderToStaticMarkup(
        createElement(Icon, {
          className: "confirmation-icon",
          "aria-label": "Saved",
        }),
      );
      expect(markup).toContain('class="confirmation-icon"');
      expect(markup).toContain('aria-label="Saved"');
      expect(markup).toContain('width="48"');
      expect(markup).not.toContain("iconSize=");
      expect(markup).not.toContain("autoMirror=");
    }
  });

  test("icon metadata stays in SVG title and description elements rather than DOM props", () => {
    const markup = renderToStaticMarkup(
      createElement(IconCheckAlt, {
        iconSize: 32,
        autoMirror: false,
        title: "Saved title",
        titleId: "saved-title",
        desc: "Saved description",
        descId: "saved-description",
        "aria-labelledby": "saved-title",
        "aria-describedby": "saved-description",
      }),
    );
    expect(markup).toContain('<title id="saved-title">Saved title</title>');
    expect(markup).toContain(
      '<desc id="saved-description">Saved description</desc>',
    );
    expect(markup).toContain('aria-labelledby="saved-title"');
    expect(markup).toContain('width="32"');
    expect(markup).not.toContain("iconSize=");
    expect(markup).not.toContain("autoMirror=");
    expect(markup).not.toContain("titleId=");
    expect(markup).not.toContain("descId=");
  });

  test("back on Now Playing takes the dedicated content-shelf action", () => {
    let onBack;
    const actions = [];
    reactToBackButton(
      {
        onBack: (handler) => {
          onBack = handler;
        },
      },
      {
        viewStore: {
          currentView: View.NPV,
          back: () => actions.push("history"),
        },
        npvStore: {
          npvController: { handleBackButton: () => actions.push("shelf") },
        },
        shelfStore: {},
        overlayController: { isShowing: () => false, isSettingsShowing: false },
        settingsStore: {},
        onboardingStore: { isActive: false },
        voiceStore: {},
      },
    );
    onBack();
    expect(actions).toEqual(["shelf"]);
  });

  test("an unavailable saved preset is presented as unavailable without losing its metadata", () => {
    const saved = {
      context_uri: "spotify:album:fixture",
      name: "Saved album",
      description: "Artist",
      image_url: "image",
    };
    const state = new PresetsUiState({
      getPreset: (slot) => (slot === 1 ? saved : undefined),
      isUnavailable: (slot) => slot === 1,
    });
    expect(state.presets[0]).toEqual({
      ...saved,
      slot_index: 1,
      type: "unavailable",
    });
    expect(state.presets[1]).toEqual({ slot_index: 2, type: "placeholder" });
  });

  test("queue adaptation preserves the explicit-content flag needed by the row badge", () => {
    const incoming = {
      queue_index: 0,
      uid: "item",
      uri: "spotify:track:fixture",
      name: "Track",
      artist_name: "Artist",
      image_uri: "",
      provider: "spotify",
      identifier: "fixture",
      explicit: true,
    };
    expect(new QueueItem(incoming).explicit).toBe(true);
    expect(new QueueItem({ ...incoming, explicit: false }).explicit).toBe(
      false,
    );
  });
});
