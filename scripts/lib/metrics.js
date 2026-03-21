import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

// Create metrics based on the configured tier level.
// Each tier includes all metrics from the tier below it.
export function createMetrics(level) {
  const m = {};

  // --- minimal tier (always registered) ---
  m.tps = new Rate('pgbench_tps');
  m.latency = new Trend('pgbench_latency', true);
  m.errors = new Counter('pgbench_errors');

  if (level === 'minimal') return m;

  // --- standard tier ---
  m.txTypeLatency = {};  // populated dynamically per transaction type
  m.stmtLatency = {};    // populated dynamically per statement name
  m.readTps = new Rate('pgbench_read_tps');
  m.writeTps = new Rate('pgbench_write_tps');
  m.connectionsActive = new Gauge('pgbench_connections_active');

  if (level === 'standard') return m;

  // --- comprehensive tier ---
  m.replicationLag = new Gauge('pgbench_replication_lag_bytes');
  m.locksWaiting = new Gauge('pgbench_locks_waiting');
  m.tableRows = {};  // populated dynamically per table name

  return m;
}

// Get or create a per-transaction-type latency Trend (standard+ tier).
export function getTxLatency(metrics, txType) {
  if (!metrics.txTypeLatency) return null;
  if (!metrics.txTypeLatency[txType]) {
    metrics.txTypeLatency[txType] = new Trend(`pgbench_tx_${txType}_latency`, true);
  }
  return metrics.txTypeLatency[txType];
}

// Get or create a per-statement latency Trend (standard+ tier).
export function getStmtLatency(metrics, stmtName) {
  if (!metrics.stmtLatency) return null;
  if (!metrics.stmtLatency[stmtName]) {
    metrics.stmtLatency[stmtName] = new Trend(`pgbench_stmt_${stmtName}_latency`, true);
  }
  return metrics.stmtLatency[stmtName];
}

// Get or create a per-table row count Gauge (comprehensive tier).
export function getTableRows(metrics, tableName) {
  if (!metrics.tableRows) return null;
  if (!metrics.tableRows[tableName]) {
    metrics.tableRows[tableName] = new Gauge(`pgbench_table_${tableName}_rows`);
  }
  return metrics.tableRows[tableName];
}

// Record a successful transaction.
export function recordTx(metrics, txType, durationMs, isRead) {
  metrics.tps.add(1);
  metrics.latency.add(durationMs);

  const txLatency = getTxLatency(metrics, txType);
  if (txLatency) txLatency.add(durationMs);

  if (metrics.readTps) {
    if (isRead) {
      metrics.readTps.add(1);
      metrics.writeTps.add(0);
    } else {
      metrics.readTps.add(0);
      metrics.writeTps.add(1);
    }
  }
}

// Record a failed transaction.
export function recordError(metrics) {
  metrics.tps.add(0);
  metrics.errors.add(1);
}

// Record a statement execution (standard+ tier).
export function recordStmt(metrics, stmtName, durationMs) {
  const stmtLatency = getStmtLatency(metrics, stmtName);
  if (stmtLatency) stmtLatency.add(durationMs);
}
