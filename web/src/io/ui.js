// io/ui.js
//
// The product face: two collapsible panels. LEFT = playing & musical parameters
// (transport, sound, tracks). RIGHT = visualisation parameters (surface look,
// head look, colours, flash). Pure DOM — it only TALKS to the engine/view/
// audio/midi adapters, the core never sees it. Keyboard shortcuts keep working.

import { MELODIC, DRUMS, COLLISION_SOUNDS } from './audio.js';

export class UIPanel {
  constructor({ engine, view, audio, sequencer, midi, controls, flags }) {
    this.engine = engine;
    this.view = view;
    this.audio = audio;
    this.sequencer = sequencer;
    this.midi = midi;
    this.controls = controls;
    this.flags = flags; // { noteSound, collisionSound } — read by main's router
    this._build();
    this.refresh();
    // anything the pointer/keyboard changes elsewhere gets mirrored here
    controls.onChange = () => this.refresh();
  }

  // ---- DOM scaffolding -----------------------------------------------------
  _build() {
    // hamburger toggle (always visible) — the LEFT (music) panel
    this.toggleBtn = el('button', 'ui-toggle', '☰');
    this.toggleBtn.title = 'music & transport';
    document.body.appendChild(this.toggleBtn);

    this.panel = el('div', 'ui-panel');
    document.body.appendChild(this.panel);
    this.toggleBtn.addEventListener('click', () => {
      this.panel.classList.toggle('open');
      this.refresh();
    });

    // the RIGHT (visuals) panel
    this.toggleBtnR = el('button', 'ui-toggle right', '◑');
    this.toggleBtnR.title = 'visuals';
    document.body.appendChild(this.toggleBtnR);

    this.panelR = el('div', 'ui-panel right');
    document.body.appendChild(this.panelR);
    this.toggleBtnR.addEventListener('click', () => {
      this.panelR.classList.toggle('open');
      this.refresh();
    });

    this._buildTransport();
    this._buildSound();
    this._buildTracks();
    this._buildVisuals();
  }

  _section(title, panel = this.panel) {
    const s = el('div', 'ui-sec');
    s.appendChild(el('div', 'ui-sec-title', title));
    panel.appendChild(s);
    return s;
  }

  // ---- Transport -----------------------------------------------------------
  _buildTransport() {
    const s = this._section('Transport');

    const row1 = el('div', 'ui-row');
    this.playBtn = button('Pause', () => {
      this.engine.paused = !this.engine.paused;
      this.refresh();
    });
    this.modeBtn = button('Step', () => {
      this.engine.stepMode = !this.engine.stepMode;
      this.refresh();
    });
    this.railBtn = button('Derail', () => {
      this.engine.railed = !this.engine.railed;
      this.refresh();
    });
    row1.append(this.playBtn, this.modeBtn, this.railBtn);
    s.appendChild(row1);

    const row2 = el('div', 'ui-row');
    row2.appendChild(el('label', 'ui-label', 'BPM'));
    this.bpmInput = el('input', 'ui-num');
    this.bpmInput.type = 'number';
    this.bpmInput.min = 20;
    this.bpmInput.max = 400;
    this.bpmInput.step = 5;
    this.bpmInput.addEventListener('change', () => {
      this.engine.bpm = Math.max(20, Math.min(400, +this.bpmInput.value || 120));
      this.refresh();
    });
    row2.appendChild(this.bpmInput);
    s.appendChild(row2);

    const row3 = el('div', 'ui-row');
    row3.append(
      button('Align bar', () => {
        this.engine.alignHeads();
        this.refresh();
      }),
      button('Swap H↔V', () => {
        this.engine.swapBands();
        this.refresh();
      }),
    );
    s.appendChild(row3);

    const row4 = el('div', 'ui-row');
    row4.append(
      button('Reset heads', () => {
        this.engine.resetHeads(); // every head back to its spawn cell + direction
        this.refresh();
      }),
      button('Reset notes', () => {
        this.sequencer.clear();
        this.view.refreshArmedCells(this.sequencer);
      }),
    );
    s.appendChild(row4);
  }

