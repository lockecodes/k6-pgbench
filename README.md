# k6-pgbench

**pgbench (TPC-B)** and **TPC-C** benchmark implementations using [k6](https://grafana.com/docs/k6/) with the [xk6-sql](https://github.com/grafana/xk6-sql) extension. Designed for benchmarking [CloudNativePG](https://cloudnative-pg.io/) clusters with read replica routing, configurable metrics tiers, and optional Grafana Cloud observability.

## Features

- **Exact pgbench TPC-B** — faithful reproduction of pgbench's schema, data generation, and transaction logic (standard, select-only, simple-update modes)
- **Spec-compliant TPC-C** — 9-table schema with all 5 transaction types in the correct 45/43/4/4/4 weighted mix, NURand distribution, deferred delivery, and think time (all [configurable](#tpc-c-compliance-options))
- **Read replica routing** — separate connection strings for primary and readonly endpoints, with `separate` and `pooler` connection modes
- **Configurable metrics** — three tiers (minimal, standard, comprehensive) controlling how much telemetry is emitted
- **Prometheus remote write** — push metrics directly to Grafana Cloud or any Prometheus-compatible endpoint
- **Grafana dashboard** — importable dashboard with TPS, latency percentiles, per-transaction and per-statement breakdowns
- **CNPG example** — turnkey local environment using k3d, Tilt, and Helm charts

## Repository Structure

```
k6-pgbench/
├── Dockerfile                  # Custom k6 binary with xk6-sql
├── scripts/
│   ├── lib/
│   │   ├── config.js           # Environment-based configuration
│   │   ├── db.js               # Connection manager (primary/readonly routing)
│   │   ├── metrics.js          # Tiered metrics (minimal/standard/comprehensive)
│   │   └── pgstats.js          # pg_stat_* sampler (comprehensive tier)
│   ├── pgbench/
│   │   ├── init.js             # pgbench schema + data generation
│   │   ├── tpcb.js             # Standard TPC-B (pgbench default)
│   │   ├── select-only.js      # pgbench -S equivalent
│   │   ├── simple-update.js    # pgbench -N equivalent
│   │   ├── tpcb-readonly.js    # Write/read split for replica testing
│   │   └── tpcb-scale-test.js # Ramping read load for horizontal scaling tests
│   └── tpcc/
│       ├── init.js             # TPC-C 9-table schema + per-warehouse data
│       ├── tpcc.js             # Full TPC-C mix (45/43/4/4/4)
│       ├── tpcc-readonly.js    # Routes read txns to replicas
│       ├── new-order.js        # New-Order transaction (45%)
│       ├── payment.js          # Payment transaction (43%)
│       ├── order-status.js     # Order-Status transaction (4%)
│       ├── delivery.js         # Delivery transaction (4%)
│       └── stock-level.js      # Stock-Level transaction (4%)
├── dashboards/
│   └── k6-pgbench.json         # Grafana dashboard (import-ready)
└── examples/
    └── cnpg/                   # CloudNativePG local example
```

## Benchmark Types

| Type | Script | Description |
|------|--------|-------------|
| `tpcb` | `pgbench/tpcb.js` | Standard TPC-B — UPDATE accounts, SELECT abalance, UPDATE tellers, UPDATE branches, INSERT history |
| `tpcb-select-only` | `pgbench/select-only.js` | Read-only workload (`pgbench -S`) — SELECT abalance only |
| `tpcb-simple-update` | `pgbench/simple-update.js` | Simplified writes (`pgbench -N`) — skips tellers/branches updates |
| `tpcb-readonly` | `pgbench/tpcb-readonly.js` | Parallel write + read VU groups targeting primary and replicas |
| `tpcb-scale-test` | `pgbench/tpcb-scale-test.js` | Ramping read VUs for horizontal scaling tests (see [Horizontal Scaling Test](#horizontal-scaling-test)) |
| `tpcc` | `tpcc/tpcc.js` | Full TPC-C mix: New-Order 45%, Payment 43%, Order-Status 4%, Delivery 4%, Stock-Level 4% |
| `tpcc-readonly` | `tpcc/tpcc-readonly.js` | TPC-C with Order-Status and Stock-Level routed to read replicas |

## Metrics Tiers

| Tier | Metrics |
|------|---------|
| **minimal** | `pgbench_tps` (success rate), `pgbench_latency` (overall), `pgbench_errors` (error count) |
| **standard** | All minimal + per-transaction-type latency, per-statement latency, read/write TPS split, active connections |
| **comprehensive** | All standard + replication lag, waiting locks, per-table row counts (via pg_stat sampler) |

## Docker Image

The Dockerfile builds a custom k6 binary with PostgreSQL support:

```dockerfile
FROM grafana/xk6:latest AS builder
RUN xk6 build \
    --with github.com/grafana/xk6-sql@v1.0.6 \
    --with github.com/grafana/xk6-sql-driver-postgres@v0.1.2 \
    --output /tmp/k6
```

Build locally:

```bash
docker build -t k6-pgbench .
```

## Environment Variables

### Connection

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_PG_HOST` | `localhost` | Primary PostgreSQL host |
| `K6_PG_PORT` | `5432` | Primary PostgreSQL port |
| `K6_PG_USER` | `app` | Database user |
| `K6_PG_PASSWORD` | (empty) | Database password |
| `K6_PG_DATABASE` | `app` | Database name |
| `K6_PG_READONLY_HOST` | (empty) | Readonly replica host |
| `K6_PG_READONLY_PORT` | same as primary | Readonly replica port |
| `K6_PG_CONNECTION_MODE` | `separate` | `separate` (distinct hosts) or `pooler` (SET commands for routing) |

### Benchmark

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_PGBENCH_SCALE` | `50` | Scale factor (number of accounts = scale * 100,000) |
| `K6_VUS` | `5` | Number of virtual users |
| `K6_DURATION` | `600s` | Benchmark duration |
| `K6_METRICS_LEVEL` | `standard` | Metrics tier: `minimal`, `standard`, or `comprehensive` |
| `K6_TPCC_WAREHOUSES` | same as scale | Number of TPC-C warehouses |
| `K6_PGSTAT_INTERVAL` | `10` | Seconds between pg_stat samples (comprehensive tier) |
| `K6_TPCC_NURAND` | `true` | Use NURand distribution for TPC-C customer/item selection |
| `K6_TPCC_DEFERRED_DELIVERY` | `false` | Run delivery in a separate VU group |
| `K6_TPCC_THINK_TIME` | `false` | Apply terminal keying + think time delays |

### Prometheus

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_PROMETHEUS_RW_SERVER_URL` | (empty) | Prometheus remote write endpoint |
| `K6_PROMETHEUS_RW_USERNAME` | (empty) | Basic auth username |
| `K6_PROMETHEUS_RW_PASSWORD` | (empty) | Basic auth password |
| `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM` | `true` | Send Trend metrics as native histograms |

---

## CNPG Example

The `examples/cnpg/` directory provides a complete local environment that deploys a CloudNativePG cluster on k3d and runs benchmarks against it using Tilt.

### Prerequisites

- **Docker** (running)
- **Tilt** ([install](https://docs.tilt.dev/install.html))
- **kubectl**
- **Helm**

k3d and ctlptl are installed automatically by `make cluster` if not present.

### Quick Start

```bash
cd examples/cnpg

# Create k3d cluster, build image, deploy CNPG, run TPC-B benchmark
make up
```

This will:

1. Create a k3d cluster with a local registry (`ctlptl-registry:5005`)
2. Install the CNPG operator
3. Deploy a single-instance PostgreSQL cluster
4. Build the k6-pgbench Docker image
5. Run the init job (create schema + load data at scale 50)
6. Run the benchmark job (TPC-B, 16 VUs, 10 minutes)

Tilt's UI opens at http://localhost:10350 where you can watch progress and logs.

### Make Targets

```
make up              # Start Tilt (creates cluster if needed)
make down            # Stop Tilt and tear down k8s resources
make cluster         # Ensure k3d cluster + registry exist
make clean           # Destroy k3d cluster and all temp files
make status          # Show pods, services, and jobs
make scenarios       # List available benchmark scenarios
make benchmark SCENARIO=tpcc-default   # Run a specific scenario
```

### Configuration

Configuration uses a layered YAML merge strategy:

```
values.yaml                  # Defaults (committed)
  + .values.override.yaml    # Local overrides (gitignored)
    + configs/<scenario>.yaml  # Scenario-specific settings
      + CLI --values           # Ad-hoc overrides via tilt up -- --values foo.yaml
```

Each layer is deep-merged on top of the previous one; later values win.

#### values.yaml (defaults)

```yaml
tilt:
  scenario: tpcb-default       # Which config from configs/ to load
  monitoring:
    enabled: false              # Enable Grafana kubernetes-monitoring

cnpg:
  instances: 1                  # Primary instances
  replicas: 0                   # Read replicas
  storage:
    size: 2Gi
  postgresql:
    parameters:
      shared_buffers: "256MB"

k6:
  benchmark:
    type: tpcb                  # Benchmark type (see table above)
    scale: 50                   # Scale factor
    vus: 5                      # Virtual users
    duration: "600s"            # Test duration
    warmupDuration: "300s"
    readOnly: false             # Enable readonly replica routing
    connectionMode: separate    # separate or pooler
    metricsLevel: standard      # minimal, standard, or comprehensive
  connection:
    port: 5432
    user: app
    database: app

monitoring: {}                  # Grafana k8s-monitoring values (see below)
```

#### .values.override.yaml (local overrides)

Create this file to customize your local environment. It is gitignored.

```yaml
tilt:
  monitoring:
    enabled: true

# Direct k6 → Grafana Cloud Prometheus remote write
k6:
  prometheus:
    enabled: true
    remoteWriteUrl: "https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push"
    username: "YOUR_PROMETHEUS_USERNAME"
    password: "YOUR_GRAFANA_CLOUD_API_KEY"

# Grafana kubernetes-monitoring (Alloy) — cluster metrics, logs, events
monitoring:
  k8sMonitoring:
    cluster:
      name: your-cluster-name
    destinations:
      - name: grafana-cloud-metrics
        type: prometheus
        url: https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push
        auth:
          type: basic
          username: "YOUR_PROMETHEUS_USERNAME"
          password: "YOUR_GRAFANA_CLOUD_API_KEY"
      - name: grafana-cloud-logs
        type: loki
        url: https://logs-prod-XXX.grafana.net/loki/api/v1/push
        auth:
          type: basic
          username: "YOUR_LOKI_USERNAME"
          password: "YOUR_GRAFANA_CLOUD_API_KEY"
```

### Scenario Configs

Predefined scenarios live in `examples/cnpg/configs/`. Each is a partial YAML overlay that gets merged into the base config.

#### tpcb-default.yaml

```yaml
# TPC-B default — pgbench equivalent, 16 VUs, scale 50, 10m duration
k6:
  benchmark:
    type: tpcb
    scale: 50
    vus: 16
    duration: "600s"
    metricsLevel: standard
```

#### tpcc-default.yaml

```yaml
# TPC-C default — 10 warehouses, 20 VUs, full transaction mix, 10m duration
k6:
  benchmark:
    type: tpcc
    scale: 10
    warehouses: "10"
    vus: 20
    duration: "600s"
    metricsLevel: standard
```

#### tpcc-readonly.yaml

```yaml
# TPC-C readonly — 2 replicas, read txns routed to replicas, 10m duration
cnpg:
  replicas: 2

k6:
  benchmark:
    type: tpcc-readonly
    scale: 10
    warehouses: "10"
    vus: 20
    duration: "600s"
    readOnly: true
    connectionMode: separate
    metricsLevel: standard
```

#### tpcb-readonly.yaml

```yaml
# TPC-B readonly — 2 replicas, constant read/write split, 10m duration
cnpg:
  replicas: 2

k6:
  benchmark:
    type: tpcb-readonly
    scale: 50
    readOnly: true
    connectionMode: separate
    metricsLevel: standard
    writeVus: 5
    readVus: 10
    duration: "600s"
```

#### scale-test-baseline.yaml / scale-test-replicas.yaml

See [Horizontal Scaling Test](#horizontal-scaling-test) below for detailed usage.

#### Creating Custom Scenarios

Create a new file in `configs/`:

```yaml
# configs/my-heavy-load.yaml
# Heavy TPC-B — 100 VUs, scale 200, comprehensive metrics
cnpg:
  instances: 1
  replicas: 0
  storage:
    size: 10Gi
  postgresql:
    parameters:
      shared_buffers: "1GB"
      max_connections: "400"

k6:
  benchmark:
    type: tpcb
    scale: 200
    vus: 100
    duration: "1800s"
    metricsLevel: comprehensive
```

Then run it:

```bash
# Via Tilt scenario selection
make benchmark SCENARIO=my-heavy-load

# Or set in .values.override.yaml
tilt:
  scenario: my-heavy-load
```

### Read Replica Testing

Three benchmark types support routing read queries to replicas:

| Type | How reads are routed |
|------|---------------------|
| `tpcb-readonly` | Two parallel k6 scenarios: constant write VUs on primary, constant read VUs on readonly |
| `tpcc-readonly` | Single scenario, per-transaction routing: Order-Status (4%) and Stock-Level (4%) go to readonly, all others to primary |
| `tpcb-scale-test` | Two parallel scenarios: constant write VUs on primary, **ramping** read VUs on readonly (for horizontal scaling tests) |

#### Connection Modes

- **`separate`** (default) — distinct TCP connections to the `-rw` and `-ro` services. CNPG's `-ro` service load-balances across all replicas.
- **`pooler`** — single connection through PgBouncer, with `SET default_transaction_read_only = on` for read routing. Requires PgBouncer in session pooling mode.

#### How routing works

The `db.js` connection manager maintains separate connection handles:

```
openPrimary()  → K6_PG_HOST (cluster-rw service)
openReadonly() → K6_PG_READONLY_HOST (cluster-ro service)
                 Falls back to primary if K6_PG_READONLY_HOST is not set
```

Setting `readOnly: true` in the benchmark config causes the Helm template to populate `K6_PG_READONLY_HOST` from the CNPG `-ro` service name. When `readOnly: false`, the env var is omitted and all reads fall back to the primary — this is how the baseline comparison works.

#### Basic readonly setup

```yaml
# configs/tpcb-readonly.yaml
cnpg:
  replicas: 2

k6:
  benchmark:
    type: tpcb-readonly    # or tpcc-readonly
    readOnly: true
    connectionMode: separate
    writeVus: 5
    readVus: 10
```

Run with:

```bash
make benchmark SCENARIO=tpcb-readonly
```

#### Metrics by target

All readonly benchmark types tag metrics with `target: primary` or `target: readonly`. In Grafana, use the `target` label to split latency and TPS:

```promql
# Read TPS on replicas
rate(k6_iterations_total{target="readonly"}[$__rate_interval])

# Write latency on primary (p95)
histogram_quantile(0.95, sum(rate(k6_pgbench_latency_seconds{target="primary"}[$__rate_interval])))
```

### Horizontal Scaling Test

The `tpcb-scale-test` benchmark is designed to force horizontal scaling of read replicas in a reproducible way, enabling direct comparison between primary-only and replica-backed configurations.

#### How it works

The test runs two parallel k6 scenarios:

| Scenario | Executor | Target | Purpose |
|----------|----------|--------|---------|
| `write_workload` | `constant-vus` | primary | Steady write baseline (unchanged throughout) |
| `read_workload` | `ramping-vus` | readonly | Increasing read pressure to trigger autoscaling |

The read workload progresses through five phases:

```
Read VUs
  ^
  │                    ┌──────────────┐
  │                   /│   3. Peak    │\
  │                  / │  (10 min)    │ \
  │                 /  │              │  \
  │   ┌──────────┐/   │              │   \┌──────────┐
  │   │1. Warmup │    │              │    │5. Cool   │
  │   │  (2 min) │    │              │    │  (2 min) │
  ──┴──┴─────────┴────┴──────────────┴────┴──────────┴──→ Time
       2. Ramp Up        4. Ramp Down
        (5 min)           (5 min)
```

1. **Warmup** (2m) — hold at `readVusStart` VUs to establish baseline metrics
2. **Ramp-up** (5m) — linearly increase read VUs to `readVusPeak`, creating CPU/connection pressure that triggers HPA
3. **Peak** (10m) — sustained high load, long enough for autoscaler to react, add replicas, and stabilize
4. **Ramp-down** (5m) — linearly decrease read VUs, testing scale-in behavior
5. **Cool-down** (2m) — hold at start VUs to measure return to baseline

Write VUs remain constant throughout all phases, providing a stable control metric.

#### Running a comparison

The comparison requires two test runs with identical parameters — only the presence of replicas differs.

**Step 1: Run the baseline (primary only)**

```bash
make benchmark SCENARIO=scale-test-baseline
```

This uses `scale-test-baseline.yaml`:

```yaml
cnpg:
  instances: 1
  replicas: 0          # no replicas

k6:
  benchmark:
    type: tpcb-scale-test
    readOnly: false     # reads fall back to primary
    writeVus: 5
    scaleTest:
      readVusStart: 5
      readVusPeak: 50
      warmup: "2m"
      rampUp: "5m"
      peak: "10m"
      rampDown: "5m"
      coolDown: "2m"
    duration: "24m"
```

All 50 read VUs at peak compete with the 5 write VUs on the same primary instance. Record the `testid` from the k6 output.

**Step 2: Run the replica variant**

```bash
make benchmark SCENARIO=scale-test-replicas
```

This uses `scale-test-replicas.yaml`:

```yaml
cnpg:
  instances: 1
  replicas: 2            # read replicas provisioned

k6:
  benchmark:
    type: tpcb-scale-test
    readOnly: true        # reads go to -ro service
    metricsLevel: comprehensive   # includes replication lag
    writeVus: 5
    scaleTest:
      readVusStart: 5
      readVusPeak: 50
      warmup: "2m"
      rampUp: "5m"
      peak: "10m"
      rampDown: "5m"
      coolDown: "2m"
    duration: "24m"
```

Read VUs are now load-balanced across replicas via the `-ro` service, leaving the primary free for writes.

**Step 3: Compare in Grafana**

Use the `testid` template variable to overlay both runs. Key things to look for:

| Metric | Baseline (primary-only) | With replicas |
|--------|------------------------|---------------|
| Read p95 latency | Degrades during ramp-up as primary saturates | Stays flat — replicas absorb read load |
| Write p95 latency | Degrades — reads compete for resources | Stable — primary handles only writes |
| Read TPS | Hits ceiling at primary capacity | Scales with replica count |
| Replication lag | N/A | Shows replica health under load (comprehensive tier) |

#### Tuning for your autoscaler

The default parameters (5 → 50 VUs over 5 minutes) are starting points. Adjust based on your HPA/autoscaler configuration:

| Parameter | Config Key | Default | Tuning guidance |
|-----------|-----------|---------|----------------|
| Starting read VUs | `scaleTest.readVusStart` | `5` | Should be comfortably below a single replica's capacity |
| Peak read VUs | `scaleTest.readVusPeak` | `50` | Must exceed single-replica capacity to trigger scaling |
| Ramp-up duration | `scaleTest.rampUp` | `5m` | Must be long enough for your HPA to detect the load increase |
| Peak duration | `scaleTest.peak` | `10m` | Must exceed HPA scale-up cooldown + pod startup time |
| Ramp-down duration | `scaleTest.rampDown` | `5m` | Should be long enough to observe scale-in decisions |
| Write VUs | `benchmark.writeVus` | `5` | Keep constant between baseline and replica runs |

For CNPG with HPA, ensure the `peak` duration exceeds your `scaleUpStabilizationWindowSeconds` plus the time for a new replica pod to become `Ready` and join the `-ro` service endpoint.

#### Scale test environment variables

These env vars are set by the Helm chart from `scaleTest` config values, or can be set directly when running k6 outside of Helm:

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_WRITE_VUS` | `5` | Constant write VU count |
| `K6_READ_VUS_START` | `5` | Read VUs at start of test |
| `K6_READ_VUS_PEAK` | `50` | Read VUs at peak |
| `K6_SCALE_WARMUP` | `2m` | Warmup phase duration |
| `K6_SCALE_RAMP_UP` | `5m` | Ramp-up phase duration |
| `K6_SCALE_PEAK` | `10m` | Peak phase duration |
| `K6_SCALE_RAMP_DOWN` | `5m` | Ramp-down phase duration |
| `K6_SCALE_COOL_DOWN` | `2m` | Cool-down phase duration |
| `K6_DURATION` | `24m` | Total write workload duration (should match sum of phases) |

### Monitoring & Grafana

There are two independent monitoring paths:

1. **k6 Prometheus remote write** — k6 pushes benchmark metrics directly to a Prometheus endpoint (e.g., Grafana Cloud). Configure under `k6.prometheus` in your override file.

2. **Grafana kubernetes-monitoring** — deploys Alloy agents that scrape cluster metrics, pod logs, and events, sending them to Grafana Cloud. Configure under `monitoring.k8sMonitoring` and enable with `tilt.monitoring.enabled: true`.

Both are optional and independent. You can use one, both, or neither.

#### Grafana Dashboard

Import `dashboards/k6-pgbench.json` into Grafana:

**Grafana UI** > **Dashboards** > **Import** > **Upload JSON file** > select the file > choose your Prometheus datasource.

The dashboard includes:

- **Overview** — VUs, TPS, iterations, success rate, errors, avg latency
- **Throughput** — TPS over time, read/write/success rate split
- **Latency** — p50/p95/p99 percentiles, error rate
- **Transaction Breakdown** — per-type latency for TPC-B and TPC-C transactions
- **Statement-Level Performance** (collapsed) — per-SQL-statement p95 latency
- **Database Health** (collapsed) — replication lag, waiting locks, active connections
- **k6 Engine** — VU ramp, iteration rate, iteration duration

A `testid` template variable lets you filter between test runs.

> **Note:** k6's Prometheus remote write prefixes all metrics with `k6_` and applies naming transforms (e.g., `pgbench_latency` becomes `k6_pgbench_latency_seconds`). The dashboard queries use these transformed names. The standard k6 dashboard (18030) will not work — it expects HTTP metrics.

### Tilt Workflow

The Tiltfile orchestrates deployment in phases with dependency ordering:

```
create-namespace
    └─→ cnpg-operator
            └─→ cnpg-cluster
                    └─→ wait-for-cluster
                            └─→ docker_build (k6-pgbench image)
                                    └─→ k6-init (schema + data load)
                                            └─→ k6-benchmark (run test)
```

If monitoring is enabled, `grafana-k8s-monitoring` deploys in parallel after namespace creation.

Tilt watches `values.yaml`, `.values.override.yaml`, and the active scenario config for live reloads. Changes to `scripts/` or the `Dockerfile` trigger an image rebuild and job re-run.

### Helm Charts

The example uses three local Helm charts under `examples/cnpg/charts/`:

| Chart | Description |
|-------|-------------|
| `cnpg/` | CNPG `Cluster` CR with configurable instances, storage, and PostgreSQL parameters |
| `k6/` | Two Kubernetes Jobs — `k6-init` (schema/data) and `k6-benchmark` (test run) |
| `monitoring/` | Wrapper around `grafana/k8s-monitoring` chart (Alloy-based telemetry) |

### Troubleshooting

**Tilt keeps reloading in a loop**
The `tmp/` directory is ignored via `watch_settings(ignore=['tmp'])`. If you see reloads, check that nothing else is writing inside the watched context.

**CNPG operator install times out**
The default Tilt timeout is extended to 300s. If it still times out, check pod logs: `kubectl -n cnpg-system logs -l app.kubernetes.io/name=cloudnative-pg`

**k6 init job fails with connection refused**
The init job has a `wait-for-postgres` init container that polls the CNPG `-rw` service. If the cluster is slow to start, the job will retry (backoffLimit: 3).

**Alloy pods in CreateContainerConfigError**
The kubernetes-monitoring chart creates secrets from the `destinations` and `remoteConfig` auth credentials. If secrets are missing, verify your `.values.override.yaml` has the full `monitoring.k8sMonitoring` section with `destinations` and the `alloy-*` `remoteConfig` blocks.

**No data in Grafana dashboard**
Verify k6 is running with `--out experimental-prometheus-rw` by checking the benchmark pod logs. Confirm `k6.prometheus.enabled: true` and that `remoteWriteUrl`, `username`, and `password` are set in your override file.

## TPC-C Compliance Options

All TPC-C specification requirements are implemented and individually configurable:

| Option | Config Key | Default | Description |
|--------|-----------|---------|-------------|
| **NURand distribution** | `tpcc.nurand` | `true` | Uses NURand(A, x, y) for customer ID (A=1023), item ID (A=8191), and customer last name (A=255) selection, with proper C_LOAD/C_RUN constraints. When disabled, falls back to uniform random. |
| **Deferred delivery** | `tpcc.deferredDelivery` | `false` | Runs delivery transactions in a separate k6 VU group (clause 2.7.4) rather than inline in the terminal mix. Delivery gets `ceil(vus * 0.04)` dedicated VUs. |
| **Think time** | `tpcc.thinkTime` | `false` | Applies spec-defined keying time before each transaction and negative-exponential think time after (clause 5.2.5). Keying: 18s New-Order, 3s Payment, 2s others. Think: 12s New-Order/Payment, 10s Order-Status, 5s Delivery/Stock-Level. |

Configure via `.values.override.yaml`:

```yaml
k6:
  benchmark:
    type: tpcc
    tpcc:
      nurand: true             # On by default
      deferredDelivery: true    # Enable for full compliance
      thinkTime: true           # Enable for full compliance
```

Or via environment variables: `K6_TPCC_NURAND`, `K6_TPCC_DEFERRED_DELIVERY`, `K6_TPCC_THINK_TIME` (all `true`/`false`).

The pgbench (TPC-B) implementation is an exact match to native `pgbench` — schema, data generation, random distributions, and all transaction variants.

## License

See [LICENSE](LICENSE).
