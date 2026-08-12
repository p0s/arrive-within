#!/usr/bin/env python3
"""Minimal, app-isolated receiver for explicit Arrive Within feedback reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


APP_NAME = "Arrive Within"
CATEGORY = "product-feedback"
REPORT_PATH = "/v1/reports"
LOOPBACK_BIND = "127.0.0.1"
MAX_BODY_BYTES = 32 * 1024
MAX_MESSAGE_LENGTH = 4_000
MAX_EMAIL_LENGTH = 254
MAX_CONTEXT_LENGTH = 128
MAX_RETENTION_DAYS = 30
MAX_STORAGE_BYTES = 64 * 1024 * 1024
MAX_REPORTS_PER_WINDOW = 30
RATE_WINDOW_SECONDS = 600.0
RETENTION_SWEEP_SECONDS = 60.0
REPORT_KEYS = {"reportId", "app", "category", "message", "replyEmail", "appContext"}
REQUIRED_REPORT_KEYS = {"reportId", "app", "category", "message"}
CONTEXT_KEYS = {"appVersion", "build", "operatingSystemVersion", "locale"}
EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)


class ReceiverError(Exception):
    def __init__(self, status: HTTPStatus, public_message: str) -> None:
        super().__init__(public_message)
        self.status = status
        self.public_message = public_message


@dataclass(frozen=True)
class ReceiverConfig:
    data_directory: Path
    retention_days: int = MAX_RETENTION_DAYS
    max_storage_bytes: int = MAX_STORAGE_BYTES
    max_reports_per_window: int = MAX_REPORTS_PER_WINDOW
    rate_window_seconds: float = RATE_WINDOW_SECONDS

    def __post_init__(self) -> None:
        if not self.data_directory.is_absolute():
            raise ValueError("data_directory must be an absolute private path")
        if not 1 <= self.retention_days <= MAX_RETENTION_DAYS:
            raise ValueError("retention_days must be between 1 and 30")
        if not 1 <= self.max_storage_bytes <= MAX_STORAGE_BYTES:
            raise ValueError("max_storage_bytes exceeds the bounded receiver limit")
        if not 1 <= self.max_reports_per_window <= MAX_REPORTS_PER_WINDOW:
            raise ValueError("max_reports_per_window exceeds the bounded receiver limit")
        if not RATE_WINDOW_SECONDS <= self.rate_window_seconds <= 86_400:
            raise ValueError("rate_window_seconds is outside the bounded receiver range")


class GlobalRateLimiter:
    """A process-wide limiter that records no address, device, or report identifier."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self._limit = limit
        self._window_seconds = window_seconds
        self._timestamps: deque[float] = deque()
        self._lock = threading.Lock()

    def admit(self, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        with self._lock:
            boundary = current - self._window_seconds
            while self._timestamps and self._timestamps[0] <= boundary:
                self._timestamps.popleft()
            if len(self._timestamps) >= self._limit:
                return False
            self._timestamps.append(current)
            return True


class FeedbackReceiver:
    def __init__(self, config: ReceiverConfig) -> None:
        self.config = config
        self._write_lock = threading.RLock()
        self._limiter = GlobalRateLimiter(
            config.max_reports_per_window,
            config.rate_window_seconds,
        )
        self._prepare_data_directory()
        self.purge_expired()

    def accept(
        self,
        payload: Any,
        *,
        idempotency_key: str,
        now: datetime | None = None,
        rate_limit: bool = True,
    ) -> dict[str, str]:
        if rate_limit and not self._limiter.admit():
            raise ReceiverError(HTTPStatus.TOO_MANY_REQUESTS, "Please wait before trying again.")
        normalized = normalize_report(payload)
        if idempotency_key != normalized["reportId"]:
            raise ReceiverError(HTTPStatus.BAD_REQUEST, "The report key does not match the report.")
        received_at = now or datetime.now(timezone.utc)
        if received_at.tzinfo is None:
            raise ValueError("now must include a timezone")
        canonical = canonical_json(normalized)
        payload_hash = hashlib.sha256(canonical).hexdigest()
        target = self.config.data_directory / f"{normalized['reportId']}.json"

        with self._write_lock:
            self._purge_expired(received_at)
            if target.exists():
                existing = self._read_record(target)
                if existing.get("payloadSha256") == payload_hash:
                    return {"reportId": normalized["reportId"], "status": "accepted"}
                raise ReceiverError(HTTPStatus.CONFLICT, "That report key already belongs to another report.")
            record = {
                "receivedAt": received_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "payload": normalized,
                "payloadSha256": payload_hash,
            }
            encoded = canonical_json(record)
            if self._stored_bytes() + len(encoded) > self.config.max_storage_bytes:
                raise ReceiverError(HTTPStatus.INSUFFICIENT_STORAGE, "Feedback storage is temporarily full.")
            self._atomic_write(target, encoded)
        return {"reportId": normalized["reportId"], "status": "accepted"}

    def digest(self) -> dict[str, Any]:
        self.purge_expired()
        daily: dict[str, dict[str, int]] = {}
        total = 0
        for path in self._record_paths():
            record = self._read_record(path)
            payload = record.get("payload")
            received_at = record.get("receivedAt")
            if not isinstance(payload, dict) or not isinstance(received_at, str):
                continue
            day = received_at[:10]
            bucket = daily.setdefault(day, {"reports": 0, "withReplyEmail": 0, "withAppContext": 0})
            bucket["reports"] += 1
            bucket["withReplyEmail"] += int("replyEmail" in payload)
            bucket["withAppContext"] += int("appContext" in payload)
            total += 1
        return {
            "schemaVersion": 1,
            "reports": total,
            "days": [{"date": day, **daily[day]} for day in sorted(daily)],
        }

    def purge_expired(self, now: datetime | None = None) -> None:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            raise ValueError("now must include a timezone")
        with self._write_lock:
            self._purge_expired(current)

    def _prepare_data_directory(self) -> None:
        directory = self.config.data_directory
        if directory.exists() and directory.is_symlink():
            raise ValueError("data_directory must not be a symbolic link")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
        mode = stat.S_IMODE(directory.stat().st_mode)
        if mode != 0o700:
            raise ValueError("data_directory must have mode 0700")

    def _record_paths(self) -> list[Path]:
        paths: list[Path] = []
        for path in self.config.data_directory.iterdir():
            if path.is_symlink():
                continue
            if path.is_file() and path.suffix == ".json":
                paths.append(path)
        return sorted(paths)

    def _read_record(self, path: Path) -> dict[str, Any]:
        if path.is_symlink() or not path.is_file():
            raise ReceiverError(HTTPStatus.INTERNAL_SERVER_ERROR, "Stored feedback is unavailable.")
        if path.stat().st_size > MAX_BODY_BYTES:
            raise ReceiverError(HTTPStatus.INTERNAL_SERVER_ERROR, "Stored feedback is unavailable.")
        try:
            value = strict_json_loads(path.read_bytes())
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise ReceiverError(HTTPStatus.INTERNAL_SERVER_ERROR, "Stored feedback is unavailable.") from error
        if not isinstance(value, dict):
            raise ReceiverError(HTTPStatus.INTERNAL_SERVER_ERROR, "Stored feedback is unavailable.")
        return value

    def _atomic_write(self, target: Path, data: bytes) -> None:
        temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600)
        try:
            with os.fdopen(descriptor, "wb", closefd=True) as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
            os.chmod(target, 0o600)
        finally:
            if temporary.exists():
                temporary.unlink()

    def _stored_bytes(self) -> int:
        return sum(path.stat().st_size for path in self._record_paths())

    def _purge_expired(self, now: datetime) -> None:
        boundary = now.astimezone(timezone.utc) - timedelta(days=self.config.retention_days)
        for path in self._record_paths():
            try:
                received = self._read_record(path).get("receivedAt")
                if not isinstance(received, str):
                    continue
                received_at = datetime.fromisoformat(received.replace("Z", "+00:00"))
                if received_at < boundary:
                    path.unlink()
            except (OSError, ValueError):
                continue


