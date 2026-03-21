// TPC-C Delivery transaction (4% of mix).
// Write-only: processes oldest new_order for each of 10 districts.
// Deletes new_order, updates order carrier, sums order_line amounts, updates customer balance.
//
// TPC-C compliance notes:
// - Should be executed as a deferred/background transaction in full compliance (clause 2.7.4)
// - Simplified: runs inline as a single transaction

import { recordStmt } from '../lib/metrics.js';

export function delivery(db, metrics, config) {
  const w = config.warehouses;
  const wId = randomInt(1, w);
  const carrierId = randomInt(1, 10);

  db.exec('BEGIN');

  for (let dId = 1; dId <= 10; dId++) {
    // Find oldest new_order
    let t0 = Date.now();
    const noRows = db.query(
      `SELECT no_o_id FROM new_order
       WHERE no_w_id = ${wId} AND no_d_id = ${dId}
       ORDER BY no_o_id LIMIT 1 FOR UPDATE`
    );
    recordStmt(metrics, 'del_select_new_order', Date.now() - t0);

    if (noRows.length === 0) continue;

    const noOId = parseInt(noRows[0].no_o_id, 10);

    // Delete new_order
    t0 = Date.now();
    db.exec(`DELETE FROM new_order WHERE no_w_id = ${wId} AND no_d_id = ${dId} AND no_o_id = ${noOId}`);
    recordStmt(metrics, 'del_delete_new_order', Date.now() - t0);

    // Update order with carrier
    t0 = Date.now();
    const oRows = db.query(
      `UPDATE oorder SET o_carrier_id = ${carrierId}
       WHERE o_w_id = ${wId} AND o_d_id = ${dId} AND o_id = ${noOId}
       RETURNING o_c_id`
    );
    recordStmt(metrics, 'del_update_order', Date.now() - t0);

    if (oRows.length === 0) continue;
    const cId = parseInt(oRows[0].o_c_id, 10);

    // Update order_line delivery date and sum amounts
    t0 = Date.now();
    const olRows = db.query(
      `UPDATE order_line SET ol_delivery_d = CURRENT_TIMESTAMP
       WHERE ol_w_id = ${wId} AND ol_d_id = ${dId} AND ol_o_id = ${noOId}
       RETURNING ol_amount`
    );
    recordStmt(metrics, 'del_update_order_line', Date.now() - t0);

    let totalAmount = 0;
    for (const row of olRows) {
      totalAmount += parseFloat(row.ol_amount);
    }

    // Update customer balance and delivery count
    t0 = Date.now();
    db.exec(
      `UPDATE customer SET c_balance = c_balance + ${totalAmount.toFixed(2)}, c_delivery_cnt = c_delivery_cnt + 1
       WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_id = ${cId}`
    );
    recordStmt(metrics, 'del_update_customer', Date.now() - t0);
  }

  db.exec('COMMIT');
  return true;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
