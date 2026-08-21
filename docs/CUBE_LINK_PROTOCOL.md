# Cube Link Protocol (Web App <-> CoreS3)

This protocol is for optional Wi-Fi sync between:

- the browser app (visual editor + simulation)
- a standalone cube controller (CoreS3)

Design rule: standalone always works alone. The link is additive.

## Transport

- WebSocket (`ws://` or `wss://`)
- JSON messages
- one message envelope format

Envelope:

```json
{
  "type": "transport.set",
  "payload": { "bpm": 120 },
  "sender": "web-a1b2c3d4",
  "ts": 1783511812345
}
```

Notes:

- `sender` is used to ignore self-echo when a relay broadcasts to all clients.
- unknown message `type` should be ignored.

## Message Types (Implemented in Web App)

### Handshake

- `hello`

Payload example:

```json
{
  "role": "web",
  "protocol": 1,
  "capabilities": ["transport.set", "score.replace", "score.random", "snapshot"]
}
```

### Keepalive

- `ping`
- `pong`

### Control -> Web

- `transport.set`

Payload fields (optional):

- `bpm` (20..400)
- `paused` (bool)
- `stepMode` (bool)
- `railed` (bool)
- `gravity` (number)

- `score.replace`

Payload can be either:

- `{ "score": { "face:i:j": velocity, ... } }`
- or directly `{ "face:i:j": velocity, ... }`

- `score.clear`

- `score.random`

Payload (optional):

- `density` 0..1 (default `0.16`)
- `vMin` 0.05..1 (default `0.55`)
- `vMax` >= `vMin` (default `0.9`)

- `snapshot.request`

### Web -> Control (state sync)

- `transport.state`
- `score.state`
- `snapshot`

The web app sends these periodically when connected and when state changes.

## Score Encoding

Score map uses the same key format as the sequencer:

- key: `"faceId:i:j"`
- value: velocity in `[0..1]` (number)

Example:

```json
{
  "4:2:7": 0.74,
  "1:0:0": 0.6,
  "5:3:3": 0.88
}
```

## Browser Usage

Auto-connect from query string:

- `http://localhost:8001/?cubeWs=ws://192.168.1.77:8787`

When opened with `?debug`, link object is exposed at:

- `window.__cube.cubeLink`

Useful debug calls:

- `window.__cube.cubeLink.connect('ws://192.168.1.77:8787')`
- `window.__cube.cubeLink.disconnect()`
- `window.__cube.cubeLink.randomizeScore({ density: 0.2 })`
