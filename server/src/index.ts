// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Entry point: wires the store, renderer, orchestrator, HTTP API and WebSocket
 *  hub together, waits for MediaMTX, and keeps schedules ticking. */
import http from 'node:http';
import { config } from './config';
import { makeLog } from './logger';
import { Store } from './store';
import { RenderManager } from './render/renderer';
import { Orchestrator } from './orchestrator';
import { createApi } from './api';
import { createVolunteerApi } from './volunteerApi';
import { WsHub } from './ws';
import { hasValidSession } from './auth';
import { ping } from './mediamtx';
import { MediaMtxServer } from './mediamtxServer';
import { notify } from './fabric';

const log = makeLog('main');

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const store = new Store();
  const render = new RenderManager();
  let hub: WsHub | null = null;

  // The RTSP server (MediaMTX) runs inside this same container; bring it up first.
  const mediamtx = new MediaMtxServer();
  mediamtx.start();

  // Alerts the masjid via the Fabric when a screen stops/starts pulling its stream.
  const orchestrator = new Orchestrator(
    store,
    render,
    (statuses) => {
      hub?.broadcast('status', statuses);
    },
    (p) => notify(p),
  );

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
  hub = new WsHub(server, (req) => hasValidSession(req, store.secret));

  server.listen(config.port, () => {
    log.info(`OpenMasjid Display control panel listening on :${config.port}`);
    if (!store.db.admin) log.info('first run — open the control panel to create your admin account');
  });

  // The simple mobile volunteer page runs on its own port. It always listens, but
  // the API stays inert until an admin enables it and sets a PIN (see Settings).
  const volunteerHandler = createVolunteerApi({ store, orchestrator });
  const volunteerServer = http.createServer((req, res) => {
    volunteerHandler(req, res).catch((err) => {
      log.error('volunteer request handler crashed', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"Internal error."}');
      }
    });
  });
  volunteerServer.listen(config.volunteerPort, () => {
    log.info(`volunteer page listening on :${config.volunteerPort}`);
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
    mediamtx.stop();
    server.close();
    volunteerServer.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('fatal startup error', err);
  process.exit(1);
});
