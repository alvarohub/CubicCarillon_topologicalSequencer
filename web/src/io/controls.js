// io/controls.js
//
// Sensing adapter. Translates user / device input into engine + view commands,
// keeping the simulation oblivious to *how* it is being driven:
//
//   - keyboard:    Space = pause, g = toggle gravity
//   - phone:       deviceorientation -> cube orientation + gravity ("tilt to roll")
//   - start button: unlocks audio + requests motion permission (iOS)
//
// On a real device this is exactly where an accelerometer / touch facets would
// plug in, with the rest of the app unchanged.

export class Controls {
  constructor({ engine, view, audio, startButtonId, statusFn }) {
    this.engine = engine;
    this.view = view;
    this.audio = audio;
    this.statusFn = statusFn || (() => {});
    this._wireKeyboard();
    this._wireStart(startButtonId);
  }

  _wireKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.engine.paused = !this.engine.paused;
        this.statusFn(this.engine.paused ? 'paused' : 'running');
      } else if (e.key === 'g' || e.key === 'G') {
        this.engine.gravityStrength = this.engine.gravityStrength > 0 ? 0 : 2.5;
        this.statusFn(this.engine.gravityStrength > 0 ? 'gravity ON' : 'gravity OFF');
      } else if (e.key === '[' || e.key === ']') {
        // dial the cube from clear acrylic to fully opaque
        const v = this.view.adjustCubeOpacity(e.key === ']' ? 0.08 : -0.08);
        this.statusFn(`cube opacity ${v.toFixed(2)}`);
      }
    });
  }

  _wireStart(startButtonId) {
    const btn = document.getElementById(startButtonId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      this.audio.resume();
      await this._requestOrientation();
      document.getElementById('overlay')?.classList.add('hidden');
    });
  }

  async _requestOrientation() {
    const DOE = window.DeviceOrientationEvent;
    try {
      if (DOE && typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission(); // iOS 13+
        if (res !== 'granted') return;
      }
    } catch {
      /* not supported; ignore */
    }

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (ev) => {
        if (ev.alpha == null) return;
        this.view.setDeviceOrientation(ev.alpha, ev.beta, ev.gamma);
        this.engine.gravityStrength = 2.5; // tilting the phone rolls the balls
        this.statusFn('tilt control active');
      });
    }
  }
}
