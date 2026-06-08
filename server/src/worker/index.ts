import { runWorkerLoop } from './runner.js';

// Standalone composite worker. Shares the database and storage with the server
// but runs as its own process, so it can later live in its own container.
console.log('[worker] composite-worker gestart');

runWorkerLoop().catch((err) => {
  console.error('[worker] gestopt door fout:', err);
  process.exit(1);
});
