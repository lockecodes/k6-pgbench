// Default TPC-B transaction — exact equivalent of `pgbench` (no flags).
//
// Transaction profile:
//   BEGIN
//   UPDATE pgbench_accounts SET abalance = abalance + :delta WHERE aid = :aid
//   SELECT abalance FROM pgbench_accounts WHERE aid = :aid
//   UPDATE pgbench_tellers SET tbalance = tbalance + :delta WHERE tid = :tid
//   UPDATE pgbench_branches SET bbalance = bbalance + :delta WHERE bid = :bid
//   INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES (...)
//   END

import { openPrimary, closeAll } from '../lib/db.js';
import { getConfig } from '../lib/config.js';
import { createMetrics, recordTx, recordError, recordStmt } from '../lib/metrics.js';

const config = getConfig();
const metrics = createMetrics(config.metricsLevel);

export const options = {
  scenarios: {
    tpcb: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.K6_VUS || '5', 10),
      duration: __ENV.K6_DURATION || '600s',
    },
  },
  tags: {
    benchmark: 'tpcb',
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
  const bid = randomInt(1, scale);
  const tid = randomInt(1, scale * 10);
  const delta = randomInt(-5000, 5000);

  const start = Date.now();
  try {
    db.exec('BEGIN');

    let t0 = Date.now();
    db.exec(`UPDATE pgbench_accounts SET abalance = abalance + ${delta} WHERE aid = ${aid}`);
    recordStmt(metrics, 'update_accounts', Date.now() - t0);

    t0 = Date.now();
    db.query(`SELECT abalance FROM pgbench_accounts WHERE aid = ${aid}`);
    recordStmt(metrics, 'select_abalance', Date.now() - t0);

    t0 = Date.now();
    db.exec(`UPDATE pgbench_tellers SET tbalance = tbalance + ${delta} WHERE tid = ${tid}`);
    recordStmt(metrics, 'update_tellers', Date.now() - t0);

    t0 = Date.now();
    db.exec(`UPDATE pgbench_branches SET bbalance = bbalance + ${delta} WHERE bid = ${bid}`);
    recordStmt(metrics, 'update_branches', Date.now() - t0);

    t0 = Date.now();
    db.exec(`INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES (${tid}, ${bid}, ${aid}, ${delta}, CURRENT_TIMESTAMP)`);
    recordStmt(metrics, 'insert_history', Date.now() - t0);

    db.exec('END');

    recordTx(metrics, 'tpcb', Date.now() - start, false);
  } catch (e) {
    db.exec('ROLLBACK');
    recordError(metrics);
    console.error(`TPC-B transaction failed: ${e.message}`);
  }
}

export function teardown() {
  closeAll();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
