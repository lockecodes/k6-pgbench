# k6-pgbench Design Spec

## Overview

k6-pgbench is a k6-based implementation of pgbench (TPC-B) and TPC-C benchmarks for PostgreSQL, built with xk6-sql. It provides standardized load testing with configurable metrics reporting to Grafana Cloud via Prometheus remote write through Grafana Alloy.

### Goals

1. Exact pgbench-equivalent TPC-B implementation producing comparable results
2. Simplified TPC-C implementation with correct transaction mix, designed for future full compliance
3. Read replica routing support for testing horizontal read scaling
4. Configurable metrics export to Grafana Cloud via kubernetes-monitoring (Alloy)
5. Self-contained CNPG example using Tilt + Helm following neon-cnpg conventions

### Non-Goals

- Full TPC-C spec compliance (think times, keying times, terminal emulation) — deferred, architecture supports it
- Bundled Grafana dashboards — users query metrics directly in Grafana Cloud
- Direct neon-cnpg integration — documented path only, implemented separately

## Repository Structure

```
k6-pgbench/
├── Dockerfile                    # Multi-stage: xk6 build + runtime
├── Makefile                      # Build, test, lint targets
├── README.md
├── LICENSE
├── .gitignore
│
├── scripts/                      # k6 test scripts
│   ├── lib/                      # Shared utilities
│   │   ├── db.js                 # Connection management (primary/readonly routing)
│   │   ├── metrics.js            # Custom metric registration (tiered)
│   │   ├── config.js             # Config loader (env vars + options)
│   │   └── pgstats.js            # pg_stat_* sampler (comprehensive tier)
│   │
│   ├── pgbench/                  # TPC-B (pgbench equivalent)
│   │   ├── init.js               # Schema creation + data population
│   │   ├── tpcb.js               # Default TPC-B transaction (5 statements)
│   │   ├── select-only.js        # Read-only mode (-S equivalent)
│   │   ├── simple-update.js      # Simple update mode (-N equivalent)
│   │   └── tpcb-readonly.js      # TPC-B with reads routed to replicas
│   │
│   └── tpcc/                     # TPC-C implementation
│       ├── init.js               # 9-table schema + data generation
│       ├── tpcc.js               # Full mix (45/43/4/4/4) against primary
│       ├── new-order.js          # Individual transaction types
│       ├── payment.js
│       ├── order-status.js
│       ├── delivery.js
│       ├── stock-level.js
│       └── tpcc-readonly.js      # Read txns routed to replicas
│
├── examples/
│   └── cnpg/                     # CNPG Tilt example
│       ├── Tiltfile
│       ├── values.yaml
│       ├── .values.override.yaml # (gitignored)
│       ├── configs/
│       │   ├── tpcb-default.yaml
│       │   ├── tpcc-default.yaml
│       │   └── tpcc-readonly.yaml
│       └── charts/
│           ├── cnpg/             # CNPG operator + Cluster CR
│           ├── k6/               # k6 benchmark jobs
│           └── monitoring/       # Optional kubernetes-monitoring
│
└── docs/
    └── superpowers/
        └── specs/
```

## Build: Custom k6 Binary

Multi-stage Dockerfile:

1. **Builder stage** (`grafana/xk6`): Runs `xk6 build` with extensions:
   - `github.com/grafana/xk6-sql`
   - `github.com/grafana/xk6-sql-driver-postgres`

2. **Runtime stage** (minimal base): Copies the built k6 binary and `scripts/` directory.

The Tiltfile builds this image locally via `docker_build()`. No pre-built registry image — local builds only for now.

## k6 Script Architecture

### Connection Management (`lib/db.js`)

Accepts a `connections` config object:

```javascript
{
  primary: { host, port, user, password, database },
  readonly: { host, port, user, password, database },  // optional
  mode: "separate" | "pooler"
}
```

- **`separate` mode**: Opens distinct SQL connections to primary and readonly endpoints. Benchmark scripts call `db.primary()` for writes and `db.readonly()` for reads.
- **`pooler` mode**: Single connection to the primary/pooler endpoint. Read transactions issue `SET default_transaction_read_only = on` before executing, then reset afterward.

When `readonly` is not configured, all queries go to primary regardless of mode.

### Config Resolution (`lib/config.js`)

Environment variables for connection:
- `K6_PG_HOST`, `K6_PG_PORT`, `K6_PG_USER`, `K6_PG_PASSWORD`, `K6_PG_DATABASE`
- `K6_PG_READONLY_HOST`, `K6_PG_READONLY_PORT` (optional, for separate mode)
- `K6_PG_CONNECTION_MODE` — `separate` or `pooler`

