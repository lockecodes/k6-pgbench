import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

// All known transaction types (must be declared at init time)
const TX_TYPES = [
  'tpcb', 'select_only', 'simple_update', 'tpcb_write', 'tpcb_read',
  'new_order', 'payment', 'order_status', 'delivery', 'stock_level',
];

// All known statement names (must be declared at init time)
const STMT_NAMES = [
  // TPC-B statements
  'update_accounts', 'select_abalance', 'update_tellers', 'update_branches', 'insert_history',
  // TPC-C New-Order
  'no_select_warehouse', 'no_select_district', 'no_update_district', 'no_select_customer',
  'no_insert_order', 'no_insert_new_order', 'no_select_item', 'no_select_stock',
  'no_update_stock', 'no_insert_order_line',
  // TPC-C Payment
  'pay_update_warehouse', 'pay_select_warehouse', 'pay_update_district', 'pay_select_district',
  'pay_select_customer_by_name', 'pay_select_customer', 'pay_update_customer', 'pay_insert_history',
  // TPC-C Order-Status
  'os_select_customer_by_name', 'os_select_customer_by_id', 'os_select_order', 'os_select_order_lines',
  // TPC-C Delivery
  'del_select_new_order', 'del_delete_new_order', 'del_update_order', 'del_update_order_line', 'del_update_customer',
  // TPC-C Stock-Level
  'sl_select_district', 'sl_count_low_stock',
];

// Create metrics based on the configured tier level.
// All metrics must be declared at init time (k6 requirement).
export function createMetrics(level) {
  const m = {};

  // --- minimal tier (always registered) ---
  m.tps = new Rate('pgbench_tps');
  m.latency = new Trend('pgbench_latency', true);
  m.errors = new Counter('pgbench_errors');

  if (level === 'minimal') return m;

  // --- standard tier ---
  m.txTypeLatency = {};
  for (const txType of TX_TYPES) {
    m.txTypeLatency[txType] = new Trend(`pgbench_tx_${txType}_latency`, true);
  }

  m.stmtLatency = {};
  for (const stmtName of STMT_NAMES) {
    m.stmtLatency[stmtName] = new Trend(`pgbench_stmt_${stmtName}_latency`, true);
  }

  m.readTps = new Rate('pgbench_read_tps');
  m.writeTps = new Rate('pgbench_write_tps');
  m.connectionsActive = new Gauge('pgbench_connections_active');

  if (level === 'standard') return m;

  // --- comprehensive tier ---
  m.replicationLag = new Gauge('pgbench_replication_lag_bytes');
  m.locksWaiting = new Gauge('pgbench_locks_waiting');
  m.tableRows = {};  // populated by pgstats sampler (runs in init context of its scenario)

  return m;
}

// Record a successful transaction.
export function recordTx(metrics, txType, durationMs, isRead) {
  metrics.tps.add(1);
  metrics.latency.add(durationMs);

  if (metrics.txTypeLatency && metrics.txTypeLatency[txType]) {
    metrics.txTypeLatency[txType].add(durationMs);
  }

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
  if (metrics.stmtLatency && metrics.stmtLatency[stmtName]) {
    metrics.stmtLatency[stmtName].add(durationMs);
  }
}

// Get or create a per-table row count Gauge (comprehensive tier).
// Called from pgstats sampler which discovers table names dynamically.
// Falls back to a no-op if the metric can't be created.
export function getTableRows(metrics, tableName) {
  if (!metrics.tableRows) return null;
  if (!metrics.tableRows[tableName]) {
    try {
      metrics.tableRows[tableName] = new Gauge(`pgbench_table_${tableName}_rows`);
    } catch (_) {
      return null;
    }
  }
  return metrics.tableRows[tableName];
}
