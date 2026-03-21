import { sleep } from 'k6';
import { getTableRows } from './metrics.js';

// Periodic pg_stat_* sampler for the comprehensive metrics tier.
// Runs as a dedicated k6 scenario with a single VU.

// Sample pg_stat views and emit metrics.
export function samplePgStats(db, metrics, config) {
  // Replication lag
  if (metrics.replicationLag) {
    const rows = db.query(`
      SELECT COALESCE(
        pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn), 0
      ) AS lag_bytes
      FROM pg_stat_replication
      LIMIT 1
    `);
    for (const row of rows) {
      metrics.replicationLag.add(parseFloat(row.lag_bytes));
    }
  }

  // Lock contention
  if (metrics.locksWaiting) {
    const rows = db.query(`
      SELECT count(*) AS cnt
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
    `);
    for (const row of rows) {
      metrics.locksWaiting.add(parseInt(row.cnt, 10));
    }
  }

  // Per-table row estimates
  if (metrics.tableRows) {
    const rows = db.query(`
      SELECT relname, n_live_tup
      FROM pg_stat_user_tables
    `);
    for (const row of rows) {
      const gauge = getTableRows(metrics, row.relname);
      if (gauge) gauge.add(parseInt(row.n_live_tup, 10));
    }
  }

  sleep(config.pgstatInterval);
}

// Returns a k6 scenario definition for the pg_stat sampler.
// Add this to your script's options.scenarios when metricsLevel is 'comprehensive'.
export function pgstatScenario(duration) {
  return {
    pgstat_sampler: {
      executor: 'constant-vus',
      vus: 1,
      duration: duration,
      exec: 'pgstatSampler',
    },
  };
}
