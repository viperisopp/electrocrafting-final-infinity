// blackhole event (M5/M6). Interface: spawn(shipPos, heading), update(dt), isTriggered(), memoryId.

export function createBlackHole() {
  return {
    memoryId: null,
    spawn(shipPos, heading) {},
    update(dt) {},
    isTriggered() {
      return false;
    },
  };
}
