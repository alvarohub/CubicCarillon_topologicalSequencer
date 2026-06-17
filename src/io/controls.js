// io/controls.js
//
// Sensing adapter. Translates user / device input into engine + view commands,
// keeping the simulation oblivious to *how* it is being driven:
//
//   - keyboard:    Space pause · g gravity · m step/continuous · r rail/derail
//                  · a align bar · + / - BPM · [ ] cube opacity
//   - pointer tap: click a HEAD -> pause/unpause its track · right-click a HEAD
//                  -> instrument menu · click a CELL -> toggle score
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
    this.onChange = null; // optional: UI panel mirror, called after any state change
    this._menu = null;
    this._wireKeyboard();
    this._wirePicking();
    this._wireVelocity();
    this._wireStart(startButtonId);
  }

  _notify() {
    this.onChange?.();
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
        for (const k of ['X', 'Y', 'Z']) this.engine.alignGroup(k);
        this.statusFn('groups aligned to their latest tracks');
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
      this._notify();
    });
  }

  // route taps from the view's raycaster:
  //   cell        -> toggle the score
  //   head CLICK  -> pause/unpause that head (ONLY the head stops — the notes on
  //                  its track stay live for the perpendicular band)
  //   head RIGHT-CLICK -> instrument menu
  _wirePicking() {
    this.view.pickHandler = (res, ev) => {
      if (res.type === 'cell') {
        const on = this.sequencer.toggleCell(res.faceId, res.i, res.j);
        if (on) this._previewCell(res.faceId, res.i, res.j, res.du, res.dv); // hear it
        this.view.refreshArmedCells(this.sequencer);
        this.statusFn(`cell ${res.faceId}:${res.i}:${res.j} ${on ? 'armed' : 'off'}`);
      } else if (res.type === 'head') {
        if (ev.button === 2) {
          this._openInstrumentMenu(res.index, ev.clientX, ev.clientY);
        } else {
          this.toggleHeadPause(res.index);
        }
      }
    };
  }

  // The iPad velocity gesture: LONG-PRESS a cell (~0.3 s), then drag UP/DOWN to
  // set how hard that note plays — the pad's brightness encodes it. Long-pressing
  // an EMPTY cell arms it first, so arm + shape is a single gesture.
  _wireVelocity() {
    this.view.velocityHandler = (res, delta, phase) => {
      const { faceId, i, j } = res;
      if (phase === 'start') {
        if (!this.sequencer.isArmed(faceId, i, j)) {
          this.sequencer.arm(faceId, i, j);
          this.view.refreshArmedCells(this.sequencer);
          this._previewCell(faceId, i, j, res.du, res.dv); // hear the note you just armed
        }
        this._velValue = this.sequencer.velocityAt(faceId, i, j);
        this.statusFn(`velocity ${Math.round(this._velValue * 127)} — drag ↑↓`);
        return true;
      }
      if (phase === 'move') {
        this._velValue = this.sequencer.setVelocity(faceId, i, j, this._velValue + delta);
        this.view.setPadVelocity(this.sequencer.key(faceId, i, j), this._velValue);
        this.statusFn(`velocity ${Math.round(this._velValue * 127)}`);
      } else if (phase === 'end') {
        this.view.refreshArmedCells(this.sequencer);
        this.statusFn(`cell ${faceId}:${i}:${j} · velocity ${Math.round(this._velValue * 127)}`);
        this._notify();
      }
      return true;
    };
  }

  // Audible feedback when you ARM a cell: play the note that cell would sound.
  //
  // A cell has no single pitch — it is POSITIONAL, so each of the two bands whose
  // heads cross this face reads a DIFFERENT pitch from it (one from the row, one
  // from the column). To pick which one the click means, we use WHERE in the cell
  // the cursor landed: the offset (du,dv) from the cell centre. If |du| > |dv| the
  // cursor is nearer a u-edge (a "vertical" side), i.e. aiming at the head that
  // CROSSES that edge — the one travelling along u, which reads its pitch from the
  // row (its band is the face's v-axis); otherwise the v-travelling head (band =
  // face's u-axis), reading the column. An engraved pitch overrides all of this.
  // Unlocks the audio context on the click gesture so it works before "Start".
  //
  // CRUCIAL: there isn't one head per band, there's one per TRACK, and each track
  // can carry its OWN scale/key. The head that will really cross cell (i,j) is the
  // one whose fixed row/column equals the cell's perpendicular index — track == j
  // for a u-mover, track == i for a v-mover (a head keeps its spawn row, so its
  // track index IS that row). We must voice the preview through THAT exact head,
  // or the preview plays a different track's scale than the sequencer later will.
  _previewCell(faceId, i, j, du = 0, dv = 0) {
    this.audio.resume(); // the click is a user gesture → safe to unlock audio
    const seq = this.sequencer;
    const face = this.engine.surface.faceById(faceId);
    // which of the two crossing heads is the cursor aiming at?
    const uDominant = Math.abs(du) >= Math.abs(dv);
    const wantKind = uDominant ? face.vAxis : face.uAxis; // head crossing the nearer edge
    const level = uDominant ? j : i; // that head reads pitch from the perpendicular index
    const wantTrack = uDominant ? j : i; // the head on that row/column == this track
    const balls = this.engine.balls;
    // a head can voice the preview if it's on stage and not a silent carrier
    // (a PAUSED head still previews — you want to hear what you're arming)
    const usable = (b) => b.active !== false && b.instrument != null && b.instrument >= 0;
    // 1) the EXACT head that will cross this cell (right track → right per-track
    //    scale); 2) any head of the aimed band (same scale by default); 3) give up
    const ref =
      balls.find((b) => usable(b) && b.kind === wantKind && (b.track ?? 0) === wantTrack) ||
      balls.find((b) => usable(b) && b.kind === wantKind);
    if (!ref) return; // that band has no audible head to voice it
    const cell = seq.cellData ? seq.cellData(seq.key(faceId, i, j)) : null;
    const engraved = cell && cell.pitch != null ? cell.pitch : null; // absolute note wins
    const midi = engraved != null ? engraved : seq.bandFor(ref).midiForLevel(Math.max(0, level));
    const vel = seq.velocityAt(faceId, i, j) || seq.defaultVelocity || 0.7;
    this.audio.play(
      {
        midi,
        instrument: ref.instrument,
        velocity: Math.max(1, Math.min(127, Math.round(vel * 127))),
        duration: 0.25,
      },
      this.audio.now(),
    );
  }

  // Pause/unpause one head. ONLY the head stops: its armed cells keep sounding
  // for the heads of the perpendicular band (the score is shared territory).
  // The view shows the paused head ghost-transparent with a coloured contour.
  toggleHeadPause(index) {
    const ball = this.engine.balls[index];
    ball.muted = !ball.muted;
    this.statusFn(`head ${index} ${ball.muted ? 'paused' : 'running'}`);
    this._notify();
  }

  _openInstrumentMenu(headIndex, x, y) {
    this._closeMenu();
    const ball = this.engine.balls[headIndex];
    const menu = document.createElement('div');
    menu.className = 'imenu';
    const title = document.createElement('div');
    title.className = 'imenu-title';
    const bandName = ball.kind === 'X' ? 'X band' : ball.kind === 'Y' ? 'Y band' : 'Z band';
    title.textContent = `head ${headIndex} (${bandName})`;
    menu.appendChild(title);
    // "(silent)" = instrumentless carrier: no note of its own, still collides.
    const silent = document.createElement('div');
    silent.className = 'imenu-item' + (ball.instrument < 0 ? ' sel' : '');
    silent.textContent = '— silent (carrier)';
    silent.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      ball.instrument = -1;
      this.statusFn(`head ${headIndex} → silent`);
      this._closeMenu();
      this._notify();
    });
    menu.appendChild(silent);
    let lastType = null;
    INSTRUMENTS.forEach((ins, idx) => {
      if (ins.type !== lastType) {
        lastType = ins.type;
        const sec = document.createElement('div');
        sec.className = 'imenu-sec';
        sec.textContent = ins.type === 'drum' ? 'drums' : ins.type === 'sample' ? 'sampled' : 'melodic';
        menu.appendChild(sec);
      }
      const item = document.createElement('div');
      item.className = 'imenu-item' + (idx === ball.instrument ? ' sel' : '');
      item.textContent = ins.name;
      item.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        ball.instrument = idx;
        this.statusFn(`head ${headIndex} → ${ins.name}`);
        this._closeMenu();
        this._notify();
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
    // The accelerometer / device-orientation drive of the cube is DISABLED for
    // now: on a phone or iPad it made the cube spin uncontrollably and the app
    // unusable. The sensor will come back later in a subtler role (e.g. nudging
    // the tempo), so the start-button hook is kept but it no longer wires tilt
    // to the cube's rotation or to gravity. Drag still rotates the cube.
    return;
  }
}