  // ---- Sound ----------------------------------------------------------------
  _buildSound() {
    const s = this._section('Sound');

    this.noteChk = checkbox(s, 'Note sound', true, (on) => (this.flags.noteSound = on));
    this.collChk = checkbox(s, 'Collision sound', true, (on) => (this.flags.collisionSound = on));

    const rowC = el('div', 'ui-row');
    rowC.appendChild(el('label', 'ui-label', 'Collision'));
    this.collSel = el('select', 'ui-select');
    COLLISION_SOUNDS.forEach((name, i) => this.collSel.appendChild(option(name, i)));
    this.collSel.addEventListener('change', () => {
      this.audio.collisionSound = +this.collSel.value;
      this.audio.playCollision({}); // audition it
    });
    rowC.appendChild(this.collSel);
    s.appendChild(rowC);

    // MIDI out
    this.midiChk = checkbox(s, 'MIDI out', false, async (on) => {
      this.midi.enabled = on;
      if (on && !this.midi.access) {
        const outs = await this.midi.init();
        this._fillMidiOutputs(outs);
      }
      this.refresh();
    });
    const rowM = el('div', 'ui-row');
    rowM.appendChild(el('label', 'ui-label', 'Device'));
    this.midiSel = el('select', 'ui-select');
    this.midiSel.addEventListener('change', () => this.midi.selectOutput(this.midiSel.value));
    rowM.appendChild(this.midiSel);
    s.appendChild(rowM);

    const rowCh = el('div', 'ui-row');
    rowCh.appendChild(el('label', 'ui-label', 'Channel'));
    this.chanSel = el('select', 'ui-select');
    for (let c = 1; c <= 16; c++) this.chanSel.appendChild(option(String(c), c));
    this.chanSel.addEventListener('change', () => (this.midi.channel = +this.chanSel.value));
    rowCh.appendChild(this.chanSel);
    s.appendChild(rowCh);
  }

  _fillMidiOutputs(outs) {
    this.midiSel.innerHTML = '';
    if (!outs.length) {
      this.midiSel.appendChild(option('— no devices —', ''));
      return;
    }
    for (const o of outs) this.midiSel.appendChild(option(o.name, o.id));
    this.midi.selectOutput(outs[0].id);
  }

