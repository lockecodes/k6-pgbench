// TPC-C Stock-Level transaction (4% of mix).
// Read-only: counts items with stock below a threshold for recent orders in a district.
// Can be routed to readonly connection in replica mode.

import { recordStmt } from '../lib/metrics.js';

export function stockLevel(db, metrics, config) {
  const w = config.warehouses;
  const wId = randomInt(1, w);
  const dId = randomInt(1, 10);
  const threshold = randomInt(10, 20);

  // Get next order ID for the district
  let t0 = Date.now();
  const dRows = db.query(
    `SELECT d_next_o_id FROM district WHERE d_w_id = ${wId} AND d_id = ${dId}`
  );
  recordStmt(metrics, 'sl_select_district', Date.now() - t0);

  if (dRows.length === 0) return false;

  const nextOId = parseInt(dRows[0].d_next_o_id, 10);

  // Count distinct items in recent 20 orders with stock below threshold
  t0 = Date.now();
  db.query(
    `SELECT COUNT(DISTINCT s_i_id) AS low_stock
     FROM order_line
     JOIN stock ON s_i_id = ol_i_id AND s_w_id = ol_w_id
     WHERE ol_w_id = ${wId} AND ol_d_id = ${dId}
       AND ol_o_id >= ${nextOId - 20} AND ol_o_id < ${nextOId}
       AND s_quantity < ${threshold}`
  );
  recordStmt(metrics, 'sl_count_low_stock', Date.now() - t0);

  return true;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
