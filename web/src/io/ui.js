// io/ui.js
//
// The product face: two collapsible panels. LEFT = playing & musical parameters
// (transport, sound, tracks). RIGHT = visualisation parameters (surface look,
// head look, colours, flash). Pure DOM — it only TALKS to the engine/view/
// audio/midi adapters, the core never sees it. Keyboard shortcuts keep working.

import { MELODIC, DRUMS, COLLISION_SOUNDS } from './audio.js';
import { SCALE_NAMES, NOTE_NAMES } from '../core/scales.js';

export class UIPanel {
  constructor({ engine, view, audio, sequencer, midi, controls, flags, setDivisions }) {
    this.engine = engine;
    this.view = view;
    this.audio = audio;
    this.sequencer = sequencer;
    this.midi = midi;
    this.controls = controls;
    this.flags = flags; // { noteSound, collisionSound } — read by main's router
    this.setDivisions = setDivisions || (() => {}); // main's grid-resolution rebuild
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

    // hidden file input for "Load JSON"
    this._fileInput = el('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = '.json,application/json';
    this._fileInput.style.display = 'none';
    document.body.appendChild(this._fileInput);
    this._fileInput.addEventListener('change', async () => {
      const f = this._fileInput.files && this._fileInput.files[0];
      if (!f) return;
      try {
        this.applyParams(JSON.parse(await f.text()));
      } catch (err) {
        console.error('session load failed', err);
      }
      this._fileInput.value = '';
    });

    // 'p' toggles the live parameter listing (every tweakable, one overlay)
    this._paramsOverlay = null;
    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target && ev.target.tagName) || '';
      if ((ev.key === 'p' || ev.key === 'P') && !/INPUT|SELECT|TEXTAREA/.test(tag)) this._toggleParams();
    });
  }

  _section(title, panel = this.panel) {
    const s = el('div', 'ui-sec');
    s.appendChild(el('div', 'ui-sec-title', title));
    panel.appendChild(s);
    return s;
  }

  // ---- Transport (one full-width row) ---------------------------------------
  _buildTransport() {
    const s = this._section('Transport');
    const row = el('div', 'ui-row');

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
    row.append(this.playBtn, this.modeBtn, this.railBtn);

    row.appendChild(el('label', 'ui-label slim', 'BPM'));
    this.bpmInput = el('input', 'ui-num');
    this.bpmInput.type = 'number';
    this.bpmInput.min = 20;
    this.bpmInput.max = 400;
    this.bpmInput.step = 5;
    this.bpmInput.addEventListener('change', () => {
      this.engine.bpm = Math.max(20, Math.min(400, +this.bpmInput.value || 120));
      this.refresh();
    });
    row.appendChild(this.bpmInput);

    row.append(
      button('Align bar', () => {
        this.engine.alignHeads();
        this.refresh();
      }),
      button('Swap H↔V', () => {
        this.engine.swapBands();
        this.refresh();
      }),
      button('Reset heads', () => {
        this.engine.resetHeads();
        this.refresh();
      }),
      button('Reset notes', () => {
        this.sequencer.clear();
        this.view.refreshArmedCells(this.sequencer);
      }),
      button('Save JSON', () => this._saveJSON()),
      button('Load JSON', () => this._fileInput.click()),
      button('Params (P)', () => this._toggleParams()),
    );
    s.appendChild(row);
  }

  // ---- Sound (one full-width row; tuning is PER TRACK, in the Tracks rows) ---
  _buildSound() {
    const s = this._section('Sound');
    const row = el('div', 'ui-row');

    this.noteChk = inlineCheck(row, 'Notes', true, (on) => (this.flags.noteSound = on));
    this.collChk = inlineCheck(row, 'Collisions', true, (on) => (this.flags.collisionSound = on));

    row.appendChild(el('label', 'ui-label slim', 'Collision'));
    this.collSel = el('select', 'ui-select');
    COLLISION_SOUNDS.forEach((name, i) => this.collSel.appendChild(option(name, i)));
    this.collSel.addEventListener('change', () => {
      this.audio.collisionSound = +this.collSel.value;
      this.audio.playCollision({}); // audition it
    });
    row.appendChild(this.collSel);

    this.midiChk = inlineCheck(row, 'MIDI out', false, async (on) => {
      this.midi.enabled = on;
      if (on && !this.midi.access) {
        const outs = await this.midi.init();
        this._fillMidiOutputs(outs);
      }
      this.refresh();
    });
    row.appendChild(el('label', 'ui-label slim', 'Device'));
    this.midiSel = el('select', 'ui-select');
    this.midiSel.addEventListener('change', () => this.midi.selectOutput(this.midiSel.value));
    row.appendChild(this.midiSel);
    row.appendChild(el('label', 'ui-label slim', 'Ch'));
    this.chanSel = el('select', 'ui-select ui-chan');
    for (let c = 1; c <= 16; c++) this.chanSel.appendChild(option(String(c), c));
    this.chanSel.addEventListener('change', () => (this.midi.channel = +this.chanSel.value));
    row.appendChild(this.chanSel);

    s.appendChild(row);
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

    // tiles EXTRUDE into prisms when struck: the pop dial is the prism height
    const rowP = el('div', 'ui-row');
    rowP.appendChild(el('label', 'ui-label', 'Pop'));
    this.popInput = el('input', 'ui-range');
    this.popInput.type = 'range';
    this.popInput.min = -1;
    this.popInput.max = 1;
    this.popInput.step = 0.05;
    this.popInput.title = 'prism height of a struck tile: left = into the cube, right = outward, centre = off';
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

    // the colour an ARMED cell wears (default: the body colour, brightened)
    const rowA = el('div', 'ui-row');
    rowA.appendChild(el('label', 'ui-label', 'Armed'));
    this.armedInput = el('input', 'ui-color');
    this.armedInput.type = 'color';
    this.armedInput.title = 'colour of a cell carrying a note (brightness follows its velocity)';
    this.armedInput.addEventListener('input', () => this.view.setArmedColor(this.armedInput.value));
    rowA.appendChild(this.armedInput);
    s.appendChild(rowA);

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

    // head look: LED pair / firefly light / folding square / Logic-style frame
    const rowH = el('div', 'ui-row');
    rowH.appendChild(el('label', 'ui-label', 'Heads'));
    this.headSel = el('select', 'ui-select');
    [
      ['led', 'LEDs (Fechner)'],
      ['inner', 'Firefly light'],
      ['square', 'Full square'],
      ['frame', 'Frame (outline)'],
    ].forEach(([v, l]) => this.headSel.appendChild(option(l, v)));
    this.headSel.addEventListener('change', () => this.view.setHeadStyle(this.headSel.value));
    rowH.appendChild(this.headSel);
    s2.appendChild(rowH);

    // ---- Firefly tuning (the 'inner' head style) ---------------------------
    const s3 = this._section('Firefly', this.panelR);

    const rowD = el('div', 'ui-row');
    rowD.appendChild(el('label', 'ui-label', 'Depth'));
    this.depthInput = el('input', 'ui-range');
    this.depthInput.type = 'range';
    this.depthInput.min = -0.4;
    this.depthInput.max = 0.4;
    this.depthInput.step = 0.01;
    this.depthInput.title = 'distance from the surface: right = inside the cube, left = OUTSIDE';
    this.depthInput.addEventListener('input', () => this.view.setHeadDepth(+this.depthInput.value));
    rowD.appendChild(this.depthInput);
    s3.appendChild(rowD);

    const rowCo = el('div', 'ui-row');
    rowCo.appendChild(el('label', 'ui-label', 'Core'));
    this.coreInput = el('input', 'ui-range');
    this.coreInput.type = 'range';
    this.coreInput.min = 0;
    this.coreInput.max = 1;
    this.coreInput.step = 0.05;
    this.coreInput.title = 'size of the visible core sphere (0 = pure light, no sphere)';
    this.coreInput.addEventListener('input', () => this.view.setHeadCoreSize(+this.coreInput.value));
    rowCo.appendChild(this.coreInput);
    s3.appendChild(rowCo);

    const rowMi = el('div', 'ui-row');
    rowMi.appendChild(el('label', 'ui-label', 'Mirror'));
    this.mirrorChk = el('input', 'ui-check');
    this.mirrorChk.type = 'checkbox';
    this.mirrorChk.title = 'an invisible twin light mirrored on the other side of the surface (fake diffusion)';
    this.mirrorChk.addEventListener('change', () => this.view.setMirrorFirefly(this.mirrorChk.checked));
    rowMi.appendChild(this.mirrorChk);
    s3.appendChild(rowMi);

    // the NOTE lights the firefly: idle = dim + desaturated, over a note = bright
    const rowBr = el('div', 'ui-row');
    rowBr.appendChild(el('label', 'ui-label', 'Bright'));
    this.brightInput = el('input', 'ui-range');
    this.brightInput.type = 'range';
    this.brightInput.min = 0;
    this.brightInput.max = 10;
    this.brightInput.step = 0.1;
    this.brightInput.title = 'light intensity while the firefly is OVER an armed note';
    this.brightInput.addEventListener('input', () => this.view.setFireflyBright(+this.brightInput.value));
    rowBr.appendChild(this.brightInput);
    s3.appendChild(rowBr);

    const rowDm = el('div', 'ui-row');
    rowDm.appendChild(el('label', 'ui-label', 'Dim'));
    this.dimInput = el('input', 'ui-range');
    this.dimInput.type = 'range';
    this.dimInput.min = 0;
    this.dimInput.max = 3;
    this.dimInput.step = 0.05;
    this.dimInput.title = 'idle light intensity (between notes)';
    this.dimInput.addEventListener('input', () => this.view.setFireflyDim(+this.dimInput.value));
    rowDm.appendChild(this.dimInput);
    s3.appendChild(rowDm);

    const rowDs = el('div', 'ui-row');
    rowDs.appendChild(el('label', 'ui-label', 'Desat'));
    this.desatInput = el('input', 'ui-range');
    this.desatInput.type = 'range';
    this.desatInput.min = 0;
    this.desatInput.max = 1;
    this.desatInput.step = 0.05;
    this.desatInput.title = 'how washed-out the idle firefly is (0 = full colour, 1 = white)';
    this.desatInput.addEventListener('input', () => this.view.setFireflyDesat(+this.desatInput.value));
    rowDs.appendChild(this.desatInput);
    s3.appendChild(rowDs);
  }

  // ---- Tracks ---------------------------------------------------------------
  // One full-width ROW per track, Logic step-sequencer style: identity (colour
  // dot · band) · Mute / Solo · instrument · duration · key + octave · scale ·
  // phase shift · reset.
  _buildTracks() {
    const s = this._section('Tracks');

    // stage row: how many tracks per band + how fine the grid is
    const rowN = el('div', 'ui-row');
    rowN.appendChild(el('label', 'ui-label slim', 'Heads ×2'));
    this.countSel = el('select', 'ui-select ui-chan');
    for (let n = 1; n <= 8; n++) this.countSel.appendChild(option(String(n), n));
    this.countSel.title = 'tracks per band (one H + one V each)';
    this.countSel.addEventListener('change', () => {
      this._applyTrackCount(+this.countSel.value);
      this.refresh();
    });
    rowN.appendChild(this.countSel);

    rowN.appendChild(el('label', 'ui-label slim', 'Grid'));
    this.gridSel = el('select', 'ui-select ui-chan');
    for (let n = 1; n <= 16; n++) this.gridSel.appendChild(option(String(n), n));
    this.gridSel.title = 'divisions per face side (changing it clears the score)';
    this.gridSel.addEventListener('change', () => {
      this.setDivisions(+this.gridSel.value);
      this.refresh();
    });
    rowN.appendChild(this.gridSel);
    s.appendChild(rowN);

    const list = el('div', 'ui-track-list');
    s.appendChild(list);
    this.trackRows = [];
    // step DURATION, Logic-style: ×4 bars per step down to 1/64 steps
    // (value = cells per beat; '1/4' = one cell per beat, the old ×1)
    const DURS = [
      ['×4', '0.0625'],
      ['×2', '0.125'],
      ['1/1', '0.25'],
      ['1/2', '0.5'],
      ['1/4', '1'],
      ['1/8', '2'],
      ['1/16', '4'],
      ['1/32', '8'],
      ['1/64', '16'],
    ];
    this.engine.balls.forEach((ball, i) => {
      const row = el('div', 'ui-row ui-track');

      const dot = el('span', 'ui-dot');
      dot.style.background = ball.color;
      row.appendChild(dot);
      const kindEl = el('span', 'ui-kind', ball.kind === 'V' ? 'V' : 'H');
      row.appendChild(kindEl);

      const mBtn = el('button', 'ui-btn ui-mini', 'M');
      mBtn.title = 'mute (pause) this head — its notes stay live for the other band';
      mBtn.addEventListener('click', () => {
        this.controls.toggleHeadPause(i);
        this.refresh();
      });
      const sBtn = el('button', 'ui-btn ui-mini', 'S');
      sBtn.title = 'solo — only soloed heads run';
      sBtn.addEventListener('click', () => {
        ball.solo = !ball.solo;
        this.engine.refreshSolo();
        this.refresh();
      });
      row.append(mBtn, sBtn);

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

      row.appendChild(el('span', 'ui-sub-label', 'dur'));
      const durSel = el('select', 'ui-select ui-rate');
      DURS.forEach(([l, v]) => durSel.appendChild(option(l, v)));
      durSel.title = 'step duration (how fast this head walks the grid)';
      durSel.addEventListener('change', () => (ball.rate = +durSel.value));
      row.appendChild(durSel);

      row.appendChild(el('span', 'ui-sub-label', 'key'));
      const keySel = el('select', 'ui-select ui-rate');
      NOTE_NAMES.forEach((n, k) => keySel.appendChild(option(n, k)));
      keySel.addEventListener('change', () => {
        if (ball.band) ball.band.root = Math.floor(ball.band.root / 12) * 12 + +keySel.value;
      });
      row.appendChild(keySel);
      const octDn = el('button', 'ui-btn ui-mini', '−');
      octDn.title = 'octave down';
      octDn.addEventListener('click', () => {
        if (ball.band) ball.band.root = Math.max(12, ball.band.root - 12);
      });
      const octUp = el('button', 'ui-btn ui-mini', '+');
      octUp.title = 'octave up';
      octUp.addEventListener('click', () => {
        if (ball.band) ball.band.root = Math.min(108, ball.band.root + 12);
      });
      row.append(octDn, octUp);

      const scaleSel = el('select', 'ui-select ui-scale');
      SCALE_NAMES.forEach((n) => scaleSel.appendChild(option(n, n)));
      scaleSel.title = 'this track\u2019s scale (all modes)';
      scaleSel.addEventListener('change', () => {
        if (ball.band) ball.band.scale = scaleSel.value;
      });
      row.appendChild(scaleSel);

      const back = el('button', 'ui-btn ui-mini', '◀');
      back.title = 'shift this head one cell back (phase)';
      back.addEventListener('click', () => this.engine.shiftHead(i, -1));
      const fwd = el('button', 'ui-btn ui-mini', '▶');
      fwd.title = 'shift this head one cell forward (phase)';
      fwd.addEventListener('click', () => this.engine.shiftHead(i, +1));
      const rst = el('button', 'ui-btn ui-mini', '↺');
      rst.title = 'reset this head to its spawn position';
      rst.addEventListener('click', () => {
        this.engine.resetHead(ball);
        this.refresh();
      });
      row.append(back, fwd, rst);

      list.appendChild(row);
      this.trackRows.push({ row, sel, durSel, keySel, scaleSel, mBtn, sBtn, kindEl });
    });

    // initial stage size = however many tracks main.js woke up
    this.trackCount = Math.max(1, this.engine.balls.filter((b) => b.active !== false && b.kind === 'H').length);
    this._applyTrackCount(this.trackCount);
  }

  // Put N tracks per band on stage; the rest vanish (engine, view and list).
  _applyTrackCount(n) {
    this.trackCount = n;
    this.engine.balls.forEach((ball, i) => {
      const t = ball.track ?? i;
      const on = t < n;
      ball.active = on;
      if (this.trackRows[i]) this.trackRows[i].row.style.display = on ? '' : 'none';
    });
    this.engine.refreshSolo();
  }

  // ---- session parameters: collect / apply / save / load / show -------------
  // EVERY tweakable in one plain object — the session. Saved as JSON, loadable,
  // and listable live with the 'p' key.
  collectParams() {
    const v = this.view,
      e = this.engine;
    return {
      version: 1,
      divisions: e.cells,
      trackCount: this.trackCount,
      transport: { bpm: e.bpm, stepMode: e.stepMode, railed: e.railed, gravity: e.gravityStrength },
      sound: {
        noteSound: this.flags.noteSound,
        collisionSound: this.flags.collisionSound,
        collisionIndex: this.audio.collisionSound,
        midiEnabled: this.midi.enabled,
        midiChannel: this.midi.channel,
      },
      view: {
        surfaceStyle: v.surfaceStyle,
        facetGap: v.facetGap,
        popAmount: v.popAmount,
        cubeOpacity: v.cubeOpacity,
        cubeColor: v.cubeColor,
        armedColor: v.armedColor,
        gridColor: this.gridColorInput.value,
        flashMode: v.flashMode,
        headStyle: v.headStyle,
        headDepth: v.headDepth,
        headCoreSize: v.headCoreSize,
        mirrorFirefly: v.mirrorFirefly,
        fireflyBright: v.fireflyBright,
        fireflyDim: v.fireflyDim,
        fireflyDesat: v.fireflyDesat,
      },
      tracks: e.balls.map((b) => ({
        kind: b.kind,
        track: b.track,
        color: b.color,
        instrument: b.instrument,
        rate: b.rate,
        muted: !!b.muted,
        solo: !!b.solo,
        scale: b.band ? b.band.scale : undefined,
        root: b.band ? b.band.root : undefined,
      })),
      score: Object.fromEntries(this.sequencer.armed),
    };
  }

  applyParams(p) {
    if (!p || typeof p !== 'object') return;
    if (p.divisions && p.divisions !== this.engine.cells) this.setDivisions(p.divisions); // clears the score
    const t = p.transport || {};
    if (t.bpm != null) this.engine.bpm = t.bpm;
    if (t.stepMode != null) this.engine.stepMode = t.stepMode;
    if (t.railed != null) this.engine.railed = t.railed;
    if (t.gravity != null) this.engine.gravityStrength = t.gravity;
    const sn = p.sound || {};
    if (sn.noteSound != null) this.flags.noteSound = sn.noteSound;
    if (sn.collisionSound != null) this.flags.collisionSound = sn.collisionSound;
    if (sn.collisionIndex != null) this.audio.collisionSound = sn.collisionIndex;
    if (sn.midiChannel != null) this.midi.channel = sn.midiChannel;
    const vw = p.view || {};
    if (vw.surfaceStyle != null) this.view.setSurfaceStyle(vw.surfaceStyle);
    if (vw.facetGap != null) this.view.setFacetGap(vw.facetGap);
    if (vw.popAmount != null) this.view.setPopAmount(vw.popAmount);
    if (vw.cubeOpacity != null) this.view.setCubeOpacity(vw.cubeOpacity);
    if (vw.cubeColor != null) this.view.setCubeColor(vw.cubeColor);
    if (vw.armedColor != null) this.view.setArmedColor(vw.armedColor);
    if (vw.gridColor != null) {
      this.view.setGridColor(vw.gridColor);
      this.gridColorInput.value = vw.gridColor;
    }
    if (vw.flashMode != null) this.view.setFlashMode(vw.flashMode);
    if (vw.headStyle != null) this.view.setHeadStyle(vw.headStyle);
    if (vw.headDepth != null) this.view.setHeadDepth(vw.headDepth);
    if (vw.headCoreSize != null) this.view.setHeadCoreSize(vw.headCoreSize);
    if (vw.mirrorFirefly != null) this.view.setMirrorFirefly(vw.mirrorFirefly);
    if (vw.fireflyBright != null) this.view.setFireflyBright(vw.fireflyBright);
    if (vw.fireflyDim != null) this.view.setFireflyDim(vw.fireflyDim);
    if (vw.fireflyDesat != null) this.view.setFireflyDesat(vw.fireflyDesat);
    (p.tracks || []).forEach((tp, i) => {
      const b = this.engine.balls[i];
      if (!b) return;
      if (tp.instrument != null) b.instrument = tp.instrument;
      if (tp.rate != null) b.rate = tp.rate;
      if (tp.muted != null) b.muted = tp.muted;
      if (tp.solo != null) b.solo = tp.solo;
      if (b.band && tp.scale != null) b.band.scale = tp.scale;
      if (b.band && tp.root != null) b.band.root = tp.root;
    });
    this.engine.refreshSolo();
    if (p.trackCount) this._applyTrackCount(p.trackCount);
    if (p.score) {
      this.sequencer.clear();
      for (const [k, vel] of Object.entries(p.score)) this.sequencer.armed.set(k, vel);
    }
    this.view.refreshArmedCells(this.sequencer);
    this.refresh();
  }

  _saveJSON() {
    const blob = new Blob([JSON.stringify(this.collectParams(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cube-carillon-session.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _toggleParams() {
    if (this._paramsOverlay) {
      this._paramsOverlay.remove();
      this._paramsOverlay = null;
      return;
    }
    const ov = el('div', 'params-overlay');
    const pre = el('pre', null, JSON.stringify(this.collectParams(), null, 2));
    ov.append(el('div', 'params-title', 'session parameters — press P or click to close'), pre);
    ov.addEventListener('click', () => this._toggleParams());
    document.body.appendChild(ov);
    this._paramsOverlay = ov;
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
    this.armedInput.value = this.view.armedColor;
    this.flashSel.value = this.view.flashMode;
    this.headSel.value = this.view.headStyle;
    this.depthInput.value = this.view.headDepth;
    this.coreInput.value = this.view.headCoreSize;
    this.mirrorChk.checked = this.view.mirrorFirefly;
    this.brightInput.value = this.view.fireflyBright;
    this.dimInput.value = this.view.fireflyDim;
    this.desatInput.value = this.view.fireflyDesat;
    this.countSel.value = this.trackCount;
    this.gridSel.value = String(this.engine.cells);
    this.chanSel.value = this.midi.channel;
    this.midiSel.disabled = !this.midi.enabled;
    this.chanSel.disabled = !this.midi.enabled;
    this.engine.balls.forEach((ball, i) => {
      const r = this.trackRows[i];
      r.sel.value = ball.instrument;
      r.kindEl.textContent = ball.kind === 'V' ? 'V' : 'H';
      r.durSel.value = String(ball.rate);
      r.mBtn.classList.toggle('on', !!ball.muted);
      r.sBtn.classList.toggle('on', !!ball.solo);
      if (ball.band) {
        r.scaleSel.value = ball.band.scale;
        r.keySel.value = ((ball.band.root % 12) + 12) % 12;
      }
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
// a label+checkbox appended INLINE into an existing row (the one-line sections)
function inlineCheck(row, label, init, onChange) {
  const wrap = el('label', 'ui-check ui-inline');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = init;
  c.addEventListener('change', () => onChange(c.checked));
  wrap.append(c, el('span', null, label));
  row.appendChild(wrap);
  return c;
}