Benchmark parameters:
- `K6_PGBENCH_SCALE` — scale factor (default 50)
- `K6_METRICS_LEVEL` — `minimal`, `standard`, or `comprehensive`
- `K6_BENCHMARK_SCENARIO` — scenario name label for metrics

k6 Prometheus remote write:
- `K6_PROMETHEUS_RW_SERVER_URL` — Alloy's in-cluster endpoint
- `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true`

VU count, duration, warmup, and runs are controlled via k6's standard `options` export in each script.

### Metrics Tiers (`lib/metrics.js`)

**minimal** (always registered):

| Metric | Type | Description |
|--------|------|-------------|
| `pgbench_tps` | Rate | Transactions per second |
| `pgbench_latency` | Trend | End-to-end transaction latency |
| `pgbench_errors` | Counter | Failed transactions |

**standard** (adds to minimal):

| Metric | Type | Description |
|--------|------|-------------|
| `pgbench_tx_{type}_latency` | Trend | Per-transaction-type latency |
| `pgbench_stmt_{name}_latency` | Trend | Per-SQL-statement latency |
| `pgbench_read_tps` | Rate | Read transaction throughput |
| `pgbench_write_tps` | Rate | Write transaction throughput |
| `pgbench_connections_active` | Gauge | Active connection count |

**comprehensive** (adds to standard):

| Metric | Type | Description |
|--------|------|-------------|
| `pgbench_replication_lag_bytes` | Gauge | From `pg_stat_replication` |
| `pgbench_locks_waiting` | Gauge | From `pg_stat_activity` |
| `pgbench_table_{name}_rows` | Gauge | From `pg_stat_user_tables` |

All metrics are tagged with labels: `benchmark` (tpcb/tpcc), `scenario` (config name), `target` (primary/readonly), `connection_mode` (separate/pooler).

The comprehensive tier runs a periodic sampling VU that queries `pg_stat_*` views at a configurable interval (default 10s).

### pg_stat Sampler (`lib/pgstats.js`)

Only active when `metricsLevel: comprehensive`. A dedicated k6 scenario runs a single VU that periodically queries:
- `pg_stat_replication` for replication lag
- `pg_stat_activity` for lock waits
- `pg_stat_user_tables` for row counts

Results are emitted as custom k6 metrics with the same label set.

## TPC-B Implementation (pgbench Equivalent)

### Schema (`pgbench/init.js`)

Creates the exact pgbench schema:

```sql
CREATE TABLE pgbench_branches (bid INT NOT NULL, bbalance INT NOT NULL, filler CHAR(88) NOT NULL DEFAULT '');
CREATE TABLE pgbench_tellers (tid INT NOT NULL, bid INT NOT NULL, tbalance INT NOT NULL, filler CHAR(84) NOT NULL DEFAULT '');
CREATE TABLE pgbench_accounts (aid INT NOT NULL, bid INT NOT NULL, abalance INT NOT NULL, filler CHAR(84) NOT NULL DEFAULT '');
CREATE TABLE pgbench_history (tid INT NOT NULL, bid INT NOT NULL, aid INT NOT NULL, delta INT NOT NULL, mtime TIMESTAMP NOT NULL);
```

Primary keys on `bid`, `tid`, `aid`. Data population:
- `pgbench_branches`: `scale` rows, bbalance = 0
- `pgbench_tellers`: `scale * 10` rows, tbalance = 0
- `pgbench_accounts`: `scale * 100000` rows, abalance = 0
- `pgbench_history`: empty

Followed by VACUUM and ANALYZE on all tables.

Data is inserted in batches (1000 rows per INSERT) for performance. The init script is idempotent — it drops and recreates tables if they exist.

### Default Transaction (`pgbench/tpcb.js`)

Matches `pgbench` default (no flags) exactly:

```sql
BEGIN;
UPDATE pgbench_accounts SET abalance = abalance + :delta WHERE aid = :aid;
SELECT abalance FROM pgbench_accounts WHERE aid = :aid;
UPDATE pgbench_tellers SET tbalance = tbalance + :delta WHERE tid = :tid;
UPDATE pgbench_branches SET bbalance = bbalance + :delta WHERE bid = :bid;
INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES (:tid, :bid, :aid, :delta, CURRENT_TIMESTAMP);
END;
```

Random value generation matches pgbench's distribution:
- `aid`: uniform random in [1, scale * 100000]
- `bid`: uniform random in [1, scale]
- `tid`: uniform random in [1, scale * 10]
- `delta`: uniform random in [-5000, 5000]

### Select-Only (`pgbench/select-only.js`)

Equivalent to `pgbench -S`:

```sql
SELECT abalance FROM pgbench_accounts WHERE aid = :aid;
```

### Simple Update (`pgbench/simple-update.js`)

Equivalent to `pgbench -N`:

```sql
BEGIN;
UPDATE pgbench_accounts SET abalance = abalance + :delta WHERE aid = :aid;
SELECT abalance FROM pgbench_accounts WHERE aid = :aid;
INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES (:tid, :bid, :aid, :delta, CURRENT_TIMESTAMP);
END;
```

### Read-Replica Variant (`pgbench/tpcb-readonly.js`)

Same transaction as `tpcb.js`, but the SELECT is routed to the readonly connection while all writes go to primary. In `separate` mode, opens a second connection to the readonly service. In `pooler` mode, uses `SET default_transaction_read_only`.

## TPC-C Implementation (Simplified)

### Design Philosophy

Implements the core TPC-C workload with correct transaction types and mix ratios. Omits think times, keying times, and terminal emulation. Architecture is designed so these can be added via configuration without restructuring.

**Future full-compliance notes are embedded as code comments** at each point where the simplified version deviates from the spec. Each comment references the relevant TPC-C specification clause.

### Schema (`tpcc/init.js`)

9 tables per the TPC-C spec:

| Table | Rows (per warehouse) | Key Columns |
|-------|---------------------|-------------|
| `warehouse` | 1 | w_id |
| `district` | 10 | d_w_id, d_id |
| `customer` | 30,000 | c_w_id, c_d_id, c_id |
| `history` | 30,000 | (no PK) |
| `order` | 30,000 | o_w_id, o_d_id, o_id |
| `new_order` | 9,000 | no_w_id, no_d_id, no_o_id |
| `order_line` | ~300,000 | ol_w_id, ol_d_id, ol_o_id, ol_number |
| `item` | 100,000 (fixed) | i_id |
| `stock` | 100,000 | s_w_id, s_i_id |

Scale factor = number of warehouses.

Data generation follows TPC-C spec for column values (random strings with required patterns, NURand for customer/item selection). Simplified version uses uniform random where NURand is specified — **commented for future compliance**.

### Transaction Types

Each transaction is a separate module file exporting a function that accepts a database connection and config.

**New-Order (45%)** — `new-order.js`:
- Select warehouse tax, district tax, update district next order ID
- Insert order, new_order
- For each of 5-15 random items: check stock, update stock, insert order_line
- Write-only transaction

**Payment (43%)** — `payment.js`:
- Update warehouse YTD, district YTD
- Look up customer (by ID 60%, by last name 40%)
- Update customer balance, insert history
- Write-only transaction

**Order-Status (4%)** — `order-status.js`:
- Look up customer, find most recent order, retrieve order lines
- **Read-only transaction** — routed to replica in readonly mode

**Delivery (4%)** — `delivery.js`:
- For each of 10 districts: find oldest new_order, delete it, update order carrier, sum order_line amounts, update customer balance
- Write-only transaction (batch)

**Stock-Level (4%)** — `stock-level.js`:
- Find recent order lines for a district, count items with stock below threshold
- **Read-only transaction** — routed to replica in readonly mode

### Mix Execution (`tpcc/tpcc.js`)

Uses weighted random selection per VU iteration:
```javascript
const weights = [
  { type: 'new_order',    weight: 45, fn: newOrder },
  { type: 'payment',      weight: 43, fn: payment },
  { type: 'order_status', weight: 4,  fn: orderStatus },
  { type: 'delivery',     weight: 4,  fn: delivery },
  { type: 'stock_level',  weight: 4,  fn: stockLevel },
];
```

### Read-Replica Variant (`tpcc/tpcc-readonly.js`)

Same mix as `tpcc.js`. Order-Status and Stock-Level are routed to the readonly connection. All other transactions go to primary. This tests the natural 8% read ratio of TPC-C being offloaded to replicas.

### Future Full-Compliance Additions

The following are **not implemented** but the architecture supports them without restructuring:

- **Think times and keying times** — Add optional `sleep()` calls controlled by config flags `thinkTime: true` and `keyingTime: true`. Defaults to false (current behavior).
- **Terminal emulation** — Each VU represents a terminal. Add a VU lifecycle wrapper that enforces TPC-C terminal state machine.
- **Strict NURand data generation** — Replace uniform random with NURand(A, x, y) per TPC-C clause 2.1.6. Config flag `strictNURand: true`.
- **Response time constraints** — TPC-C requires 90% of New-Order < 5s, etc. Add threshold validation in k6 options. Config flag `enforceResponseTimes: true`.
- **Full clause 4.3 data generation** — Customer last names from syllable list, street/city from random strings with specific length constraints.

## CNPG Example (`examples/cnpg/`)

### Tiltfile

Mirrors the neon-cnpg/load-test Tiltfile pattern:

- `read_yaml_config()`, `deep_merge()`, `write_values_file()` — identical helper functions
- Reads `values.yaml` + `.values.override.yaml`, merges, splits into per-chart sections
- Watches both files for live reload
- Scenario selection via `tilt.scenario` → `configs/{scenario}.yaml`
- `config.define_string_list('values')` for CLI overrides

Resource dependency graph:
```
create-namespace
  ↓
cnpg-operator (helm_resource — deploys CNPG operator)
  ↓
cnpg-cluster (Cluster CR via charts/cnpg)
  ↓
wait-for-cluster (primary ready + optional replica pods)
  ↓
k6-init (Job — schema + data via charts/k6)
  ↓
k6-benchmark (Job — runs selected benchmark)

(if tilt.monitoring.enabled)
monitoring (helm_resource — kubernetes-monitoring chart)
```

### `values.yaml`

```yaml
tilt:
  scenario: tpcb-default
  monitoring:
    enabled: false

cnpg:
  instances: 1
  replicas: 0
  storage:
    size: 2Gi
  postgresql:
    parameters:
      shared_buffers: "256MB"

k6:
  image: k6-pgbench
  benchmark:
    type: tpcb            # tpcb | tpcb-select-only | tpcb-simple-update | tpcc
    scale: 50
    vus: 5
    duration: "600s"
    warmupDuration: "300s"
    runs: 3
    readOnly: false
    connectionMode: separate
    metricsLevel: standard
  connection:
    port: 5432
    user: app
    database: app

monitoring: {}
```

### Helm Charts

**`charts/cnpg/`**:
- `Chart.yaml` with dependency on `cloudnative-pg` operator chart
- Templates: `Cluster` CR with configurable instances, replicas, storage, postgresql parameters
- CNPG auto-creates `-rw` and `-ro` services + app user secret

**`charts/k6/`**:
- `k6-init` Job: initContainer waits for postgres, then runs `k6 run /scripts/pgbench/init.js` or `/scripts/tpcc/init.js`
- `k6-benchmark` Job: runs the selected benchmark script with full env var configuration
- ConfigMap mounting the `scripts/` directory from the Docker image
- Environment variables for connection, scale, metrics, Prometheus remote write URL

**`charts/monitoring/`**:
- `Chart.yaml` declares dependency on `grafana/kubernetes-monitoring` Helm chart
- `values.yaml` has defaults for cluster metrics and pod logs
- Users configure Grafana Cloud credentials + Alloy destinations via `.values.override.yaml` under the `monitoring:` section

### Scenario Configs

**`configs/tpcb-default.yaml`**: TPC-B with scale 50, 16 VUs, 600s duration.

**`configs/tpcc-default.yaml`**: TPC-C with 10 warehouses, 20 VUs, 600s duration.

**`configs/tpcc-readonly.yaml`**: TPC-C with 2 CNPG replicas, readOnly routing enabled, separate connection mode.

## Metrics Pipeline

```
k6 pod → (Prometheus remote write) → Alloy in-cluster endpoint → Grafana Cloud Prometheus → Grafana Cloud dashboards
```

k6 benchmark Job env vars:
- `K6_PROMETHEUS_RW_SERVER_URL`: Points to Alloy's metrics write endpoint (e.g., `http://alloy-metrics.monitoring.svc:9090/api/v1/write`)
- `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM`: `true` for accurate percentile queries

When `tilt.monitoring.enabled: false`, these env vars are omitted and k6 outputs to stdout only. Metrics are still collected and reported in the Job logs — Grafana integration is additive, not required.

## pgbench Equivalence Validation

The k6 TPC-B implementation matches pgbench in:
- **Schema**: Identical table definitions, column types, filler padding, primary keys
- **Data population**: Same row counts per scale factor, same initial values
- **Transaction SQL**: Same statements in same order within transaction blocks
- **Random distribution**: Same uniform random ranges for aid, bid, tid, delta

Expected deviation: ~10-15% TPS difference due to k6's SQL driver overhead vs pgbench's libpq pipeline mode. This is documented and consistent — the workload profile is identical, making cross-tool comparisons valid when both sides use k6-pgbench.

## neon-cnpg Integration Path (Future)

Not implemented in this project. Documented here to ensure the architecture supports it.

When integrated into neon-cnpg/load-test:
- `charts/test/` gains `k6-init.yaml` and `k6-benchmark.yaml` templates alongside existing pgbench templates
- `values.yaml` gains `test.engine: pgbench | k6` — defaults to pgbench (preserves current behavior)
- When `engine: k6`, Tiltfile builds k6-pgbench image via `docker_build()`
- k6 Jobs use neon-cnpg connection details (port 55433, cloud_admin user, compute endpoint service name)
- Same Alloy pipeline for metrics, same cluster-monitor running alongside
- Scenario configs add engine selection field
