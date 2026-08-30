# Multi-stage minimal container build for Nobl9-inspired Telemetry ETL Engine
FROM python:3.11-slim as builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libsnappy-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final runtime image
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsnappy1v5 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1

COPY proto/ ./proto/
COPY specs/ ./specs/
COPY engine/ ./engine/
COPY main.py .

# Supports dynamic job execution or specific job ID via args
ENTRYPOINT ["python", "main.py"]
CMD []
