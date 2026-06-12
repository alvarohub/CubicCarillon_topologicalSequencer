// io/controls.js
//
// Sensing adapter. Translates user / device input into engine + view commands,
// keeping the simulation oblivious to *how* it is being driven:
//
//   - keyboard:    Space pause · g gravity · m step/continuous · r rail/derail
//                  · a align bar · + / - BPM · [ ] cube opacity
//   - pointer tap: click a HEAD -> instrument menu · click a CELL -> toggle score
//   - phone:       deviceorientation -> cube orientation + gravity ("tilt to roll")
//   - start button: unlocks audio + requests motion permission (iOS)
//
// On a real device this is exactly where an accelerometer / touch facets would
// plug in, with the rest of the app unchanged.

import { INSTRUMENTS } from './audio.js';

export class Controls {
  constructor({ engine, view, audio, sequencer, startButtonId, statusFn }) {
    this.engine = engine;
    this.view = view;
    this.audio = audio;
    this.sequencer = sequencer;
    this.statusFn = statusFn || (() => {});
    this._menu = null;
    this._wireKeyboard();
    this._wirePicking();
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
      } else if (e.key === 'm' || e.key === 'M') {
        this.engine.stepMode = !this.engine.stepMode;
        this.statusFn(this.engine.stepMode ? `step mode · ${this.engine.bpm} BPM` : 'continuous mode');
      } else if (e.key === 'r' || e.key === 'R') {
        this.engine.railed = !this.engine.railed;
        this.statusFn(this.engine.railed ? 'railed (on tracks)' : 'derailed (free)');
      } else if (e.key === 'a' || e.key === 'A') {
        this.engine.alignHeads();
        this.statusFn('heads aligned into a bar');
      } else if (e.key === '+' || e.key === '=') {
        this.engine.bpm = Math.min(400, this.engine.bpm + 5);
        this.statusFn(`${this.engine.bpm} BPM`);
      } else if (e.key === '-' || e.key === '_') {
        this.engine.bpm = Math.max(20, this.engine.bpm - 5);
        this.statusFn(`${this.engine.bpm} BPM`);
      } else if (e.key === '[' || e.key === ']') {
        const v = this.view.adjustCubeOpacity(e.key === ']' ? 0.08 : -0.08);
        this.statusFn(`cube opacity ${v.toFixed(2)}`);
      }
    });
  }

  // route taps from the view's raycaster: head -> instrument menu, cell -> toggle
  _wirePicking() {
    this.view.pickHandler = (res, ev) => {
      if (res.type === 'cell') {
        const on = this.sequencer.toggleCell(res.faceId, res.i, res.j);
        this.view.refreshArmedCells(this.sequencer);
        this.statusFn(`cell ${res.faceId}:${res.i}:${res.j} ${on ? 'armed' : 'off'}`);
      } else if (res.type === 'head') {
        this._openInstrumentMenu(res.index, ev.clientX, ev.clientY);
      }
    };
  }

  _openInstrumentMenu(headIndex, x, y) {
    this._closeMenu();
    const ball = this.engine.balls[headIndex];
    const menu = document.createElement('div');
    menu.className = 'imenu';
    const title = document.createElement('div');
    title.className = 'imenu-title';
    title.textContent = `head ${headIndex} (${ball.kind === 'V' ? 'transversal' : 'horizontal'})`;
    menu.appendChild(title);
    INSTRUMENTS.forEach((ins, idx) => {
      const item = document.createElement('div');
      item.className = 'imenu-item' + (idx === ball.instrument ? ' sel' : '');
      item.textContent = ins.name;
      item.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        ball.instrument = idx;
        this.statusFn(`head ${headIndex} → ${ins.name}`);
        this._closeMenu();
      });
      menu.appendChild(item);
    });
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    this._menu = menu;
    // close when clicking elsewhere (next pointer down outside the menu)
    setTimeout(() => {
      this._closeBound = (e) => {
        if (this._menu && !this._menu.contains(e.target)) this._closeMenu();
      };
      window.addEventListener('pointerdown', this._closeBound, true);
    }, 0);
  }

  _closeMenu() {
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
    if (this._closeBound) {
      window.removeEventListener('pointerdown', this._closeBound, true);
      this._closeBound = null;
    }
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
