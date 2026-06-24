// io/ui.js
//
// The product face: two collapsible panels. LEFT = playing & musical parameters
// (transport, sound, tracks). RIGHT = visualisation parameters (surface look,
// head look, colours, flash). Pure DOM — it only TALKS to the engine/view/
// audio/midi adapters, the core never sees it. Keyboard shortcuts keep working.

import { MELODIC, DRUMS, COLLISION_SOUNDS } from './audio.js';
import { SCALE_NAMES, NOTE_NAMES, SCALES } from '../core/scales.js';

export class UIPanel {
  constructor({ engine, view, audio, sequencer, midi, controls, flags, setDivisions, rotateBands, updateTrackHome }) {
    this.engine = engine;
    this.view = view;
    this.audio = audio;
    this.sequencer = sequencer;
    this.midi = midi;
    this.controls = controls;
    this.flags = flags; // { builtInSound, noteSound, collisionSound } — read by main's router
    this.setDivisions = setDivisions || (() => {}); // main's grid-resolution rebuild
    this.rotateBands = rotateBands || (() => this.engine.swapBands()); // main's band rotation
    this.updateTrackHome = updateTrackHome || (() => {}); // main owns spawn/home geometry
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

    this.playBtn = button('◯', () => {
      this.engine.paused = !this.engine.paused;
      this.refresh();
    });
    this.playBtn.title = 'global run/stop';
    this.modeBtn = button('Step', () => {
      this.engine.stepMode = !this.engine.stepMode;
      this.refresh();
    });
    this.railBtn = button('Derail', () => {
      this.engine.railed = !this.engine.railed;
      this.refresh();
    });
    this.gravityBtn = button('Gravity', async () => {
      this.engine.gravityStrength = this.engine.gravityStrength > 0 ? 0 : 2.5;
      // On first enable, request device-orientation permission (iOS needs a user gesture).
      await this.controls._requestOrientation();
      this.refresh();
    });
    row.append(this.playBtn, this.modeBtn, this.railBtn, this.gravityBtn);

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
      button('Rotate X→Y→Z', () => {
        this.rotateBands();
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

    this.builtInChk = inlineCheck(row, 'Built-in', true, (on) => (this.flags.builtInSound = on));
    this.noteChk = inlineCheck(row, 'Notes', true, (on) => (this.flags.noteSound = on));
    this.collChk = inlineCheck(row, 'Collisions', true, (on) => (this.flags.collisionSound = on));

    // What a head-on-head meeting SOUNDS like (one global source):
    //   Heads = both heads' instruments together · Cell = the armed note under
    //   the meeting · Fixed = the chosen independent collision voice below.
    row.appendChild(el('label', 'ui-label slim', 'On hit'));
    this.collSrcSel = el('select', 'ui-select');
    [
      ['heads', 'Heads'],
      ['cell', 'Cell note'],
      ['fixed', 'Fixed'],
    ].forEach(([v, l]) => this.collSrcSel.appendChild(option(l, v)));
    this.collSrcSel.value = this.sequencer.collisionSource;
    this.collSrcSel.addEventListener('change', () => {
      this.sequencer.collisionSource = this.collSrcSel.value;
    });
    row.appendChild(this.collSrcSel);

    row.appendChild(el('label', 'ui-label slim', 'Fixed'));
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
        // Auto-refresh the device list whenever ports appear/disappear (hot-plug).
        this.midi.onDeviceChange = (outs) => this._fillMidiOutputs(outs);
      }
      this.refresh();
    });
    row.appendChild(el('label', 'ui-label slim', 'Device'));
    this.midiSel = el('select', 'ui-select');
    this.midiSel.addEventListener('change', () => this.midi.selectOutput(this.midiSel.value));
    row.appendChild(this.midiSel);

    // Refresh button: re-scans ports without toggling MIDI out — useful on iOS
    // where AUM virtual ports may appear after the checkbox was first enabled.
    const midiRefreshBtn = el('button', 'ui-btn', '⟳');
    midiRefreshBtn.title = 'Refresh MIDI device list';
    midiRefreshBtn.addEventListener('click', async () => {
      const outs = this.midi.access ? this.midi.outputs() : await this.midi.init();
      this._fillMidiOutputs(outs);
    });
    row.appendChild(midiRefreshBtn);

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
      const err = this.midi._error || '';
      const label = err.toLowerCase().includes('not supported')
        ? '⚠ Web MIDI unavailable — Safari does not support the Web MIDI API. On iPad/iPhone, use AUM (AudioBus Multitrack) for MIDI routing. On macOS, try a Chromium-based browser (Chrome/Edge).'
        : '— no devices —';
      this.midiSel.appendChild(option(label, ''));
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

