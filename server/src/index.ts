/** Entry point: wires the store, renderer, orchestrator, HTTP API and WebSocket
 *  hub together, waits for MediaMTX, and keeps schedules ticking. */
import http from 'node:http';
import { config } from './config';
import { makeLog } from './logger';
import { Store } from './store';
import { RenderManager } from './render/renderer';
import { Orchestrator } from './orchestrator';
import { createApi } from './api';
import { WsHub } from './ws';
import { hasValidSession } from './auth';
import { ping } from './mediamtx';

const log = makeLog('main');

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const store = new Store();
  const render = new RenderManager();
  let hub: WsHub | null = null;

  const orchestrator = new Orchestrator(store, render, (statuses) => {
    hub?.broadcast('status', statuses);
  });

  // Any data change → tell panels to refetch state and re-reconcile (debounced).
  let pending: NodeJS.Timeout | null = null;
  store.onChange(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      hub?.broadcast('state', null);
      void orchestrator.reconcile();
    }, 100);
  });

  const handler = createApi({ store, orchestrator });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      log.error('request handler crashed', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"Internal error."}');
      }
    });
  });
  hub = new WsHub(server, (req) => !!store.db.admin && hasValidSession(req, store.secret));

  server.listen(config.port, () => {
    log.info(`OpenMasjid Display control panel listening on :${config.port}`);
    if (!store.db.admin) log.info('first run — open the control panel to create your admin account');
  });

  // Wait (briefly) for MediaMTX to come up, then reconcile.
  void (async () => {
    for (let i = 0; i < 60; i++) {
      if (await ping()) {
        log.info('MediaMTX is reachable');
        break;
      }
      await delay(1000);
    }
    await orchestrator.reconcile();
  })();

  // Re-evaluate schedules and stream health on a steady cadence.
  setInterval(() => void orchestrator.reconcile(), 15000);

  const shutdown = () => {
    log.info('shutting down');
    render.stopAll();
    server.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('fatal startup error', err);
  process.exit(1);
});
