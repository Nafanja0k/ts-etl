"""
Abstract Base Extractor with Half-Open [t_start, t_end) Interval Semantics.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger("telemetry_etl.extractor")


@dataclass
class RawSample:
    timestamp_ms: int
    value: float


@dataclass
class RawTimeSeries:
    metric_name: str
    tags: Dict[str, str]
    samples: List[RawSample] = field(default_factory=list)


class BaseExtractor(ABC):
    def __init__(self, job_config: Any, mapping_spec: Any):
        self.job_config = job_config
        self.mapping_spec = mapping_spec

    @abstractmethod
    def extract(self, start_ts: int, end_ts: int) -> List[RawTimeSeries]:
        """
        Extract metrics within the half-open interval [start_ts, end_ts).
        Must enforce push-down downsampling at the source.
        """
        pass

    @staticmethod
    def parse_resolution_to_seconds(res: str) -> int:
        res = res.strip().lower()
        if res.endswith("s"):
            return int(res[:-1])
        if res.endswith("m"):
            return int(res[:-1]) * 60
        if res.endswith("h"):
            return int(res[:-1]) * 3600
        if res.endswith("d"):
            return int(res[:-1]) * 86400
        return int(res)
