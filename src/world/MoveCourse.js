// RANGE — world/MoveCourse.js
// Movement-course lap timer: START/FINISH plate detection from the player's feet
// position, fixed-step lap timing, best-time persistence ('bestLap' setting),
// shootable-gate tracking (gate Targets are built and owned by Targets.js —
// this module reads ctx.world.targets.gates and listens for target:hit on them).
//
// Emits: course:start {}, course:finish { time, best, bestTime },
//        course:gate { index, total }, course:reset {}.
// Listens: target:hit, course:reset.
// Exposes: running, currentTime, bestTime, reset().
import * as THREE from 'three';

export class MoveCourse {
  constructor(ctx) {
    this.ctx = ctx;

    // -- public state ------------------------------------------------------
    this.running = false;
    this.currentTime = 0;
    this.bestTime = ctx.settings.get('bestLap', null);

    // -- tunables ----------------------------------------------------------
    this.params = {
      stillCancelSec: 20,  // standing still this long during a run cancels it
      stillSpeed: 0.35,    // m/s below which the player counts as "still"
      plateYPad: 1.2,      // extra vertical tolerance on plate AABBs
    };

    // -- internals ---------------------------------------------------------
    this._stillTime = 0;
    this._wasInStart = false;
    this._wasInFinish = false;
    this._gateHits = new Set();

    const course = ctx.world?.range?.anchors?.course ?? null;
    this._startBox = course?.start ? this._plate(course.start) : null;
    this._finishBox = course?.finish ? this._plate(course.finish) : null;

    ctx.events.on('target:hit', (d) => this._onTargetHit(d));
    ctx.events.on('course:reset', () => this._doReset(false));

    const t = ctx.tunables;
    t.push({ cat: 'targets', key: 'courseStillCancelSec', obj: this.params, prop: 'stillCancelSec', min: 5, max: 60, step: 1, label: 'Course still-cancel (s)' });
    t.push({ cat: 'targets', key: 'courseStillSpeed', obj: this.params, prop: 'stillSpeed', min: 0.05, max: 2, step: 0.05, label: 'Course still speed (m/s)' });
  }

  // Centered AABB around plate pos with plate size, padded vertically so the
  // feet position registers even if the plate volume is thin.
  _plate(def) {
    if (!def?.pos || !def?.size) return null;
    const hx = def.size.x / 2, hy = def.size.y / 2, hz = def.size.z / 2;
    const pad = this.params.plateYPad;
    return {
      min: new THREE.Vector3(def.pos.x - hx, def.pos.y - hy - pad, def.pos.z - hz),
      max: new THREE.Vector3(def.pos.x + hx, def.pos.y + hy + pad, def.pos.z + hz),
    };
  }

  _inside(box, p) {
    return !!box &&
      p.x >= box.min.x && p.x <= box.max.x &&
      p.y >= box.min.y && p.y <= box.max.y &&
      p.z >= box.min.z && p.z <= box.max.z;
  }

  _gates() {
    return this.ctx.world?.targets?.gates ?? [];
  }

  // -- lifecycle -----------------------------------------------------------

  fixedUpdate(dt) {
    const ctrl = this.ctx.player?.controller;
    if (!ctrl?.position) return;
    const pos = ctrl.position;

    const inStart = this._inside(this._startBox, pos);
    const inFinish = this._inside(this._finishBox, pos);

    if (inStart && !this._wasInStart && !this.running) this._startRun();

    if (this.running) {
      this.currentTime += dt;

      // Quiet cancel when the player just stands around mid-run.
      const speed = ctrl.velocity ? ctrl.velocity.length() : 999;
      if (speed < this.params.stillSpeed) {
        this._stillTime += dt;
        if (this._stillTime >= this.params.stillCancelSec) this._doReset(true);
      } else {
        this._stillTime = 0;
      }

      if (this.running && inFinish && !this._wasInFinish) this._finishRun();
    }

    this._wasInStart = inStart;
    this._wasInFinish = inFinish;
  }

  // -- run control -----------------------------------------------------------

  _startRun() {
    this.running = true;
    this.currentTime = 0;
    this._stillTime = 0;
    this._gateHits.clear();
    for (const g of this._gates()) g.setDimmed?.(false);
    this.ctx.events.emit('course:start', {});
    this.ctx.audio?.play?.('beep_go', { volume: 0.9 });
  }

  _finishRun() {
    this.running = false;
    const time = this.currentTime;
    const best = this.bestTime == null || time < this.bestTime;
    if (best) {
      this.bestTime = time;
      this.ctx.settings.set('bestLap', time);
      this.ctx.audio?.play?.('lap_best', { volume: 1 });
    } else {
      this.ctx.audio?.play?.('beep', { volume: 0.6, rate: 1.5 });
    }
    this.ctx.events.emit('course:finish', { time, best, bestTime: this.bestTime });
  }

  _onTargetHit(data) {
    const tgt = data?.target;
    if (!this.running || !tgt || tgt.gateIndex == null) return;
    if (this._gateHits.has(tgt.gateIndex)) return;
    this._gateHits.add(tgt.gateIndex);
    tgt.setDimmed?.(true); // gate visually dims once collected this run
    this.ctx.events.emit('course:gate', { index: tgt.gateIndex, total: this._gates().length });
  }

  /** Public reset — stops any run, restores gates, emits course:reset. */
  reset() {
    this._doReset(false);
    this.ctx.events.emit('course:reset', {});
  }

  _doReset(emit) {
    this.running = false;
    this.currentTime = 0;
    this._stillTime = 0;
    this._gateHits.clear();
    for (const g of this._gates()) g.setDimmed?.(false);
    if (emit) this.ctx.events.emit('course:reset', {});
  }
}