def strict_json_loads(data: bytes) -> Any:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    return json.loads(data.decode("utf-8"), object_pairs_hook=reject_duplicates)


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def normalize_report(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The report must be a JSON object.")
    keys = set(payload)
    if not REQUIRED_REPORT_KEYS.issubset(keys) or not keys.issubset(REPORT_KEYS):
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The report fields are not valid.")

    report_id = payload.get("reportId")
    try:
        parsed_id = uuid.UUID(report_id) if isinstance(report_id, str) else None
    except ValueError as error:
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The report ID is not valid.") from error
    if parsed_id is None or str(parsed_id) != report_id.lower():
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The report ID is not valid.")
    if payload.get("app") != APP_NAME or payload.get("category") != CATEGORY:
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The report target is not valid.")

    message = payload.get("message")
    if not isinstance(message, str) or message != message.strip() or not 1 <= len(message) <= MAX_MESSAGE_LENGTH:
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The feedback message is not valid.")
    if contains_disallowed_control(message):
        raise ReceiverError(HTTPStatus.BAD_REQUEST, "The feedback message contains unsupported characters.")

    normalized: dict[str, Any] = {
        "reportId": report_id.lower(),
        "app": APP_NAME,
        "category": CATEGORY,
        "message": message,
    }
    if "replyEmail" in payload:
        email = payload["replyEmail"]
        if (
            not isinstance(email, str)
            or email != email.strip()
            or not 1 <= len(email) <= MAX_EMAIL_LENGTH
            or EMAIL_RE.fullmatch(email) is None
        ):
            raise ReceiverError(HTTPStatus.BAD_REQUEST, "The reply email is not valid.")
        normalized["replyEmail"] = email
    if "appContext" in payload:
        context = payload["appContext"]
        if not isinstance(context, dict) or set(context) != CONTEXT_KEYS:
            raise ReceiverError(HTTPStatus.BAD_REQUEST, "The app context is not valid.")
        for key, value in context.items():
            if (
                not isinstance(value, str)
                or not 1 <= len(value) <= MAX_CONTEXT_LENGTH
                or contains_disallowed_control(value)
            ):
                raise ReceiverError(HTTPStatus.BAD_REQUEST, "The app context is not valid.")
        normalized["appContext"] = {key: context[key] for key in sorted(CONTEXT_KEYS)}
    return normalized


def contains_disallowed_control(value: str) -> bool:
    return any(ord(character) < 32 and character not in "\n\t" for character in value)


def make_handler(receiver: FeedbackReceiver) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "FeedbackReceiver/1"
        sys_version = ""

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(15)

        def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
            if self.path != REPORT_PATH:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            if self.headers.get_content_type() != "application/json":
                self._send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "JSON is required"})
                return
            if self.headers.get("Content-Encoding") not in (None, "identity"):
                self._send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "encoded bodies are not accepted"})
                return
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                length = -1
            if not 1 <= length <= MAX_BODY_BYTES:
                self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request size is invalid"})
                return
            body = self.rfile.read(length)
            try:
                payload = strict_json_loads(body)
                result = receiver.accept(
                    payload,
                    idempotency_key=self.headers.get("Idempotency-Key", ""),
                )
                self._send_json(HTTPStatus.ACCEPTED, result)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "request JSON is invalid"})
            except ReceiverError as error:
                self._send_json(error.status, {"error": error.public_message})

        def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

        def log_message(self, format: str, *args: object) -> None:
            return

        def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            body = canonical_json(payload)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Pragma", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def run_server(bind: str, port: int, receiver: FeedbackReceiver) -> None:
    if bind != LOOPBACK_BIND:
        raise ValueError("the receiver must bind to the exact IPv4 loopback address")
    server = ThreadingHTTPServer((bind, port), make_handler(receiver))
    server.daemon_threads = True
    stop_maintenance = threading.Event()

    def maintain_retention() -> None:
        while not stop_maintenance.wait(RETENTION_SWEEP_SECONDS):
            try:
                receiver.purge_expired()
            except Exception:
                server.shutdown()
                return

    maintenance = threading.Thread(
        target=maintain_retention,
        name="feedback-retention-maintenance",
        daemon=True,
    )
    maintenance.start()
    try:
        server.serve_forever()
    finally:
        stop_maintenance.set()
        server.server_close()
        maintenance.join(timeout=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    serve = subparsers.add_parser("serve", help="run the loopback HTTP receiver")
    serve.add_argument("--bind", default=LOOPBACK_BIND, choices=[LOOPBACK_BIND])
    serve.add_argument("--port", type=int, default=8789)
    serve.add_argument("--data-dir", type=Path, required=True)
    digest = subparsers.add_parser("digest", help="print content-free aggregate counts")
    digest.add_argument("--data-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    arguments = parse_args()
    receiver = FeedbackReceiver(ReceiverConfig(data_directory=arguments.data_dir))
    if arguments.command == "digest":
        print(json.dumps(receiver.digest(), ensure_ascii=False, sort_keys=True))
        return 0
    run_server(arguments.bind, arguments.port, receiver)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
