/**
 * Dashboard HTML template for the model load optimizer.
 * Auto-refreshing single-page dashboard showing model status and GPU metrics.
 */

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Model Load Optimizer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    h1 { color: #58a6ff; margin-bottom: 20px; font-size: 1.5em; }
    h2 { color: #8b949e; margin: 16px 0 8px; font-size: 1.1em; text-transform: uppercase; letter-spacing: 0.5px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .status-dot.online { background: #3fb950; }
    .status-dot.offline { background: #f85149; }
    .status-dot.loaded { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
    .status-dot.unloaded { background: #8b949e; }
    .metric { margin: 4px 0; }
    .metric-label { color: #8b949e; font-size: 0.85em; }
    .metric-value { color: #c9d1d9; font-weight: 600; }
    .bar { height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; margin-top: 4px; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
    .bar-fill.ok { background: #3fb950; }
    .bar-fill.warn { background: #d29922; }
    .bar-fill.critical { background: #f85149; }
    .model-tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; margin-right: 4px; }
    .model-tag.primary { background: #1f6feb33; color: #58a6ff; border: 1px solid #1f6feb; }
    .model-tag.sidecar { background: #3fb95033; color: #3fb950; border: 1px solid #3fb950; }
    .model-tag.fallback { background: #d2992233; color: #d29922; border: 1px solid #d29922; }
    .decision-log { max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 0.85em; }
    .decision-log .entry { padding: 4px 0; border-bottom: 1px solid #21262d; }
    .refresh-btn { background: #1f6feb; color: white; border: none; border-radius: 6px; padding: 6px 16px; cursor: pointer; font-size: 0.9em; }
    .refresh-btn:hover { background: #388bfd; }
    .timestamp { color: #484f58; font-size: 0.8em; }
    #error-banner { display: none; background: #f8514933; border: 1px solid #f85149; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div style="display: flex; justify-content: space-between; align-items: center;">
    <h1>Model Load Optimizer</h1>
    <div>
      <span class="timestamp" id="last-update"></span>
      <button class="refresh-btn" onclick="refresh()">Refresh</button>
    </div>
  </div>
  <div id="error-banner"></div>
  <div class="grid" id="dashboard"></div>
  <script>
    const API_BASE = window.location.pathname.replace('/dashboard', '/api');
    let lastData = null;

    async function refresh() {
      try {
        const res = await fetch(API_BASE + '/status');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        lastData = await res.json();
        render(lastData);
        document.getElementById('error-banner').style.display = 'none';
      } catch (e) {
        document.getElementById('error-banner').style.display = 'block';
        document.getElementById('error-banner').textContent = 'Error: ' + e.message;
      }
      document.getElementById('last-update').textContent = 'Updated: ' + new Date().toLocaleTimeString();
    }

    function render(data) {
      const el = document.getElementById('dashboard');
      el.innerHTML = '';

      // Ollama Status Card
      el.innerHTML += renderCard('Ollama', [
        statusLine('Status', data.ollamaReachable ? 'Online' : 'OFFLINE', data.ollamaReachable ? 'online' : 'offline'),
        metric('Version', data.ollamaVersion || '?'),
        metric('Endpoint', data.ollamaHost),
      ]);

      // GPU Card
      if (data.gpu.vramTotalMB) {
        const vramPct = (data.gpu.vramUsedMB / data.gpu.vramTotalMB * 100);
        el.innerHTML += renderCard('GPU', [
          metric('VRAM', data.gpu.vramUsedMB + 'MB / ' + data.gpu.vramTotalMB + 'MB'),
          bar(vramPct),
          data.gpu.utilization !== null ? metric('Compute', data.gpu.utilization + '%') + bar(data.gpu.utilization) : '',
        ]);
      }

      // Primary Model Card
      const pm = data.primaryModel;
      el.innerHTML += renderCard('Primary Model', [
        '<span class="model-tag primary">PRIMARY</span> ' + pm.name,
        statusLine('Status', pm.pulled ? (pm.loaded ? 'LOADED' : 'Pulled, unloaded') : 'NOT PULLED', pm.loaded ? 'loaded' : 'unloaded'),
        pm.vramBytes > 0 ? metric('VRAM allocated', Math.round(pm.vramBytes / 1024 / 1024) + 'MB') : '',
        pm.parameterSize ? metric('Parameters', pm.parameterSize) : '',
      ]);

      // Sidecar Model Card
      const sm = data.sidecarModel;
      el.innerHTML += renderCard('Sidecar Model', [
        '<span class="model-tag sidecar">SIDECAR</span> ' + sm.name,
        statusLine('Status', sm.pulled ? (sm.loaded ? 'LOADED' : 'Pulled, unloaded') : 'NOT PULLED', sm.loaded ? 'loaded' : 'unloaded'),
        sm.parameterSize ? metric('Parameters', sm.parameterSize) : '',
      ]);

      // Routing Stats Card
      const r = data.routing;
      el.innerHTML += renderCard('Routing', [
        metric('Auto-route', r.autoRoute ? 'ON' : 'OFF'),
        metric('Total decisions', r.totalDecisions),
        metric('Primary selections', r.primarySelections),
        metric('Sidecar selections', r.sidecarSelections),
        metric('Fallback selections', r.fallbackSelections),
        r.lastDecision ? '<br>' + metric('Last', r.lastDecision.model + ' (' + r.lastDecision.reason + ')') : '',
      ]);
    }

    function renderCard(title, items) {
      return '<div class="card"><div class="card-header"><strong>' + title + '</strong></div>' + items.filter(Boolean).join('') + '</div>';
    }

    function statusLine(label, text, dotClass) {
      return '<div class="metric"><span class="status-dot ' + dotClass + '"></span> <span class="metric-label">' + label + ':</span> <span class="metric-value">' + text + '</span></div>';
    }

    function metric(label, value) {
      return '<div class="metric"><span class="metric-label">' + label + ':</span> <span class="metric-value">' + value + '</span></div>';
    }

    function bar(pct) {
      const cls = pct > 85 ? 'critical' : pct > 60 ? 'warn' : 'ok';
      return '<div class="bar"><div class="bar-fill ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></div></div>';
    }

    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
}
