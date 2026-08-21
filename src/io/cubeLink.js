// io/cubeLink.js
//
// Optional Wi-Fi bridge between the web simulation and a standalone cube
// controller (CoreS3). The app remains fully functional without this module;
// when disconnected, the local engine keeps running with no dependency.

function randomId() {
  const n = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `web-${n}`;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function stableScoreSignature(scoreMap) {
  const rows = [];
  for (const [k, v] of scoreMap.entries()) rows.push([k, v]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(rows);
}

export class CubeLinkClient {
  constructor({ engine, sequencer, view, statusFn = () => {} }) {
    this.engine = engine;
    this.sequencer = sequencer;
    this.view = view;
    this.statusFn = statusFn;

    this.clientId = randomId();
    this.ws = null;
    this.url = '';
    this.connected = false;

    this.syncIntervalMs = 250;
    this._lastSyncAt = 0;
    this._lastTransportSig = '';
    this._lastScoreSig = '';
  }

  connect(url) {
    if (!url) throw new Error('CubeLink.connect(url) requires a ws:// or wss:// URL');
    if (this.ws) this.disconnect();

    this.url = url;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.statusFn(`cube link connected (${url})`);
      this._send('hello', {
        role: 'web',
        protocol: 1,
        capabilities: ['transport.set', 'score.replace', 'score.random', 'snapshot'],
      });
      this.sendSnapshot();
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.ws = null;
      this.statusFn('cube link disconnected (standalone mode)');
    });

    this.ws.addEventListener('error', () => {
      this.statusFn('cube link error');
    });

    this.ws.addEventListener('message', (ev) => {
      const msg = safeParse(ev.data);
      if (!msg || msg.sender === this.clientId) return;
      this._handleMessage(msg);
    });
  }

  disconnect() {
    if (!this.ws) return;
    this.ws.close();
    this.ws = null;
    this.connected = false;
  }

  tick(nowMs = performance.now()) {
    if (!this.connected || !this.ws) return;
    if (nowMs - this._lastSyncAt < this.syncIntervalMs) return;
    this._lastSyncAt = nowMs;

    const t = this._transportState();
    const tSig = JSON.stringify(t);
    if (tSig !== this._lastTransportSig) {
      this._lastTransportSig = tSig;
      this._send('transport.state', t);
    }

    const sSig = stableScoreSignature(this.sequencer.armed);
    if (sSig !== this._lastScoreSig) {
      this._lastScoreSig = sSig;
      this._send('score.state', { score: Object.fromEntries(this.sequencer.armed) });
    }
  }

  sendSnapshot() {
    this._send('snapshot', {
      transport: this._transportState(),
      score: Object.fromEntries(this.sequencer.armed),
    });
  }

  randomizeScore({ density = 0.16, vMin = 0.55, vMax = 0.9 } = {}) {
    const d = clamp(density, 0, 1);
    const lo = clamp(vMin, 0.05, 1);
    const hi = clamp(vMax, lo, 1);

    this.sequencer.clear();
    for (const f of this.engine.surface.faces) {
      const nx = this.engine.div[f.uAxis] || 1;
      const ny = this.engine.div[f.vAxis] || 1;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (Math.random() < d) {
            const v = lo + Math.random() * (hi - lo);
            this.sequencer.arm(f.id, i, j, v);
          }
        }
      }
    }
    this.view.refreshArmedCells(this.sequencer);
    this._lastScoreSig = '';
    this.sendSnapshot();
  }

  _transportState() {
    return {
      bpm: this.engine.bpm,
      paused: !!this.engine.paused,
      stepMode: !!this.engine.stepMode,
      railed: !!this.engine.railed,
      gravity: this.engine.gravityStrength,
    };
  }

  _send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type,
        payload,
        sender: this.clientId,
        ts: Date.now(),
      }),
    );
  }

  _applyTransport(p) {
    if (!p || typeof p !== 'object') return;
    if (p.bpm != null) this.engine.bpm = clamp(+p.bpm || 120, 20, 400);
    if (p.paused != null) this.engine.paused = !!p.paused;
    if (p.stepMode != null) this.engine.stepMode = !!p.stepMode;
    if (p.railed != null) this.engine.railed = !!p.railed;
    if (p.gravity != null) this.engine.gravityStrength = +p.gravity || 0;
  }

  _applyScore(scoreObj) {
    if (!scoreObj || typeof scoreObj !== 'object') return;
    this.sequencer.clear();
    for (const [k, v] of Object.entries(scoreObj)) {
      this.sequencer.armed.set(k, v);
    }
    this.view.refreshArmedCells(this.sequencer);
    this._lastScoreSig = stableScoreSignature(this.sequencer.armed);
  }

  _handleMessage(msg) {
    const { type, payload } = msg;
    if (type === 'ping') {
      this._send('pong', {});
      return;
    }
    if (type === 'hello') {
      this._send('hello', {
        role: 'web',
        protocol: 1,
        capabilities: ['transport.set', 'score.replace', 'score.random', 'snapshot'],
      });
      return;
    }
    if (type === 'transport.set') {
      this._applyTransport(payload);
      return;
    }
    if (type === 'score.replace') {
      this._applyScore(payload && payload.score ? payload.score : payload);
      return;
    }
    if (type === 'score.clear') {
      this.sequencer.clear();
      this.view.refreshArmedCells(this.sequencer);
      this._lastScoreSig = stableScoreSignature(this.sequencer.armed);
      return;
    }
    if (type === 'score.random') {
      this.randomizeScore(payload || {});
      return;
    }
    if (type === 'snapshot.request') {
      this.sendSnapshot();
    }
  }
}