    const rowAm = el('div', 'ui-row');
    rowAm.appendChild(el('label', 'ui-label', 'Ambient'));
    this.ambientInput = el('input', 'ui-range');
    this.ambientInput.type = 'range';
    this.ambientInput.min = 0;
    this.ambientInput.max = 6;
    this.ambientInput.step = 0.05;
    this.ambientInput.title = 'global fill light intensity';
    this.ambientInput.addEventListener('input', () => this.view.setAmbientIntensity(+this.ambientInput.value));
    rowAm.appendChild(this.ambientInput);
    s.appendChild(rowAm);

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

    const rowBG = el('div', 'ui-row');
    rowBG.appendChild(el('label', 'ui-label', 'Background'));
    this.bgColorInput = el('input', 'ui-color');
    this.bgColorInput.type = 'color';
    this.bgColorInput.value = this.view.bgColor || '#0a0c12';
    this.bgColorInput.title = 'scene background colour (behind the cube)';
    this.bgColorInput.addEventListener('input', () => this.view.setBackgroundColor(this.bgColorInput.value));
    rowBG.appendChild(this.bgColorInput);
    s.appendChild(rowBG);

    const rowRot = el('div', 'ui-row');
    this.spinChk = inlineCheck(rowRot, 'Spin', false, (on) => this.view.setAutoRotate(on));
    rowRot.appendChild(el('span', 'ui-sub-label', 'Auto rotate'));
    s.appendChild(rowRot);

