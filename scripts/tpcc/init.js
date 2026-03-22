// TPC-C schema initialization — 9 tables with data generation per warehouse.
//
// Tables: warehouse, district, customer, history, oorder, new_order, order_line, item, stock
// Note: "order" is a reserved word in SQL, so the table is named "oorder".
//
// Scale factor = number of warehouses.
// Data generation follows TPC-C spec for row counts.
import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { getConfig, buildConnectionString } from '../lib/config.js';
import { createRandom } from '../lib/nurand.js';

const BATCH_SIZE = 500;

export const options = {
  iterations: 1,
  vus: 1,
  // Init can take a long time for large warehouse counts
  setupTimeout: '30m',
};

export default function () {
  const config = getConfig();
  const db = sql.open(driver, buildConnectionString(config.connection.primary));
  const warehouses = config.warehouses;

  const rng = createRandom(config.tpcc.nurand);

  try {
    initSchema(db, warehouses, rng);
  } finally {
    db.close();
  }
}

function initSchema(db, warehouses, rng) {
  console.log(`Initializing TPC-C schema with ${warehouses} warehouse(s)`);

  dropTables(db);
  createTables(db);
  populateItem(db);

  for (let w = 1; w <= warehouses; w++) {
    console.log(`Populating warehouse ${w}/${warehouses}`);
    populateWarehouse(db, w);
    populateDistricts(db, w);
    populateCustomers(db, w, rng);
    populateOrders(db, w);
    populateStock(db, w);
  }

  createIndexes(db);
  vacuumAnalyze(db);
  console.log('TPC-C initialization complete');
}

function dropTables(db) {
  const tables = ['order_line', 'new_order', 'oorder', 'history', 'customer', 'stock', 'item', 'district', 'warehouse'];
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
}

