// Select-only mode — exact equivalent of `pgbench -S`.
// Single SELECT query, no transaction block.

import { openPrimary, closeAll } from '../lib/db.js';
import { getConfig } from '../lib/config.js';
import { createMetrics, recordTx, recordError } from '../lib/metrics.js';

const config = getConfig();
const metrics = createMetrics(config.metricsLevel);

export const options = {
  scenarios: {
    select_only: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.K6_VUS || '5', 10),
      duration: __ENV.K6_DURATION || '600s',
    },
  },
  tags: {
    benchmark: 'tpcb-select-only',
    scenario: config.scenario,
    target: 'primary',
    connection_mode: config.connection.mode,
    cluster: config.cluster,
    namespace: config.namespace,
  },
};

export default function () {
  const db = openPrimary();
  const scale = config.scale;
  const aid = randomInt(1, scale * 100000);

  const start = Date.now();
  try {
    db.query(`SELECT abalance FROM pgbench_accounts WHERE aid = ${aid}`);
    recordTx(metrics, 'select_only', Date.now() - start, true);
  } catch (e) {
    recordError(metrics);
    console.error(`Select-only query failed: ${e.message}`);
  }
}

export function teardown() {
  closeAll();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