    const rowLab = el('div', 'ui-row');
    rowLab.appendChild(el('label', 'ui-label', 'Labels'));
    this.labelXChk = inlineCheck(rowLab, 'X', false, (on) => this.view.setAxisLabelsVisible('X', on));
    this.labelYChk = inlineCheck(rowLab, 'Y', false, (on) => this.view.setAxisLabelsVisible('Y', on));
    this.labelZChk = inlineCheck(rowLab, 'Z', false, (on) => this.view.setAxisLabelsVisible('Z', on));
    s.appendChild(rowLab);

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
  // Three grouped sequencers (X, Y, Z): each has its own track count, BPM,
  // start/stop, global shift, scale and key. Track rows stay inside the group.
  _buildTracks() {
    const s = this._section('Tracks');

    this.groupUI = {};
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
    const makeGroup = (axis) => {
      const wrap = el('div', 'ui-group');
      wrap.appendChild(el('div', 'ui-sec-title', `${axis} group`));

      const top = el('div', 'ui-row');
      top.appendChild(el('label', 'ui-label slim', `Tracks on ${axis}`));
      const countSel = el('select', 'ui-select ui-chan');
      for (let n = 1; n <= 16; n++) countSel.appendChild(option(String(n), n));
      countSel.addEventListener('change', () => {
        const n = +countSel.value;
        // A band's track count IS its world axis' division: re-shape the cuboid
        // (more tracks on K -> the box grows along K), then sync the row list.
        this.setDivisions(axis, n);
        this._applyTrackCount(axis, n);
        this.refresh();
      });
      top.appendChild(countSel);

      const runBtn = el('button', 'ui-btn ui-mini', '◯');
      runBtn.addEventListener('click', () => {
        this.engine.toggleGroupPause(axis);
        this.refresh();
      });
      runBtn.title = `${axis} group run/stop`;
      top.appendChild(runBtn);

      const muteBtn = el('button', 'ui-btn', 'Mute all');
      muteBtn.addEventListener('click', () => {
        for (const r of this.trackRows) if (r.axis === axis && r.ball.active !== false) r.ball.muted = true;
        this.refresh();
      });
      muteBtn.title = `${axis} group mute note output`;
      const openBtn = el('button', 'ui-btn', 'Open all');
      openBtn.addEventListener('click', () => {
        for (const r of this.trackRows) if (r.axis === axis && r.ball.active !== false) r.ball.muted = false;
        this.refresh();
      });
      openBtn.title = `${axis} group unmute note output`;
      top.append(muteBtn, openBtn);

      const shiftL = el('button', 'ui-btn ui-mini', '◀');
      shiftL.title = `shift ${axis} group one cell back`;
      shiftL.addEventListener('click', () => {
        for (const r of this.trackRows)
          if (r.axis === axis && r.ball.active !== false) this.engine.shiftHead(r.index, -1);
      });
      const shiftR = el('button', 'ui-btn ui-mini', '▶');
      shiftR.title = `shift ${axis} group one cell forward`;
      shiftR.addEventListener('click', () => {
        for (const r of this.trackRows)
          if (r.axis === axis && r.ball.active !== false) this.engine.shiftHead(r.index, +1);
      });
      const alignBtn = el('button', 'ui-btn ui-mini', 'I');
      alignBtn.style.fontFamily = 'Georgia, "Times New Roman", serif';
      alignBtn.style.fontWeight = '700';
      alignBtn.title = `align ${axis} group — line every track up into one bar (same starting column)`;
      alignBtn.addEventListener('click', () => {
        this.engine.alignGroup(axis);
        this.refresh();
      });
      const revBtn = el('button', 'ui-btn ui-mini', '⇄');
      revBtn.title = `reverse ${axis} group direction`;
      revBtn.addEventListener('click', () => {
        for (const r of this.trackRows)
          if (r.axis === axis && r.ball.active !== false) this.engine.reverseHead(r.index);
        this.refresh();
      });
      top.append(shiftL, shiftR, alignBtn, revBtn);

      top.appendChild(el('label', 'ui-label slim', 'Scale'));
      const scaleSel = el('select', 'ui-select ui-scale');
      SCALE_NAMES.forEach((n) => scaleSel.appendChild(option(n, n)));
      scaleSel.addEventListener('change', () => {
        this._applyGroupScale(axis, scaleSel.value);
        this.refresh();
      });
      top.appendChild(scaleSel);

      top.appendChild(el('label', 'ui-label slim', 'Key'));
      const keySel = el('select', 'ui-select ui-rate');
      NOTE_NAMES.forEach((n, k) => keySel.appendChild(option(n, k)));
      keySel.addEventListener('change', () => {
        this._applyGroupKey(axis, +keySel.value);
        this.refresh();
      });
      top.appendChild(keySel);
      wrap.appendChild(top);

      const list = el('div', 'ui-track-list');
      wrap.appendChild(list);
      s.appendChild(wrap);
      this.groupUI[axis] = { wrap, list, countSel, runBtn, muteBtn, openBtn, scaleSel, keySel, revBtn };
    };

    ['X', 'Y', 'Z'].forEach(makeGroup);

    this.engine.balls.forEach((ball, i) => {
      const row = el('div', 'ui-row ui-track');
      const dot = el('span', 'ui-dot');
      dot.style.background = ball.color;
      row.appendChild(dot);
      const kindEl = el('span', 'ui-kind', `${ball.kind}${ball.track + 1}`);
      row.appendChild(kindEl);

      const runTrackBtn = el('button', 'ui-btn ui-mini', '◯');
      runTrackBtn.title = 'track run/stop';
      runTrackBtn.addEventListener('click', () => {
        this.controls.toggleHeadRun(i);
        this.refresh();
      });
      const mBtn = el('button', 'ui-btn ui-mini', 'M');
      mBtn.title = 'track note mute';
      mBtn.addEventListener('click', () => {
        ball.muted = !ball.muted;
        this.refresh();
      });
      const sBtn = el('button', 'ui-btn ui-mini', 'S');
      sBtn.addEventListener('click', () => {
        ball.solo = !ball.solo;
        this.engine.refreshSolo();
        this.refresh();
      });
      row.append(runTrackBtn, mBtn, sBtn);

      const sel = el('select', 'ui-select ui-track-ins');
      // "(silent)" = an instrumentless carrier head: it makes no note of its own
      // but still collides, so in 'Heads' collision mode only its partner sounds.
      sel.appendChild(option('— silent', -1));
      const gm = el('optgroup');
      gm.label = 'Melodic';
      MELODIC.forEach((ins, k) => gm.appendChild(option(ins.name, k)));
      const gd = el('optgroup');
      gd.label = 'Drums';
      DRUMS.forEach((ins, k) => gd.appendChild(option(ins.name, MELODIC.length + k)));
      sel.append(gm, gd);
      sel.addEventListener('change', () => (ball.instrument = +sel.value));
      row.appendChild(sel);

      row.appendChild(el('span', 'ui-sub-label', 'res'));
      const durSel = el('select', 'ui-select ui-rate');
      DURS.forEach(([l, v]) => durSel.appendChild(option(l, v)));
      durSel.addEventListener('change', () => (ball.rate = +durSel.value));
      row.appendChild(durSel);

      row.appendChild(el('span', 'ui-sub-label', 'Note'));
      // The ACTUAL note this track plays (its row's scale degree), with octave —
      // not the band tonic. Picking a note TRANSPOSES this one track so it sounds
      // that pitch; the scale tones are highlighted green so the in-scale choices
      // are obvious and a transposed track reads as a deliberate departure.
      const keySel = el('select', 'ui-select ui-note');
      for (let m = NOTE_MIN; m <= NOTE_MAX; m++) keySel.appendChild(option(noteName(m), m));
      keySel.addEventListener('change', () => {
        if (ball.band) {
          const cur = this._trackNote(ball);
          if (cur != null) ball.band.root += +keySel.value - cur; // transpose to the picked note
          this._syncGroupKeyState(ball.kind);
          if (!ball.muted) {
            const note = {
              midi: +keySel.value,
              instrument: ball.instrument,
              velocity: 96,
              duration: 0.22,
            };
            if (this.flags.builtInSound !== false) {
              this.audio.resume();
              this.audio.play(note, this.audio.now());
            }
            if (this.midi.enabled) this.midi.note(note);
          }
          this.refresh();
        }
      });
      row.appendChild(keySel);

      const back = el('button', 'ui-btn ui-mini', '◀');
      back.title = 'shift this head one cell back (delay −1)';
      back.addEventListener('click', () => {
        this.engine.shiftHead(i, -1);
        this.refresh();
      });
      // the DELAY readout lives between the arrows: how many cells this head is
      // phase-shifted from home (0 = in phase). Click it to zero the delay.
      const delay = el('span', 'ui-delay', '0');
      delay.title = 'phase delay (cells from home) — click to zero';
      delay.addEventListener('click', () => {
        this.engine.zeroShift(i);
        this.refresh();
      });
      const fwd = el('button', 'ui-btn ui-mini', '▶');
      fwd.title = 'shift this head one cell forward (delay +1)';
      fwd.addEventListener('click', () => {
        this.engine.shiftHead(i, +1);
        this.refresh();
      });
      const rev = el('button', 'ui-btn ui-mini', '⇄');
      rev.title = 'reverse this head’s direction';
      rev.addEventListener('click', () => {
        this.engine.reverseHead(i);
        this.refresh();
      });
      row.append(back, delay, fwd, rev);

      this.groupUI[ball.kind].list.appendChild(row);
      this.trackRows.push({
        axis: ball.kind,
        index: i,
        ball,
        row,
        kindEl,
        runBtn: runTrackBtn,
        sel,
        durSel,
        keySel,
        delay,
        mBtn,
        sBtn,
        revBtn: rev,
      });
    });

    ['X', 'Y', 'Z'].forEach((axis) => this._applyTrackCount(axis, this.engine.div[axis]));
  }