function createTables(db) {
  db.exec(`CREATE TABLE warehouse (
    w_id INT NOT NULL,
    w_name VARCHAR(10) NOT NULL,
    w_street_1 VARCHAR(20) NOT NULL,
    w_street_2 VARCHAR(20) NOT NULL,
    w_city VARCHAR(20) NOT NULL,
    w_state CHAR(2) NOT NULL,
    w_zip CHAR(9) NOT NULL,
    w_tax DECIMAL(4,4) NOT NULL,
    w_ytd DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (w_id)
  )`);

  db.exec(`CREATE TABLE district (
    d_id INT NOT NULL,
    d_w_id INT NOT NULL,
    d_name VARCHAR(10) NOT NULL,
    d_street_1 VARCHAR(20) NOT NULL,
    d_street_2 VARCHAR(20) NOT NULL,
    d_city VARCHAR(20) NOT NULL,
    d_state CHAR(2) NOT NULL,
    d_zip CHAR(9) NOT NULL,
    d_tax DECIMAL(4,4) NOT NULL,
    d_ytd DECIMAL(12,2) NOT NULL,
    d_next_o_id INT NOT NULL,
    PRIMARY KEY (d_w_id, d_id)
  )`);

  db.exec(`CREATE TABLE customer (
    c_id INT NOT NULL,
    c_d_id INT NOT NULL,
    c_w_id INT NOT NULL,
    c_first VARCHAR(16) NOT NULL,
    c_middle CHAR(2) NOT NULL,
    c_last VARCHAR(16) NOT NULL,
    c_street_1 VARCHAR(20) NOT NULL,
    c_street_2 VARCHAR(20) NOT NULL,
    c_city VARCHAR(20) NOT NULL,
    c_state CHAR(2) NOT NULL,
    c_zip CHAR(9) NOT NULL,
    c_phone CHAR(16) NOT NULL,
    c_since TIMESTAMP NOT NULL,
    c_credit CHAR(2) NOT NULL,
    c_credit_lim DECIMAL(12,2) NOT NULL,
    c_discount DECIMAL(4,4) NOT NULL,
    c_balance DECIMAL(12,2) NOT NULL,
    c_ytd_payment DECIMAL(12,2) NOT NULL,
    c_payment_cnt INT NOT NULL,
    c_delivery_cnt INT NOT NULL,
    c_data VARCHAR(500) NOT NULL,
    PRIMARY KEY (c_w_id, c_d_id, c_id)
  )`);

  db.exec(`CREATE TABLE history (
    h_c_id INT NOT NULL,
    h_c_d_id INT NOT NULL,
    h_c_w_id INT NOT NULL,
    h_d_id INT NOT NULL,
    h_w_id INT NOT NULL,
    h_date TIMESTAMP NOT NULL,
    h_amount DECIMAL(6,2) NOT NULL,
    h_data VARCHAR(24) NOT NULL
  )`);

  db.exec(`CREATE TABLE oorder (
    o_id INT NOT NULL,
    o_d_id INT NOT NULL,
    o_w_id INT NOT NULL,
    o_c_id INT NOT NULL,
    o_entry_d TIMESTAMP NOT NULL,
    o_carrier_id INT,
    o_ol_cnt INT NOT NULL,
    o_all_local INT NOT NULL,
    PRIMARY KEY (o_w_id, o_d_id, o_id)
  )`);

  db.exec(`CREATE TABLE new_order (
    no_o_id INT NOT NULL,
    no_d_id INT NOT NULL,
    no_w_id INT NOT NULL,
    PRIMARY KEY (no_w_id, no_d_id, no_o_id)
  )`);

  db.exec(`CREATE TABLE order_line (
    ol_o_id INT NOT NULL,
    ol_d_id INT NOT NULL,
    ol_w_id INT NOT NULL,
    ol_number INT NOT NULL,
    ol_i_id INT NOT NULL,
    ol_supply_w_id INT NOT NULL,
    ol_delivery_d TIMESTAMP,
    ol_quantity INT NOT NULL,
    ol_amount DECIMAL(6,2) NOT NULL,
    ol_dist_info CHAR(24) NOT NULL,
    PRIMARY KEY (ol_w_id, ol_d_id, ol_o_id, ol_number)
  )`);

  db.exec(`CREATE TABLE item (
    i_id INT NOT NULL,
    i_im_id INT NOT NULL,
    i_name VARCHAR(24) NOT NULL,
    i_price DECIMAL(5,2) NOT NULL,
    i_data VARCHAR(50) NOT NULL,
    PRIMARY KEY (i_id)
  )`);

  db.exec(`CREATE TABLE stock (
    s_i_id INT NOT NULL,
    s_w_id INT NOT NULL,
    s_quantity INT NOT NULL,
    s_dist_01 CHAR(24) NOT NULL,
    s_dist_02 CHAR(24) NOT NULL,
    s_dist_03 CHAR(24) NOT NULL,
    s_dist_04 CHAR(24) NOT NULL,
    s_dist_05 CHAR(24) NOT NULL,
    s_dist_06 CHAR(24) NOT NULL,
    s_dist_07 CHAR(24) NOT NULL,
    s_dist_08 CHAR(24) NOT NULL,
    s_dist_09 CHAR(24) NOT NULL,
    s_dist_10 CHAR(24) NOT NULL,
    s_ytd INT NOT NULL,
    s_order_cnt INT NOT NULL,
    s_remote_cnt INT NOT NULL,
    s_data VARCHAR(50) NOT NULL,
    PRIMARY KEY (s_w_id, s_i_id)
  )`);
}

function populateItem(db) {
  // 100,000 items (fixed, not per-warehouse)
  console.log('Populating item: 100000 rows');
  for (let i = 0; i < 100000; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, 100000);
    const values = [];
    for (let j = i; j < batchEnd; j++) {
      const iid = j + 1;
      const imId = randomInt(1, 10000);
      const name = randomString(14, 24);
      const price = (randomInt(100, 10000) / 100).toFixed(2);
      // TPC-C spec: 10% of items have "ORIGINAL" in i_data
      let data = randomString(26, 50);
      if (Math.random() < 0.1) {
        const pos = randomInt(0, data.length - 8);
        data = data.substring(0, pos) + 'ORIGINAL' + data.substring(pos + 8);
      }
      values.push(`(${iid}, ${imId}, '${escapeSql(name)}', ${price}, '${escapeSql(data)}')`);
    }
    db.exec(`INSERT INTO item (i_id, i_im_id, i_name, i_price, i_data) VALUES ${values.join(',')}`);
  }
}

