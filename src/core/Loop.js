// Fixed-timestep game loop (120 Hz) with render interpolation.
// timescale is the hitstop hook: setTimescale(0.05, 60) freezes the world
// for 60 real milliseconds then snaps back to 1.
// Frame delta is clamped so tab-switches don't spiral the simulation.
export class Loop {
  constructor({ fixedHz = 120, update, render } = {}) {
    this.fixedDt = 1 / fixedHz;
    this.update = update || (() => {});
    this.render = render || (() => {});
    this.timescale = 1;
    this.time = 0; // accumulated scaled game time, seconds
    this.running = false;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._tsRestoreAt = 0; // real performance.now() ms at which timescale resets
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  setTimescale(scale, durationMs = 0) {
    this.timescale = scale;
    this._tsRestoreAt = durationMs > 0 ? performance.now() + durationMs : 0;
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);

    if (this._tsRestoreAt && now >= this._tsRestoreAt) {
      this.timescale = 1;
      this._tsRestoreAt = 0;
    }

    let frameDt = (now - this._last) / 1000;
    this._last = now;
    if (frameDt > 0.1) frameDt = 0.1;
    if (frameDt < 0) frameDt = 0;

    const scaledDt = frameDt * this.timescale;
    this._acc += scaledDt;
    this.time += scaledDt;

    let steps = 0;
    while (this._acc >= this.fixedDt && steps < 10) {
      this.update(this.fixedDt);
      this._acc -= this.fixedDt;
      steps++;
    }
    if (steps >= 10) this._acc = 0; // bail out of death spirals

    const alpha = this._acc / this.fixedDt;
    this.render(scaledDt, alpha, frameDt);
  }
}
