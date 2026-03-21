import sql from 'k6/x/sql';
import driver from 'k6/x/sql/driver/postgres';
import { getConfig, buildConnectionString } from './config.js';

// Database connection manager supporting primary/readonly routing.
//
// Modes:
//   "separate" — distinct connections to primary and readonly endpoints
//   "pooler"   — single connection, uses SET default_transaction_read_only for routing
//                NOTE: pooler mode requires PgBouncer in session pooling mode.
//                In transaction mode, SET commands are unreliable across transactions.

let _primaryDb = null;
let _readonlyDb = null;
let _config = null;

// Open the primary database connection.
export function openPrimary() {
  if (_primaryDb) return _primaryDb;
  _config = _config || getConfig();
  _primaryDb = sql.open(driver, buildConnectionString(_config.connection.primary));
  return _primaryDb;
}

// Open the readonly database connection.
// Falls back to primary if readonly host is not configured.
export function openReadonly() {
  if (_readonlyDb) return _readonlyDb;
  _config = _config || getConfig();

  const roHost = _config.connection.readonly.host;
  if (!roHost) {
    // No readonly configured — fall back to primary
    _readonlyDb = openPrimary();
    return _readonlyDb;
  }

  if (_config.connection.mode === 'pooler') {
    // Pooler mode: reuse primary connection, caller uses SET for routing
    _readonlyDb = openPrimary();
    return _readonlyDb;
  }

  // Separate mode: open distinct connection to readonly endpoint
  _readonlyDb = sql.open(driver, buildConnectionString(_config.connection.readonly));
  return _readonlyDb;
}

// Execute a read-only query, handling routing mode automatically.
// In pooler mode, wraps the query with SET default_transaction_read_only.
export function queryReadonly(readonlyDb, queryStr, ...args) {
  _config = _config || getConfig();
  if (_config.connection.mode === 'pooler' && _config.connection.readonly.host) {
    readonlyDb.exec('SET default_transaction_read_only = on');
    try {
      return readonlyDb.query(queryStr, ...args);
    } finally {
      readonlyDb.exec('SET default_transaction_read_only = off');
    }
  }
  return readonlyDb.query(queryStr, ...args);
}

// Close all open connections. Call in teardown().
export function closeAll() {
  if (_primaryDb) {
    _primaryDb.close();
    _primaryDb = null;
  }
  if (_readonlyDb && _readonlyDb !== _primaryDb) {
    _readonlyDb.close();
  }
  _readonlyDb = null;
}