function populateWarehouse(db, wId) {
  const name = randomString(6, 10);
  const tax = (randomInt(0, 2000) / 10000).toFixed(4);
  db.exec(`INSERT INTO warehouse (w_id, w_name, w_street_1, w_street_2, w_city, w_state, w_zip, w_tax, w_ytd)
    VALUES (${wId}, '${escapeSql(name)}', '${randomString(10, 20)}', '${randomString(10, 20)}',
            '${randomString(10, 20)}', '${randomString(2, 2)}', '${randomZip()}', ${tax}, 300000.00)`);
}

function populateDistricts(db, wId) {
  for (let d = 1; d <= 10; d++) {
    const name = randomString(6, 10);
    const tax = (randomInt(0, 2000) / 10000).toFixed(4);
    db.exec(`INSERT INTO district (d_id, d_w_id, d_name, d_street_1, d_street_2, d_city, d_state, d_zip, d_tax, d_ytd, d_next_o_id)
      VALUES (${d}, ${wId}, '${escapeSql(name)}', '${randomString(10, 20)}', '${randomString(10, 20)}',
              '${randomString(10, 20)}', '${randomString(2, 2)}', '${randomZip()}', ${tax}, 30000.00, 3001)`);
  }
}

function populateCustomers(db, wId, rng) {
  // 3,000 customers per district, 10 districts = 30,000 per warehouse
  // TPC-C spec (clause 4.3.3.1): c_id 1-1000 use deterministic syllable mapping,
  // c_id 1001-3000 use NURand(255, 0, 999) with C_LOAD for last name number.
  for (let d = 1; d <= 10; d++) {
    for (let i = 0; i < 3000; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, 3000);
      const custValues = [];
      const histValues = [];
      for (let j = i; j < batchEnd; j++) {
        const cId = j + 1;
        const last = customerLastName(cId <= 1000 ? cId - 1 : rng.lastNameLoad());
        const credit = Math.random() < 0.1 ? 'BC' : 'GC';
        const discount = (randomInt(0, 5000) / 10000).toFixed(4);
        custValues.push(
          `(${cId}, ${d}, ${wId}, '${randomString(8, 16)}', 'OE', '${escapeSql(last)}', ` +
          `'${randomString(10, 20)}', '${randomString(10, 20)}', '${randomString(10, 20)}', ` +
          `'${randomString(2, 2)}', '${randomZip()}', '${randomDigits(16)}', CURRENT_TIMESTAMP, ` +
          `'${credit}', 50000.00, ${discount}, -10.00, 10.00, 1, 0, '${randomString(300, 500)}')`
        );
        histValues.push(
          `(${cId}, ${d}, ${wId}, ${d}, ${wId}, CURRENT_TIMESTAMP, 10.00, '${randomString(12, 24)}')`
        );
      }
      db.exec(`INSERT INTO customer (c_id, c_d_id, c_w_id, c_first, c_middle, c_last, c_street_1, c_street_2, c_city, c_state, c_zip, c_phone, c_since, c_credit, c_credit_lim, c_discount, c_balance, c_ytd_payment, c_payment_cnt, c_delivery_cnt, c_data) VALUES ${custValues.join(',')}`);
      db.exec(`INSERT INTO history (h_c_id, h_c_d_id, h_c_w_id, h_d_id, h_w_id, h_date, h_amount, h_data) VALUES ${histValues.join(',')}`);
    }
  }
}