  // ---- Visuals (RIGHT panel) -------------------------------------------------
  // Everything about how the instrument LOOKS, separated from how it plays.
  _buildVisuals() {
    const s = this._section('Surface', this.panelR);

    const rowS = el('div', 'ui-row');
    rowS.appendChild(el('label', 'ui-label', 'Body'));
    this.surfaceSel = el('select', 'ui-select');
    [
      ['facets', 'Facet tiles'],
      ['grid', 'Acrylic + grid'],
      ['both', 'Tiles + acrylic'],
    ].forEach(([v, l]) => this.surfaceSel.appendChild(option(l, v)));
    this.surfaceSel.addEventListener('change', () => this.view.setSurfaceStyle(this.surfaceSel.value));
    rowS.appendChild(this.surfaceSel);
    s.appendChild(rowS);

    const rowG = el('div', 'ui-row');
    rowG.appendChild(el('label', 'ui-label', 'Gap'));
    this.gapInput = el('input', 'ui-range');
    this.gapInput.type = 'range';
    this.gapInput.min = 0.02;
    this.gapInput.max = 0.4;
    this.gapInput.step = 0.01;
    this.gapInput.addEventListener('input', () => this.view.setFacetGap(+this.gapInput.value));
    rowG.appendChild(this.gapInput);
    s.appendChild(rowG);

    const rowP = el('div', 'ui-row');
    rowP.appendChild(el('label', 'ui-label', 'Pop'));
    this.popInput = el('input', 'ui-range');
    this.popInput.type = 'range';
    this.popInput.min = -1;
    this.popInput.max = 1;
    this.popInput.step = 0.05;
    this.popInput.title = 'how far a struck tile pops: left = inward, right = outward, centre = off';
    this.popInput.addEventListener('input', () => this.view.setPopAmount(+this.popInput.value));
    rowP.appendChild(this.popInput);
    s.appendChild(rowP);

    const rowO = el('div', 'ui-row');
    rowO.appendChild(el('label', 'ui-label', 'Opacity'));
    this.opacityInput = el('input', 'ui-range');
    this.opacityInput.type = 'range';
    this.opacityInput.min = 0;
    this.opacityInput.max = 1;
    this.opacityInput.step = 0.01;
    this.opacityInput.addEventListener('input', () => this.view.setCubeOpacity(+this.opacityInput.value));
    rowO.appendChild(this.opacityInput);
    s.appendChild(rowO);

    const rowC = el('div', 'ui-row');
    rowC.appendChild(el('label', 'ui-label', 'Colour'));
    this.colorInput = el('input', 'ui-color');
    this.colorInput.type = 'color';
    this.colorInput.addEventListener('input', () => this.view.setCubeColor(this.colorInput.value));
    rowC.appendChild(this.colorInput);
    s.appendChild(rowC);

    const rowGC = el('div', 'ui-row');
    rowGC.appendChild(el('label', 'ui-label', 'Grid'));
    this.gridColorInput = el('input', 'ui-color');
    this.gridColorInput.type = 'color';
    this.gridColorInput.value = '#3a4f70';
    this.gridColorInput.addEventListener('input', () => this.view.setGridColor(this.gridColorInput.value));
    rowGC.appendChild(this.gridColorInput);
    s.appendChild(rowGC);

    const s2 = this._section('Notes & heads', this.panelR);

    // strike colour: saturated instrument colour, or pure white
    const rowF = el('div', 'ui-row');
    rowF.appendChild(el('label', 'ui-label', 'Strike'));
    this.flashSel = el('select', 'ui-select');
    [
      ['instrument', 'Instrument colour'],
      ['white', 'Pure white'],
    ].forEach(([v, l]) => this.flashSel.appendChild(option(l, v)));
    this.flashSel.addEventListener('change', () => this.view.setFlashMode(this.flashSel.value));
    rowF.appendChild(this.flashSel);
    s2.appendChild(rowF);

    // head look: LED pair on the surface / firefly light inside / folding square
    const rowH = el('div', 'ui-row');
    rowH.appendChild(el('label', 'ui-label', 'Heads'));
    this.headSel = el('select', 'ui-select');
    [
      ['led', 'LEDs (Fechner)'],
      ['inner', 'Firefly light'],
      ['square', 'Full square'],
    ].forEach(([v, l]) => this.headSel.appendChild(option(l, v)));
    this.headSel.addEventListener('change', () => this.view.setHeadStyle(this.headSel.value));
    rowH.appendChild(this.headSel);
    s2.appendChild(rowH);
  }

