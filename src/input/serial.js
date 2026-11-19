// Web Serial reader for the Pico + 2x AS5600 + button. (M4)
// Will output the same { pitch, yaw, button } controls object as input/keyboard.js.

export function createSerialInput() {
  return {
    connected: false,
    read() {
      return { pitch: 0, yaw: 0, button: false, dev: [] };
    },
  };
}