function populateOrders(db, wId) {
  // 3,000 orders per district, with order_line and new_order
  for (let d = 1; d <= 10; d++) {
    // Generate a permutation of customer IDs 1-3000 for o_c_id assignment
    const custPerm = shuffleArray(rangeArray(1, 3000));

    for (let i = 0; i < 3000; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, 3000);
      const orderValues = [];
      const newOrderValues = [];
      const olValues = [];

      for (let j = i; j < batchEnd; j++) {
        const oId = j + 1;
        const cId = custPerm[j];
        const olCnt = randomInt(5, 15);
        const carrierId = oId < 2101 ? randomInt(1, 10) : 'NULL';

        orderValues.push(
          `(${oId}, ${d}, ${wId}, ${cId}, CURRENT_TIMESTAMP, ${carrierId}, ${olCnt}, 1)`
        );

        // new_order for orders 2101-3000
        if (oId >= 2101) {
          newOrderValues.push(`(${oId}, ${d}, ${wId})`);
        }

        // order lines
        for (let ol = 1; ol <= olCnt; ol++) {
          const olIId = randomInt(1, 100000);
          const olAmount = oId < 2101 ? '0.00' : (randomInt(1, 999999) / 100).toFixed(2);
          const deliveryD = oId < 2101 ? 'CURRENT_TIMESTAMP' : 'NULL';
          olValues.push(
            `(${oId}, ${d}, ${wId}, ${ol}, ${olIId}, ${wId}, ${deliveryD}, 5, ${olAmount}, '${randomString(24, 24)}')`
          );
        }
      }

      db.exec(`INSERT INTO oorder (o_id, o_d_id, o_w_id, o_c_id, o_entry_d, o_carrier_id, o_ol_cnt, o_all_local) VALUES ${orderValues.join(',')}`);
      if (newOrderValues.length > 0) {
        db.exec(`INSERT INTO new_order (no_o_id, no_d_id, no_w_id) VALUES ${newOrderValues.join(',')}`);
      }
      if (olValues.length > 0) {
        db.exec(`INSERT INTO order_line (ol_o_id, ol_d_id, ol_w_id, ol_number, ol_i_id, ol_supply_w_id, ol_delivery_d, ol_quantity, ol_amount, ol_dist_info) VALUES ${olValues.join(',')}`);
      }
    }
  }
}

function populateStock(db, wId) {
  // 100,000 stock rows per warehouse
  console.log(`  Populating stock for warehouse ${wId}: 100000 rows`);
  for (let i = 0; i < 100000; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, 100000);
    const values = [];
    for (let j = i; j < batchEnd; j++) {
      const sIId = j + 1;
      const qty = randomInt(10, 100);
      let data = randomString(26, 50);
      if (Math.random() < 0.1) {
        const pos = randomInt(0, data.length - 8);
        data = data.substring(0, pos) + 'ORIGINAL' + data.substring(pos + 8);
      }
      const dists = [];
      for (let k = 0; k < 10; k++) {
        dists.push(`'${randomString(24, 24)}'`);
      }
      values.push(
        `(${sIId}, ${wId}, ${qty}, ${dists.join(',')}, 0, 0, 0, '${escapeSql(data)}')`
      );
    }
    db.exec(`INSERT INTO stock (s_i_id, s_w_id, s_quantity, s_dist_01, s_dist_02, s_dist_03, s_dist_04, s_dist_05, s_dist_06, s_dist_07, s_dist_08, s_dist_09, s_dist_10, s_ytd, s_order_cnt, s_remote_cnt, s_data) VALUES ${values.join(',')}`);
  }
}

function createIndexes(db) {
  console.log('Creating indexes');
  // Secondary indexes per TPC-C spec
  db.exec('CREATE INDEX idx_customer_name ON customer (c_w_id, c_d_id, c_last, c_first)');
  db.exec('CREATE INDEX idx_oorder_carrier ON oorder (o_w_id, o_d_id, o_carrier_id, o_id)');
}

function vacuumAnalyze(db) {
  console.log('Running VACUUM ANALYZE');
  const tables = ['warehouse', 'district', 'customer', 'history', 'oorder', 'new_order', 'order_line', 'item', 'stock'];
  for (const t of tables) {
    db.exec(`VACUUM ANALYZE ${t}`);
  }
}

// --- Utility functions ---

// TPC-C customer last name from syllable list (clause 4.3.2.3)
const SYLLABLES = ['BAR', 'OUGHT', 'ABLE', 'PRI', 'PRES', 'ESE', 'ANTI', 'CALLY', 'ATION', 'EING'];

function customerLastName(num) {
  return SYLLABLES[Math.floor(num / 100) % 10] +
         SYLLABLES[Math.floor(num / 10) % 10] +
         SYLLABLES[num % 10];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomString(minLen, maxLen) {
  const len = randomInt(minLen, maxLen);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CHARS.charAt(randomInt(0, CHARS.length - 1));
  }
  return s;
}

function randomDigits(len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String(randomInt(0, 9));
  }
  return s;
}

function randomZip() {
  return randomDigits(4) + '11111';
}

function escapeSql(s) {
  return s.replace(/'/g, "''");
}

function rangeArray(start, end) {
  const arr = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