  // ---- Tracks ---------------------------------------------------------------
  // Two lines per track: identity (colour · band · instrument · pause) and
  // timing (shift the head back/forward one cell · speed as a musical multiple
  // of the global BPM · reset this head to its spawn position).
  _buildTracks() {
    const s = this._section('Tracks');
    this.trackRows = [];
    const RATES = [
      ['0.25', '×¼'],
      [String(1 / 3), '×⅓'],
      ['0.5', '×½'],
      ['1', '×1'],
      ['2', '×2'],
      ['3', '×3'],
      ['4', '×4'],
    ];
    this.engine.balls.forEach((ball, i) => {
      const box = el('div', 'ui-track-box');

      const row = el('div', 'ui-track');
      const dot = el('span', 'ui-dot');
      dot.style.background = ball.color;
      row.appendChild(dot);

      const kindEl = el('span', 'ui-kind', ball.kind === 'V' ? 'V' : 'H');
      row.appendChild(kindEl);

      const sel = el('select', 'ui-select ui-track-ins');
      const gm = el('optgroup');
      gm.label = 'Melodic';
      MELODIC.forEach((ins, k) => gm.appendChild(option(ins.name, k)));
      const gd = el('optgroup');
      gd.label = 'Drums';
      DRUMS.forEach((ins, k) => gd.appendChild(option(ins.name, MELODIC.length + k)));
      sel.append(gm, gd);
      sel.addEventListener('change', () => (ball.instrument = +sel.value));
      row.appendChild(sel);

      const pauseBtn = el('button', 'ui-btn ui-track-pause', '❚❚');
      pauseBtn.title = 'pause/resume this head (the notes stay live for the other band)';
      pauseBtn.addEventListener('click', () => {
        this.controls.toggleHeadPause(i);
        this.refresh();
      });
      row.appendChild(pauseBtn);
      box.appendChild(row);

      const sub = el('div', 'ui-track sub');
      const back = el('button', 'ui-btn ui-mini', '◀');
      back.title = 'shift this head one cell back (phase)';
      back.addEventListener('click', () => {
        this.engine.shiftHead(i, -1);
      });
      const fwd = el('button', 'ui-btn ui-mini', '▶');
      fwd.title = 'shift this head one cell forward (phase)';
      fwd.addEventListener('click', () => {
        this.engine.shiftHead(i, +1);
      });
      sub.append(el('span', 'ui-sub-label', 'shift'), back, fwd);

      const rateSel = el('select', 'ui-select ui-rate');
      RATES.forEach(([v, l]) => rateSel.appendChild(option(l, v)));
      rateSel.title = 'this track\u2019s speed, as a multiple of the global BPM';
      rateSel.addEventListener('change', () => (ball.rate = +rateSel.value));
      sub.append(el('span', 'ui-sub-label', 'speed'), rateSel);

      const rst = el('button', 'ui-btn ui-mini', '↺');
      rst.title = 'reset this head to its spawn position';
      rst.addEventListener('click', () => {
        this.engine.resetHead(ball);
        this.refresh();
      });
      sub.appendChild(rst);
      box.appendChild(sub);

      s.appendChild(box);
      this.trackRows.push({ box, row, sel, pauseBtn, kindEl, rateSel });
    });
  }

  // ---- state mirror -----------------------------------------------------------
  refresh() {
    this.playBtn.textContent = this.engine.paused ? 'Play' : 'Pause';
    this.modeBtn.textContent = this.engine.stepMode ? 'Continuous' : 'Step';
    this.modeBtn.classList.toggle('on', this.engine.stepMode);
    this.railBtn.textContent = this.engine.railed ? 'Derail' : 'Rail';
    this.bpmInput.value = this.engine.bpm;
    this.collSel.value = this.audio.collisionSound;
    this.surfaceSel.value = this.view.surfaceStyle;
    this.gapInput.value = this.view.facetGap;
    this.popInput.value = this.view.popAmount;
    this.opacityInput.value = this.view.cubeOpacity;
    this.colorInput.value = this.view.cubeColor;
    this.flashSel.value = this.view.flashMode;
    this.headSel.value = this.view.headStyle;
    this.chanSel.value = this.midi.channel;
    this.midiSel.disabled = !this.midi.enabled;
    this.chanSel.disabled = !this.midi.enabled;
    this.engine.balls.forEach((ball, i) => {
      const r = this.trackRows[i];
      r.sel.value = ball.instrument;
      r.kindEl.textContent = ball.kind === 'V' ? 'V' : 'H';
      r.rateSel.value = String(ball.rate);
      r.pauseBtn.textContent = ball.muted ? '▶' : '❚❚';
      r.pauseBtn.classList.toggle('on', !!ball.muted);
    });
  }
}

// little DOM helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(label, onClick) {
  const b = el('button', 'ui-btn', label);
  b.addEventListener('click', onClick);
  return b;
}
function option(label, value) {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  return o;
}
function checkbox(parent, label, init, onChange) {
  const row = el('label', 'ui-row ui-check');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = init;
  c.addEventListener('change', () => onChange(c.checked));
  row.append(c, el('span', null, label));
  parent.appendChild(row);
  return c;
}
