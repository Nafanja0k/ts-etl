# Nobl9-Inspired Stateless Telemetry ETL & Backfill Engine

An enterprise-grade, stateless, pull-based Telemetry ETL & Backfill Engine designed for serverless containers (Kubernetes CronJobs, AWS ECS Fargate, GCP Cloud Run). Inspired by the **Nobl9 Agent pull architecture**, this engine executes scheduled ephemeral runs without requiring persistent database infrastructure. It uses **Amazon S3 / Google Cloud Storage** for distributed lease locking, monotonic low-watermark state tracking, and dead-letter quarantine.

---

## 🌟 Key Architecture Principles

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    EPHEMERAL RUNNER CONTAINER                                    │
│                                                                                                  │
│  1. S3 Atomic Lease      2. Ingest Integrity       3. Push-Down Extract    4. Governance & Write │
│  ┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐    ┌───────────────────┐ │
│  │ Acquire S3 Lock │ ──► │ t_safe = t_now    │ ──► │ Query Source     │ ──►│ In-Memory Trim &  │ │
│  │ (IfNoneMatch:*) │     │  - query_delay    │     │ Downsample at Src│    │ Unit Normalization│ │
│  └─────────────────┘     └───────────────────┘     └──────────────────┘    └─────────┬─────────┘ │
│                                                                                      │           │
│  5. Commit Watermark     6. Dead-Letter Quarantine  7. Prometheus Remote-Write       ▼           │
│  ┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐    ┌───────────────────┐ │
│  │ S3 Watermark    │ ◄── │ S3 Quarantine     │ ◄── │ VictoriaMetrics /│ ◄──│ Protobuf + Snappy │ │
│  │ (monotonic inc) │     │ (non-compliant)   │     │ Mimir / Thanos   │    │ Wire Format       │ │
│  └─────────────────┘     └───────────────────┘     └──────────────────┘    └───────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Zero Database Dependency**: All distributed coordination, concurrency control, and stream watermarks live in standard S3 object storage.
2. **Deterministic Anti-Overlap Intervals**: Time slices are strictly computed as half-open intervals `[t_start, t_end)` matching low-watermarks to safe horizons.
3. **Ingestion Delay Buffer ($t_{\text{safe}} = t_{\text{now}} - \text{query\_delay}$)**: Protects against late-arriving metrics and ingestion jitter in upstream SaaS TSDBs.
4. **Push-Down Downsampling**: Extracts aggregate metrics directly using native TSDB primitives (Prometheus step resolution, Splunk rollup datapoints, Graphite summarize).
5. **Cardinality Governance**: Drops ephemeral tags (`pod_uuid`, `container_id`, `client_ip`, `trace_id`) in-memory to prevent TSDB index explosion.
6. **Standard Prometheus Remote-Write**: Direct Snappy-compressed Protobuf serialization targeting VictoriaMetrics, Grafana Mimir, or Thanos.

---

## 📁 Repository Structure

```
├── Dockerfile                  # Production multi-stage OCI container image
├── docker-compose.yml          # Local full-stack environment with VictoriaMetrics
├── main.py                     # Python CLI runner entry point
├── requirements.txt            # Python dependencies (snappy, protobuf, boto3, requests)
├── engine/                     # Core Python ETL engine
│   ├── orchestrator.py         # Ephemeral cycle runner & catch-up loop
│   ├── lock.py                 # S3 distributed lease lock with atomic conditional puts
│   ├── watermark.py            # Monotonic watermark persistence & gap detection
│   ├── transformer.py          # In-memory cardinality governor & unit converter
│   ├── remote_write.py         # Prometheus Remote-Write Protobuf + Snappy encoder
│   ├── config.py               # YAML spec parsers and data classes
│   └── extractors/             # Source TSDB clients (Prometheus, Splunk, Graphite)
├── specs/                      # Declarative pipeline definitions
│   ├── pipeline_registry.yaml  # Job registry, cadence, query delay, and batch intervals
│   ├── target_metrics_schema.yaml # Standard target metric definitions & required tags
│   └── mappings/               # Source-to-target label & unit mappings
├── k8s/                        # Kubernetes manifests
│   └── cronjob.yaml            # Production CronJob specification
├── tests/                      # Python automated test suite
│   └── test_etl.py             # Unit & integration test cases
└── app/ & components/          # Next.js 15+ Interactive Operations Web UI
```

---

## 🚀 Quickstart & Local Development

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm** (for the operations web UI)
- **libsnappy-dev** (required by `python-snappy`)
  - Ubuntu/Debian: `sudo apt-get install libsnappy-dev`
  - macOS: `brew install snappy`

### 2. Python Environment Setup
```bash
# Clone the repository
git clone <repo-url>
cd telemetry-etl-engine

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Run the test suite
python3 tests/test_etl.py
```

### 3. Running the Engine via CLI
```bash
# 1. Dry run without modifying S3 state
python3 main.py --dry-run

# 2. Run a specific pipeline job
python3 main.py --job http_service_slo_telemetry

# 3. Trigger a historical backfill starting from a timestamp
python3 main.py --job http_service_slo_telemetry --backfill-start 2026-08-01T00:00:00Z --s3-bucket my-o11y-bucket
```

### 4. Running the Web Operations UI
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access the interactive dashboard, pipeline simulator, gap backfill tester, S3 inspector, and spec editor.

---

## 🛠️ Build Instructions

### Building the OCI Container Image
```bash
# Build production image
docker build -t telemetry-etl:v1.0.0 .

# Multi-platform build for AMD64 / ARM64
docker buildx build --platform linux/amd64,linux/arm64 -t telemetry-etl:v1.0.0 --push .
```

### Building the Next.js Operations UI
```bash
npm run build
```

---

## 🚢 Deployment Instructions

