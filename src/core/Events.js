// Tiny pub/sub used for ALL cross-module communication.
// Event names + payloads are defined in src/ARCHITECTURE.md — use only those.
export class Emitter {
  constructor() {
    this._map = new Map();
  }

  on(name, fn) {
    let set = this._map.get(name);
    if (!set) this._map.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  off(name, fn) {
    this._map.get(name)?.delete(fn);
  }

  emit(name, data) {
    const set = this._map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[events] error in '${name}' handler:`, err);
      }
    }
  }
}