  _applyTrackCount(axis, n) {
    const N = Math.max(1, Math.min(16, n));
    for (const r of this.trackRows) {
      if (r.axis !== axis) continue;
      const on = (r.ball.track ?? 0) < N;
      r.ball.active = on;
      r.row.style.display = on ? '' : 'none';
    }
    this.engine.refreshSolo();
  }

  _syncTrackRows() {
    for (const r of this.trackRows) {
      const axis = normalizeAxis(r.ball.kind, r.axis);
      if (r.ball.kind !== axis) r.ball.kind = axis;
      if (r.axis !== axis) {
        r.axis = axis;
        this.groupUI[axis]?.list.appendChild(r.row);
      }
      if (r.kindEl) r.kindEl.textContent = `${axis}${(r.ball.track ?? 0) + 1}`;
    }
  }

  _groupRows(axis) {
    return this.trackRows.filter((r) => r.axis === axis).sort((a, b) => (a.ball.track ?? 0) - (b.ball.track ?? 0));
  }

  _groupRootBall(axis) {
    return this._groupRows(axis)[0]?.ball || null;
  }

  _groupNoteLines(axis) {
    const scale = this._groupRootBall(axis)?.band?.scale || 'scale';
    const notes = this._groupRows(axis)
      .filter((r) => r.ball.active !== false)
      .map((r) => {
        const midi = this._trackNote(r.ball);
        return midi == null ? '—' : noteName(midi);
      });
    if (!notes.length) return ['', '', '', ''];
    const chunkSize = Math.max(1, Math.ceil(notes.length / 4));
    const out = [];
    for (let i = 0; i < 4; i++)
      out.push(`${axis} · ${scale}\n${notes.slice(i * chunkSize, (i + 1) * chunkSize).join(' · ')}`);
    return out;
  }

  // Reverse state is derived from direction: if the current velocity points
  // opposite to the spawn/home velocity, the head is in reversed mode.
  _isReversed(ball) {
    if (!ball) return false;
    const hx = ball.home?.vx ?? 1;
    const hy = ball.home?.vy ?? 0;
    const hv = Math.hypot(hx, hy);
    const bv = Math.hypot(ball.vx, ball.vy);
    if (hv < 1e-9 || bv < 1e-9) return false;
    const dot = (ball.vx / bv) * (hx / hv) + (ball.vy / bv) * (hy / hv);
    return dot < 0;
  }

