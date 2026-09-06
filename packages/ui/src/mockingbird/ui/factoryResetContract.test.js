import { expect, spyOn, test } from "bun:test";
import * as bridge from "../../hooks/useNocturned";
import HardwareStore from "./stores/HardwareStore";
import SettingsStore from "./stores/SettingsStore";

test("both Mockingbird reset entry points leave reboot ownership with the daemon", async () => {
  const commands = [];
  const request = spyOn(bridge, "sendNocturneWsRequest").mockImplementation(
    async (method) => {
      commands.push(method);
      return { success: true };
    },
  );
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(
    (callback) => {
      callback();
      return 0;
    },
  );
  try {
    await HardwareStore.prototype.factoryReset.call({
      reboot: () => commands.push("device.power.reboot"),
    });
    await SettingsStore.prototype.doFactoryReset.call({});
    expect(commands).toEqual(["device.factoryreset", "device.factoryreset"]);
  } finally {
    timer.mockRestore();
    request.mockRestore();
  }
});