### Option 1: Kubernetes CronJob (Recommended)

Deploy the engine as a scheduled CronJob running every 5 minutes in your observability namespace.

1. **Configure IAM / S3 Access**: Attach an IAM Role to your Kubernetes ServiceAccount with `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` permissions on your state bucket.
2. **Apply Secrets & Manifest**:
```bash
# Create secret for TSDB credentials
kubectl create secret generic o11y-secrets \
  --namespace observability \
  --from-literal=splunk-token="YOUR_SPLUNK_API_TOKEN"

# Deploy the CronJob
kubectl apply -f k8s/cronjob.yaml -n observability
```

3. **Verify Execution**:
```bash
# List CronJobs
kubectl get cronjob -n observability

# Inspect recent Pod executions
kubectl get pods -n observability -l job-name
kubectl logs -n observability -l job-name --tail=100
```

---

### Option 2: AWS ECS Fargate with EventBridge Cron

1. Push your container image to **Amazon ECR**.
2. Create an **ECS Task Definition** using the Fargate launch type with an attached `TaskExecutionRole` granting S3 access.
3. Configure an **Amazon EventBridge Rule** with a cron schedule (e.g., `rate(5 minutes)`) targeting your ECS Task Definition.

---

### Option 3: GCP Cloud Run Jobs with Cloud Scheduler

1. Build and push image to **Google Artifact Registry**:
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/telemetry-etl:v1.0.0
```
2. Create the **Cloud Run Job**:
```bash
gcloud run jobs create telemetry-etl-job \
  --image gcr.io/YOUR_PROJECT_ID/telemetry-etl:v1.0.0 \
  --region us-central1 \
  --set-env-vars S3_BUCKET_NAME=corp-telemetry-state,TARGET_TSDB_URL=https://victoriametrics.corp/api/v1/write
```
3. Schedule periodic execution with **Cloud Scheduler**:
```bash
gcloud scheduler jobs create http telemetry-etl-cron \
  --location us-central1 \
  --schedule "*/5 * * * *" \
  --uri "https://us-central1-run.googleapis.com/v1/namespaces/YOUR_PROJECT_ID/jobs/telemetry-etl-job:run" \
  --http-method POST \
  --oauth-service-account-email "telemetry-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

---

### Option 4: Local Full-Stack with Docker Compose

Run an end-to-end local test environment with embedded **VictoriaMetrics**:

```bash
docker-compose up --build
```
- VictoriaMetrics UI & API: `http://localhost:8428`
- Metrics query endpoint: `http://localhost:8428/api/v1/export`

---

## ⚙️ Configuration Reference

### 1. Pipeline Registry (`specs/pipeline_registry.yaml`)
Configures source TSDB endpoints, extraction query templates, execution cadence, and Nobl9 safety parameters:

```yaml
version: "v1"
jobs:
  - job_id: "http_service_slo_telemetry"
    enabled: true
    source_type: "prometheus"
    source_endpoint_env: "PROMETHEUS_ENDPOINT"
    query_template: "sum by (service, status_code) (rate(http_requests_total[2m]))"
    query_delay_seconds: 120    # Nobl9 ingestion safety buffer (t_safe = t_now - 120s)
    cadence_seconds: 300        # 5-minute periodic window
    batch_slice_seconds: 3600   # Max slice size per batch (1 hour)
    mapping_spec: "specs/mappings/http_slo_mapping.yaml"
    target_metric: "service:slo:request_rate"
```

### 2. Target Schema (`specs/target_metrics_schema.yaml`)
Defines canonical enterprise metric naming, required dimensions, and valid units:

```yaml
version: "v1"
target_standards:
  "service:slo:request_rate":
    description: "Normalized request throughput for SLO budget calculation"
    unit: "rps"
    required_dimensions:
      - "service"
      - "environment"
      - "status_class"
```

### 3. Mapping Rules (`specs/mappings/*.yaml`)
Maps heterogeneous source fields, drops volatile labels, and converts units:

```yaml
version: "v1"
job_id: "http_service_slo_telemetry"
target_metric: "service:slo:request_rate"
dimension_mappings:
  service: "service"
  status_code: "status_class"
static_dimensions:
  cluster: "prod-us-east-1"
  environment: "production"
drop_tags:
  - "pod_uuid"
  - "container_id"
  - "client_ip"
  - "trace_id"
unit_conversion:
  operation: "none"
```

---

## 🛡️ S3 State Layout

The engine organizes its persistent S3 namespace as follows:

```
s3://<S3_BUCKET_NAME>/
├── locks/
│   └── orchestrator.lock         # Ephemeral lease with runner ID, epoch TTL, and ETag
├── watermarks/
│   └── <job_id>.json             # Low-watermark cursor, last processed timestamp, series count
├── checkpoints/
│   └── <job_id>/
│       └── <slice_end>.done      # Zero-byte idempotency checkpoints
└── deadletter/
    └── <job_id>/
        └── <timestamp>_quarantine.json # Schema-rejected series with missing dimensions
```

---

## 🧪 Automated Testing

Run the test suite to validate lock acquisition, TTL expirations, push-down downsampling, cardinality pruning, and dead-letter handling:

```bash
python3 tests/test_etl.py
```

Expected output:
```
Running Telemetry ETL Test Suite...
✓ test_specs_loading passed
✓ test_s3_distributed_lock passed
✓ test_metric_transformation_and_cardinality_trimming passed
✓ test_unit_conversion_percentage_to_ratio passed
✓ test_dead_letter_quarantine_on_missing_dimensions passed
✓ test_orchestrator_catch_up_loop passed
ALL 6 TEST CASES PASSED SUCCESSFULLY!
```

---

## 📄 License
Apache-2.0. Open-source telemetry pipeline architecture.
