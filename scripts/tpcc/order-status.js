// TPC-C Order-Status transaction (4% of mix).
// Read-only: looks up customer, finds most recent order, retrieves order lines.
// Can be routed to readonly connection in replica mode.
//
// TPC-C compliance notes:
// - 60% by last name, 40% by ID (clause 2.6.2.2)

import { recordStmt } from '../lib/metrics.js';

const SYLLABLES = ['BAR', 'OUGHT', 'ABLE', 'PRI', 'PRES', 'ESE', 'ANTI', 'CALLY', 'ATION', 'EING'];

export function orderStatus(db, metrics, config) {
  const w = config.warehouses;
  const wId = randomInt(1, w);
  const dId = randomInt(1, 10);

  // Customer lookup: 60% by last name, 40% by ID
  let cId;
  let t0;

  if (Math.random() < 0.6) {
    const num = randomInt(0, 999);
    const lastName = customerLastName(num);
    t0 = Date.now();
    const cRows = db.query(
      `SELECT c_id, c_balance, c_first, c_middle, c_last
       FROM customer WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_last = '${lastName}'
       ORDER BY c_first`
    );
    recordStmt(metrics, 'os_select_customer_by_name', Date.now() - t0);

    if (cRows.length === 0) return false;
    cId = parseInt(cRows[Math.floor(cRows.length / 2)].c_id, 10);
  } else {
    cId = randomInt(1, 3000);
    t0 = Date.now();
    db.query(
      `SELECT c_balance, c_first, c_middle, c_last
       FROM customer WHERE c_w_id = ${wId} AND c_d_id = ${dId} AND c_id = ${cId}`
    );
    recordStmt(metrics, 'os_select_customer_by_id', Date.now() - t0);
  }

  // Find most recent order
  t0 = Date.now();
  const oRows = db.query(
    `SELECT o_id, o_entry_d, o_carrier_id
     FROM oorder WHERE o_w_id = ${wId} AND o_d_id = ${dId} AND o_c_id = ${cId}
     ORDER BY o_id DESC LIMIT 1`
  );
  recordStmt(metrics, 'os_select_order', Date.now() - t0);

  if (oRows.length === 0) return false;

  const oId = parseInt(oRows[0].o_id, 10);

  // Get order lines
  t0 = Date.now();
  db.query(
    `SELECT ol_i_id, ol_supply_w_id, ol_quantity, ol_amount, ol_delivery_d
     FROM order_line WHERE ol_w_id = ${wId} AND ol_d_id = ${dId} AND ol_o_id = ${oId}`
  );
  recordStmt(metrics, 'os_select_order_lines', Date.now() - t0);

  return true;
}

function customerLastName(num) {
  return SYLLABLES[Math.floor(num / 100) % 10] +
         SYLLABLES[Math.floor(num / 10) % 10] +
         SYLLABLES[num % 10];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