  // The actual MIDI note a track currently plays: its row's scale degree through
  // the head's band (purely positional — the same value the sequencer sounds for
  // a railed head). Reads the head's live cell, so it follows scale/key changes.
  _trackNote(ball) {
    if (!ball.band) return null;
    const cell = this.engine.cellOf(ball);
    return this.sequencer.positionalPitch(ball, cell.i, cell.j);
  }

  // Set the WHOLE band (all its tracks) to one scale+root. CRUCIAL: every track
  // shares the SAME root — we do NOT stack the tracks up the scale anymore. With
  // a uniform band, a cell's pitch is PURELY POSITIONAL: it depends only on the
  // band (scale+key) and the cell's perpendicular level, never on which physical
  // head happens to cross it. That is what keeps the click-preview and the
  // running sequencer in agreement on EVERY face. (The old per-track root
  // stacking coupled pitch to track identity; off the home face a head's track
  // index ≠ its cell row, so the previewed note and the played note diverged —
  // "a completely different scale".) Per-track keys can still be set individually
  // from the track rows for deliberate detuning.
  _applyGroupScale(axis, scaleName) {
    const rows = this._groupRows(axis);
    if (!rows.length) return;
    const rootBall = rows[0].ball;
    if (!rootBall.band) return;
    const root = rootBall.band.root; // keep the band's current key
    for (const r of rows) {
      if (!r.ball.band) continue;
      r.ball.band.scale = scaleName;
      r.ball.band.root = root;
    }
    this._syncGroupKeyState(axis);
  }

  _applyGroupKey(axis, keyClass) {
    const rows = this._groupRows(axis);
    if (!rows.length) return;
    const rootBall = rows[0].ball;
    if (!rootBall.band) return;
    const root = Math.floor(rootBall.band.root / 12) * 12 + keyClass;
    for (const r of rows) {
      if (!r.ball.band) continue;
      r.ball.band.root = root;
    }
    this._syncGroupKeyState(axis);
  }

  // Mark a track's key selector as "off-band" when its root no longer matches the
  // band's shared root (a deliberate per-track detune) — a quiet visual hint.
  _syncGroupKeyState(axis) {
    const rows = this._groupRows(axis);
    if (!rows.length) return;
    const rootBall = rows[0].ball;
    if (!rootBall.band) return;
    const expected = ((rootBall.band.root % 12) + 12) % 12;
    rows.forEach((r) => {
      const got = ((r.ball.band.root % 12) + 12) % 12;
      r.keySel.classList.toggle('ui-note-offscale', got !== expected);
    });
  }

