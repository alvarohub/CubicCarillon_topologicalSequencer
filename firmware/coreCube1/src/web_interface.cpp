#include "web_interface.hpp"

namespace cube {

WebInterface::WebInterface(OSCHandler& osc) : osc_(osc), server_(kWebPort) {}

bool WebInterface::begin() {
  ensureRoutes();
  if (running_) return true;
  server_.begin();
  running_ = true;
  Serial.printf("Web UI listening on port %u\n", (unsigned)kWebPort);
  return true;
}

void WebInterface::update() {
  if (running_) server_.handleClient();
}

bool WebInterface::running() const { return running_; }

void WebInterface::ensureRoutes() {
  if (routesConfigured_) return;
  server_.on("/", [this]() { handleRoot(); });
  server_.on("/cmd", [this]() { handleCommand(); });
  server_.on("/status", [this]() { handleStatus(); });
  server_.onNotFound([this]() { server_.send(404, "text/plain", "Not found"); });
  routesConfigured_ = true;
}

void WebInterface::handleRoot() { server_.send(200, "text/html", buildPage()); }

void WebInterface::handleCommand() {
  if (!server_.hasArg("q")) {
    server_.send(400, "text/plain", "missing q");
    return;
  }

  String response;
  const bool ok = osc_.executeCommand(server_.arg("q").c_str(), &response);
  server_.send(ok ? 200 : 400, "text/plain", response.length() ? response : (ok ? "OK" : "ERR"));
}

void WebInterface::handleStatus() { server_.send(200, "application/json", osc_.statusJson()); }

String WebInterface::buildPage() const {
  String p;
  p.reserve(9800);
  p += F(R"html(<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CubeCarillon Control</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Verdana,Georgia,serif;background:#111;color:#eee;padding:14px;max-width:960px;margin:auto}h1{font-size:1.35rem;margin:0 0 8px;color:#ffd27b}.status{background:#1b1b1b;border:1px solid #333;border-radius:8px;padding:10px;margin:10px 0 14px;color:#bfe}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{background:#181818;border:1px solid #333;border-radius:8px;padding:12px}.wide{grid-column:1/-1}h2{font-size:.92rem;margin:0 0 10px;color:#8fd0ff}label{display:block;font-size:.78rem;color:#aaa;margin:8px 0 4px}input,button,select{font:inherit}input[type=number],input[type=text]{width:100%;padding:7px;background:#0b0b0b;color:#fff;border:1px solid #444;border-radius:5px}input[type=range]{width:100%}button{background:#254f63;color:white;border:1px solid #4f879c;border-radius:5px;padding:8px 10px;margin:3px;cursor:pointer}button:active{background:#39728c}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row>*{flex:1}.small{max-width:76px}.log{height:120px;overflow:auto;background:#080808;border:1px solid #333;border-radius:6px;padding:8px;font-family:monospace;font-size:.78rem;color:#9f9;white-space:pre-wrap}.faceGrid{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin-top:8px}.cell{aspect-ratio:1;border:1px solid #333;background:#202020;border-radius:3px;min-width:22px}.cell.on{background:#ffb13d;border-color:#ffd78a}.hint{font-size:.76rem;color:#888;margin-top:8px}
</style></head><body>
<h1>CubeCarillon Control</h1>
<div class="status" id="status">loading...</div>
<div class="grid">
<section class="card"><h2>Transport</h2>
<label>BPM <span id="bpmv"></span></label><input id="bpm" type="range" min="20" max="400" value="120" oninput="bpmv.textContent=this.value" onchange="cmd('/bpm '+this.value)">
<div class="row"><button onclick="cmd('/pause 0')">Run</button><button onclick="cmd('/pause 1')">Pause</button><button onclick="cmd('/toggle')">Toggle</button></div>
</section>
<section class="card"><h2>Score</h2>
<div class="row"><button onclick="cmd('/random .16');refresh()">Random</button><button onclick="cmd('/clear');refresh()">Clear</button></div>
<div class="hint">Use the pad editor for precise notes; OSC command shape is /score/set face x y velocity.</div>
</section>
<section class="card"><h2>Cell Editor</h2>
<div class="row"><div><label>Face</label><input class="small" id="face" type="number" min="1" max="6" value="1" onchange="drawGrid()"></div><div><label>Velocity</label><input class="small" id="vel" type="number" min="0" max="1" step="0.05" value="0.75"></div></div>
<div id="grid" class="faceGrid"></div>
</section>
<section class="card wide"><h2>Command</h2>
<div class="row"><input id="manual" type="text" value="/status"><button onclick="cmd(manual.value)">Send</button></div>
<pre class="log" id="log"></pre>
</section>
</div>
<script>
const $=id=>document.getElementById(id);
function log(t){$('log').textContent=(new Date().toLocaleTimeString()+" "+t+"\n"+$('log').textContent).slice(0,3000)}
async function cmd(q){try{const r=await fetch('/cmd?q='+encodeURIComponent(q));const t=await r.text();log(q+' -> '+t);refresh();return t}catch(e){log('ERR '+e)}}
async function refresh(){try{const r=await fetch('/status');const s=await r.json();$('status').textContent=`${s.wifiMode} ${s.ip} | OSC ${s.oscPort} | bpm ${s.bpm} | ${s.paused?'paused':'running'} | armed ${s.armed}`;$('bpm').value=Math.round(s.bpm);$('bpmv').textContent=Math.round(s.bpm)}catch(e){$('status').textContent='status error'}}
function drawGrid(){const g=$('grid');g.innerHTML='';const f=+$('face').value;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const b=document.createElement('button');b.className='cell';b.title=`${f}:${x}:${y}`;b.onclick=()=>cmd(`/score/toggle ${f} ${x} ${y} ${$('vel').value}`);g.appendChild(b)}}
drawGrid();refresh();setInterval(refresh,2500);
</script></body></html>)html");
  return p;
}

}  // namespace cube
