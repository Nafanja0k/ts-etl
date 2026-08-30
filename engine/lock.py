"""
Distributed S3 Leader Lease Manager.
Uses atomic S3 conditional operations (IfNoneMatch: * / If-Match ETag) with TTL to prevent split-brain execution.
"""
import json
import time
import uuid
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("telemetry_etl.lock")


class S3DistributedLock:
    def __init__(
        self,
        bucket: str,
        lock_key: str = "locks/orchestrator.lock",
        ttl_seconds: int = 300,
        s3_client: Optional[Any] = None,
        mock_storage: Optional[Dict[str, Any]] = None,
    ):
        self.bucket = bucket
        self.lock_key = lock_key
        self.ttl_seconds = ttl_seconds
        self.s3_client = s3_client
        self.mock_storage = mock_storage if mock_storage is not None else {}
        self.instance_id = f"runner-{uuid.uuid4().hex[:8]}"
        self.is_held = False
        self._current_etag: Optional[str] = None

    def acquire(self) -> bool:
        """
        Attempt to acquire the distributed lease.
        Returns True if acquired, False if another active worker holds the lock.
        """
        now = int(time.time())
        lease_payload = {
            "instance_id": self.instance_id,
            "acquired_at": now,
            "expires_at": now + self.ttl_seconds,
            "ttl_seconds": self.ttl_seconds,
        }
        body_bytes = json.dumps(lease_payload, indent=2).encode("utf-8")

        # 1. AWS S3 via boto3
        if self.s3_client:
            try:
                # Check existing lock to verify expiration
                try:
                    existing = self.s3_client.get_object(Bucket=self.bucket, Key=self.lock_key)
                    existing_data = json.loads(existing["Body"].read().decode("utf-8"))
                    existing_etag = existing.get("ETag")

                    if existing_data.get("expires_at", 0) > now:
                        if existing_data.get("instance_id") != self.instance_id:
                            logger.warning(
                                f"Lock held by active instance {existing_data.get('instance_id')}, "
                                f"expires in {existing_data.get('expires_at') - now}s"
                            )
                            return False
                        # Re-acquiring own lock (renew)
                    
                    # Lock expired or is ours: conditional put using IfMatch ETag
                    resp = self.s3_client.put_object(
                        Bucket=self.bucket,
                        Key=self.lock_key,
                        Body=body_bytes,
                        ContentType="application/json",
                        IfMatch=existing_etag,
                    )
                    self._current_etag = resp.get("ETag")
                    self.is_held = True
                    logger.info(f"Acquired S3 lease (renewed) for {self.instance_id}")
                    return True

                except self.s3_client.exceptions.NoSuchKey:
                    # Lock does not exist: conditional atomic put with IfNoneMatch: *
                    resp = self.s3_client.put_object(
                        Bucket=self.bucket,
                        Key=self.lock_key,
                        Body=body_bytes,
                        ContentType="application/json",
                        IfNoneMatch="*",
                    )
                    self._current_etag = resp.get("ETag")
                    self.is_held = True
                    logger.info(f"Acquired new S3 lease for {self.instance_id}")
                    return True

            except Exception as e:
                logger.error(f"Failed conditional S3 lock acquisition: {e}")
                return False

        # 2. Local / Mock storage implementation for container/simulation run
        else:
            existing = self.mock_storage.get(f"{self.bucket}/{self.lock_key}")
            if existing:
                existing_data = json.loads(existing["body"].decode("utf-8"))
                if existing_data.get("expires_at", 0) > now:
                    if existing_data.get("instance_id") != self.instance_id:
                        logger.warning(
                            f"[Mock S3] Lock held by {existing_data.get('instance_id')}, "
                            f"expires in {existing_data.get('expires_at') - now}s"
                        )
                        return False
            
            # Write new lock
            self.mock_storage[f"{self.bucket}/{self.lock_key}"] = {
                "body": body_bytes,
                "etag": f'"{uuid.uuid4().hex[:12]}"',
                "last_modified": now,
            }
            self.is_held = True
            logger.info(f"[Mock S3] Acquired S3 lease for {self.instance_id}")
            return True

    def release(self) -> bool:
        """
        Release the distributed lease if held by this instance.
        """
        if not self.is_held:
            return True

        if self.s3_client:
            try:
                self.s3_client.delete_object(Bucket=self.bucket, Key=self.lock_key)
                self.is_held = False
                logger.info(f"Released S3 lease for {self.instance_id}")
                return True
            except Exception as e:
                logger.error(f"Error releasing S3 lock: {e}")
                return False
        else:
            self.mock_storage.pop(f"{self.bucket}/{self.lock_key}", None)
            self.is_held = False
            logger.info(f"[Mock S3] Released S3 lease for {self.instance_id}")
            return True

    def __enter__(self):
        acquired = self.acquire()
        if not acquired:
            raise RuntimeError("Could not acquire S3 distributed lease. Another runner is active.")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()