  // ---- session parameters: collect / apply / save / load / show -------------
  // EVERY tweakable in one plain object — the session. Saved as JSON, loadable,
  // and listable live with the 'p' key.
  collectParams() {
    this._syncTrackRows();
    const v = this.view,
      e = this.engine;
    return {
      version: 1,
      divisions: { ...e.div },
      groups: {
        X: {
          tracks: this._groupRows('X').filter((r) => r.ball.active !== false).length,
          bpm: e.groupBpm.X ?? null,
          scale: this._groupRootBall('X')?.band?.scale,
          key: (((this._groupRootBall('X')?.band?.root ?? 60) % 12) + 12) % 12,
        },
        Y: {
          tracks: this._groupRows('Y').filter((r) => r.ball.active !== false).length,
          bpm: e.groupBpm.Y ?? null,
          scale: this._groupRootBall('Y')?.band?.scale,
          key: (((this._groupRootBall('Y')?.band?.root ?? 57) % 12) + 12) % 12,
        },
        Z: {
          tracks: this._groupRows('Z').filter((r) => r.ball.active !== false).length,
          bpm: e.groupBpm.Z ?? null,
          scale: this._groupRootBall('Z')?.band?.scale,
          key: (((this._groupRootBall('Z')?.band?.root ?? 64) % 12) + 12) % 12,
        },
      },
      transport: { bpm: e.bpm, stepMode: e.stepMode, railed: e.railed, gravity: e.gravityStrength },
      runtime: {
        paused: !!e.paused,
        groupPaused: { ...e.groupPaused },
      },
      sound: {
        builtInSound: this.flags.builtInSound,
        noteSound: this.flags.noteSound,
        collisionSound: this.flags.collisionSound,
        collisionIndex: this.audio.collisionSound,
        collisionSource: this.sequencer.collisionSource,
        midiEnabled: this.midi.enabled,
        midiChannel: this.midi.channel,
      },
      view: {
        surfaceStyle: v.surfaceStyle,
        facetGap: v.facetGap,
        popAmount: v.popAmount,
        ambientIntensity: v.ambientIntensity,
        cubeOpacity: v.cubeOpacity,
        cubeColor: v.cubeColor,
        armedColor: v.armedColor,
        gridColor: this.gridColorInput.value,
        bgColor: v.bgColor,
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
        active: b.active !== false,
        running: b.running !== false,
        color: b.color,
        instrument: b.instrument,
        rate: b.rate,
        muted: !!b.muted,
        solo: !!b.solo,
        shift: b.shift || 0,
        faceId: b.faceId,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        cellFace: b.cellFace,
        cellI: b.cellI,
        cellJ: b.cellJ,
        scale: b.band ? b.band.scale : undefined,
        root: b.band ? b.band.root : undefined,
      })),
      score: Object.fromEntries(this.sequencer.armed),
    };
  }

  applyParams(p) {
    if (!p || typeof p !== 'object') return;
    // per-axis divisions (re-shapes the cuboid). Back-compat: a bare number sets
    // all three axes equally.
    if (p.divisions != null) {
      const d = typeof p.divisions === 'object' ? p.divisions : { X: p.divisions, Y: p.divisions, Z: p.divisions };
      for (const ax of ['X', 'Y', 'Z']) if (d[ax] != null) this.setDivisions(ax, d[ax]);
    }
    const t = p.transport || {};
    if (t.bpm != null) this.engine.bpm = t.bpm;
    if (t.stepMode != null) this.engine.stepMode = t.stepMode;
    if (t.railed != null) this.engine.railed = t.railed;
    if (t.gravity != null) this.engine.gravityStrength = t.gravity;
    const rt = p.runtime || {};
    if (rt.paused != null) this.engine.paused = rt.paused;
    if (rt.groupPaused && typeof rt.groupPaused === 'object') {
      for (const axis of ['X', 'Y', 'Z'])
        if (rt.groupPaused[axis] != null) this.engine.groupPaused[axis] = !!rt.groupPaused[axis];
    }
    const sn = p.sound || {};
    if (sn.builtInSound != null) this.flags.builtInSound = sn.builtInSound;
    if (sn.noteSound != null) this.flags.noteSound = sn.noteSound;
    if (sn.collisionSound != null) this.flags.collisionSound = sn.collisionSound;
    if (sn.collisionIndex != null) this.audio.collisionSound = sn.collisionIndex;
    if (sn.collisionSource != null) this.sequencer.collisionSource = sn.collisionSource;
    if (sn.midiChannel != null) this.midi.channel = sn.midiChannel;
    const hasRuntimeTrackState =
      Array.isArray(p.tracks) &&
      p.tracks.some(
        (tp) => tp && (tp.faceId != null || tp.x != null || tp.y != null || tp.vx != null || tp.vy != null),
      );
    if (!hasRuntimeTrackState) {
      this.engine.resetHeads();
      this.engine.groupPaused = { X: false, Y: false, Z: false };
    }
    const vw = p.view || {};
    if (vw.surfaceStyle != null) this.view.setSurfaceStyle(vw.surfaceStyle);
    if (vw.facetGap != null) this.view.setFacetGap(vw.facetGap);
    if (vw.popAmount != null) this.view.setPopAmount(vw.popAmount);
    if (vw.ambientIntensity != null) this.view.setAmbientIntensity(vw.ambientIntensity);
    if (vw.cubeOpacity != null) this.view.setCubeOpacity(vw.cubeOpacity);
    if (vw.cubeColor != null) this.view.setCubeColor(vw.cubeColor);
    if (vw.armedColor != null) this.view.setArmedColor(vw.armedColor);
    if (vw.gridColor != null) {
      this.view.setGridColor(vw.gridColor);
      this.gridColorInput.value = vw.gridColor;
    }
    if (vw.bgColor != null) {
      this.view.setBackgroundColor(vw.bgColor);
      this.bgColorInput.value = vw.bgColor;
    }
    if (vw.flashMode != null) this.view.setFlashMode(vw.flashMode);
    if (vw.headStyle != null) this.view.setHeadStyle(vw.headStyle);
    if (vw.headDepth != null) this.view.setHeadDepth(vw.headDepth);
    if (vw.headCoreSize != null) this.view.setHeadCoreSize(vw.headCoreSize);
    if (vw.mirrorFirefly != null) this.view.setMirrorFirefly(vw.mirrorFirefly);
    if (vw.fireflyBright != null) this.view.setFireflyBright(vw.fireflyBright);
    if (vw.fireflyDim != null) this.view.setFireflyDim(vw.fireflyDim);
    if (vw.fireflyDesat != null) this.view.setFireflyDesat(vw.fireflyDesat);
    const groups = p.groups || {};
    for (const axis of ['X', 'Y', 'Z']) {
      const g = groups[axis] || {};
      if (g.bpm != null) this.engine.groupBpm[axis] = g.bpm;
      if (g.tracks != null) {
        this.setDivisions(axis, g.tracks); // a band's track count = its axis division
        this._applyTrackCount(axis, g.tracks);
      }
      if (g.scale != null) this._applyGroupScale(axis, g.scale);
      if (g.key != null) this._applyGroupKey(axis, g.key);
    }
    const tracks = p.tracks || [];
    tracks.forEach((tp, i) => {
      const b = this.engine.balls[i];
      if (!b) return;
      let homeChanged = false;
      const nextKind = tp.kind != null ? normalizeAxis(tp.kind, b.kind) : b.kind;
      if (nextKind !== b.kind) {
        b.kind = nextKind;
        homeChanged = true;
      }
      if (tp.track != null && tp.track !== b.track) {
        b.track = tp.track;
        homeChanged = true;
      }
      const fitsAxis = (b.track ?? 0) < (this.engine.div[b.kind] ?? 0);
      b.active = tp.active != null ? !!tp.active && fitsAxis : fitsAxis;
      if (tp.running != null) b.running = tp.running;
      if (tp.instrument != null) b.instrument = tp.instrument;
      if (tp.rate != null) b.rate = tp.rate;
      if (tp.muted != null) b.muted = tp.muted;
      if (tp.solo != null) b.solo = tp.solo;
      if (tp.shift != null) b.shift = tp.shift;
      if (tp.faceId != null) b.faceId = tp.faceId;
      if (tp.x != null) b.x = tp.x;
      if (tp.y != null) b.y = tp.y;
      if (tp.vx != null) b.vx = tp.vx;
      if (tp.vy != null) b.vy = tp.vy;
      if (tp.cellFace != null) b.cellFace = tp.cellFace;
      if (tp.cellI != null) b.cellI = tp.cellI;
      if (tp.cellJ != null) b.cellJ = tp.cellJ;
      if (b.band && tp.scale != null) b.band.scale = tp.scale;
      if (b.band && tp.root != null) b.band.root = tp.root;
      if (homeChanged) {
        this.updateTrackHome(b);
        if (!hasRuntimeTrackState) this.engine.resetHead(b);
      }
    });
    for (let i = tracks.length; i < this.engine.balls.length; i++) {
      const b = this.engine.balls[i];
      b.active = false;
      b.muted = true;
      b.solo = false;
    }
    this.engine.refreshSolo();
    if (p.score) {
      this.sequencer.clear();
      for (const [k, vel] of Object.entries(p.score)) this.sequencer.armed.set(k, vel);
    }
    this.view.refreshArmedCells(this.sequencer);
    this.refresh();
  }

  async _saveJSON() {
    const text = JSON.stringify(this.collectParams(), null, 2);
    const blob = new Blob([text], { type: 'application/json' });

    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'cube-carillon-session.json',
          types: [{ description: 'JSON Session', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return;
      }
    } catch (err) {
      // If the user cancels the native picker, do nothing. Any other error falls
      // back to the blob download path below.
      if (err && err.name === 'AbortError') return;
      console.warn('Native save failed, falling back to download.', err);
    }

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'cube-carillon-session.json';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(href);
      a.remove();
    }, 1000);
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
    this._syncTrackRows();
    this.playBtn.textContent = this.engine.paused ? '◯' : '◉';
    this.playBtn.classList.toggle('on', !this.engine.paused);
    this.modeBtn.textContent = this.engine.stepMode ? 'Continuous' : 'Step';
    this.modeBtn.classList.toggle('on', this.engine.stepMode);
    this.railBtn.textContent = this.engine.railed ? 'Derail' : 'Rail';
    this.gravityBtn.classList.toggle('on', this.engine.gravityStrength > 0);
    this.bpmInput.value = this.engine.bpm;
    this.collSel.value = this.audio.collisionSound;
    if (this.builtInChk) this.builtInChk.checked = this.flags.builtInSound !== false;
    if (this.noteChk) this.noteChk.checked = !!this.flags.noteSound;
    if (this.collChk) this.collChk.checked = !!this.flags.collisionSound;
    if (this.collSrcSel) this.collSrcSel.value = this.sequencer.collisionSource;
    this.surfaceSel.value = this.view.surfaceStyle;
    this.gapInput.value = this.view.facetGap;
    this.popInput.value = this.view.popAmount;
    this.ambientInput.value = this.view.ambientIntensity;
    this.opacityInput.value = this.view.cubeOpacity;
    this.colorInput.value = this.view.cubeColor;
    this.armedInput.value = this.view.armedColor;
    if (this.bgColorInput) this.bgColorInput.value = this.view.bgColor;
    this.flashSel.value = this.view.flashMode;
    this.headSel.value = this.view.headStyle;
    this.depthInput.value = this.view.headDepth;
    this.coreInput.value = this.view.headCoreSize;
    this.mirrorChk.checked = this.view.mirrorFirefly;
    this.brightInput.value = this.view.fireflyBright;
    this.dimInput.value = this.view.fireflyDim;
    this.desatInput.value = this.view.fireflyDesat;
    this.chanSel.value = this.midi.channel;
    this.midiSel.disabled = !this.midi.enabled;
    this.chanSel.disabled = !this.midi.enabled;
    this.view.setAutoRotate(this.spinChk?.checked);
    this.view.setAxisLabelsVisible('X', this.labelXChk?.checked);
    this.view.setAxisLabelsVisible('Y', this.labelYChk?.checked);
    this.view.setAxisLabelsVisible('Z', this.labelZChk?.checked);
    for (const axis of ['X', 'Y', 'Z']) {
      const rows = this._groupRows(axis);
      this.groupUI[axis].countSel.value = String(rows.filter((r) => r.ball.active !== false).length || 1);
      const rootBall = this._groupRootBall(axis);
      if (rootBall?.band) {
        this.groupUI[axis].scaleSel.value = rootBall.band.scale;
        this.groupUI[axis].keySel.value = String(((rootBall.band.root % 12) + 12) % 12);
      }
      const paused = !!this.engine.groupPaused[axis];
      this.groupUI[axis].runBtn.textContent = paused ? '◯' : '◉';
      this.groupUI[axis].runBtn.classList.toggle('on', !paused);
      const revOn = rows.some((r) => r.ball.active !== false && this._isReversed(r.ball));
      if (this.groupUI[axis].revBtn) {
        this.groupUI[axis].revBtn.classList.toggle('on', revOn);
        this.groupUI[axis].revBtn.textContent = revOn ? '↺' : '⇄';
        this.groupUI[axis].revBtn.title = revOn
          ? `group ${axis} is reversed — click to toggle`
          : `group ${axis} is forward — click to reverse`;
      }
      this._syncGroupKeyState(axis);
      this.view.setAxisLabels(axis, this._groupNoteLines(axis));
    }
    this.engine.balls.forEach((ball, i) => {
      const r = this.trackRows[i];
      // rows ALWAYS mirror the head's active flag — whatever changed it (the
      // track-count dial, a loaded session, or a live re-slice): an inactive
      // track has no head on stage, so its row hides too.
      r.row.style.display = ball.active === false ? 'none' : '';
      if (r.runBtn) {
        const running = ball.running !== false;
        r.runBtn.textContent = running ? '◉' : '◯';
        r.runBtn.classList.toggle('on', running);
      }
      r.sel.value = ball.instrument;
      r.durSel.value = String(ball.rate);
      r.mBtn.classList.toggle('on', !!ball.muted);
      r.sBtn.classList.toggle('on', !!ball.solo);
      if (r.revBtn) {
        const revOn = this._isReversed(ball);
        r.revBtn.classList.toggle('on', revOn);
        r.revBtn.textContent = revOn ? '↺' : '⇄';
        r.revBtn.title = revOn ? 'reversed direction (click to toggle)' : 'forward direction (click to reverse)';
      }
      // delay readout (cells from home); flag a non-zero phase shift
      if (r.delay) {
        const n = ball.shift || 0;
        r.delay.textContent = n > 0 ? '+' + n : String(n);
        r.delay.classList.toggle('nonzero', n !== 0);
      }
      if (ball.band) {
        // the actual note this track plays (its scale degree), with octave
        const note = this._trackNote(ball);
        if (note != null) r.keySel.value = String(note);
        // green = notes that belong to the band's scale (any octave), so the
        // in-scale choices stand out and an off-scale pick is a clear departure.
        const offs = SCALES[ball.band.scale] || [];
        const tonic = ((ball.band.root % 12) + 12) % 12;
        for (const opt of r.keySel.options) {
          const rel = (((+opt.value - tonic) % 12) + 12) % 12;
          opt.classList.toggle('in-scale', offs.includes(rel));
        }
      }
    });
  }
}

// per-track Note selector range (MIDI), and MIDI→name with octave (C4 = 60).
const NOTE_MIN = 24; // C1
const NOTE_MAX = 96; // C7
function noteName(m) {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
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

function normalizeAxis(kind, fallback = 'X') {
  if (kind === 'H') return 'X';
  if (kind === 'V') return 'Y';
  return kind === 'X' || kind === 'Y' || kind === 'Z' ? kind : fallback;
}
