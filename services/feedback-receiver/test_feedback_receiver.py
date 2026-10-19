from __future__ import annotations

import http.client
import json
import os
import stat
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from feedback_receiver import (
    FeedbackReceiver,
    ReceiverConfig,
    ReceiverError,
    canonical_json,
    make_handler,
    normalize_report,
    run_server,
)
from http.server import ThreadingHTTPServer
from http import HTTPStatus


REPORT_ID = "11111111-2222-4333-8444-555555555555"


def payload(report_id: str = REPORT_ID, message: str = "A calm suggestion.") -> dict[str, object]:
    return {
        "reportId": report_id,
        "app": "Arrive Within",
        "category": "product-feedback",
        "message": message,
    }


class FeedbackReceiverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.data_directory = Path(self.temporary.name) / "reports"
        self.receiver = FeedbackReceiver(ReceiverConfig(data_directory=self.data_directory))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_strict_allowlist_rejects_unknown_and_missing_fields(self) -> None:
        unknown = payload()
        unknown["deviceId"] = "never-accepted"
        with self.assertRaises(ReceiverError) as unknown_error:
            normalize_report(unknown)
        self.assertEqual(unknown_error.exception.status, HTTPStatus.BAD_REQUEST)

        missing = payload()
        del missing["message"]
        with self.assertRaises(ReceiverError) as missing_error:
            normalize_report(missing)
        self.assertEqual(missing_error.exception.status, HTTPStatus.BAD_REQUEST)

    def test_optional_payload_is_bounded_and_preserves_only_four_context_fields(self) -> None:
        value = payload()
        value["replyEmail"] = "reply@example.org"
        value["appContext"] = {
            "appVersion": "1.0",
            "build": "1",
            "operatingSystemVersion": "26.6",
            "locale": "de_DE",
        }
        normalized = normalize_report(value)
        self.assertEqual(set(normalized), {"reportId", "app", "category", "message", "replyEmail", "appContext"})
        self.assertEqual(
            set(normalized["appContext"]),
            {"appVersion", "build", "operatingSystemVersion", "locale"},
        )

    def test_same_report_is_idempotent_and_changed_reuse_conflicts(self) -> None:
        now = datetime(2026, 8, 10, 12, tzinfo=timezone.utc)
        first = self.receiver.accept(payload(), idempotency_key=REPORT_ID, now=now, rate_limit=False)
        repeated = self.receiver.accept(payload(), idempotency_key=REPORT_ID, now=now, rate_limit=False)
        self.assertEqual(first, {"reportId": REPORT_ID, "status": "accepted"})
        self.assertEqual(repeated, first)
        self.assertEqual(len(list(self.data_directory.glob("*.json"))), 1)

        with self.assertRaises(ReceiverError) as context:
            self.receiver.accept(
                payload(message="Changed content."),
                idempotency_key=REPORT_ID,
                now=now,
                rate_limit=False,
            )
        self.assertEqual(context.exception.status, HTTPStatus.CONFLICT)

    def test_storage_contains_no_implicit_network_or_device_metadata(self) -> None:
        self.receiver.accept(payload(), idempotency_key=REPORT_ID, rate_limit=False)
        path = next(self.data_directory.glob("*.json"))
        stored = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.data_directory.stat().st_mode), 0o700)
        encoded = path.read_text(encoding="utf-8").lower()
        for forbidden in ["ipaddress", "user-agent", "deviceid", "userid", "cookie", "authorization"]:
            self.assertNotIn(forbidden, encoded)
        self.assertEqual(set(stored), {"receivedAt", "payload", "payloadSha256"})

    def test_digest_contains_counts_but_no_content_or_report_identifier(self) -> None:
        first = payload()
        first["replyEmail"] = "private@example.org"
        self.receiver.accept(
            first,
            idempotency_key=REPORT_ID,
            now=datetime(2026, 8, 10, 12, tzinfo=timezone.utc),
            rate_limit=False,
        )
        second_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        second = payload(second_id, "Another private message.")
        second["appContext"] = {
            "appVersion": "1.0",
            "build": "1",
            "operatingSystemVersion": "26.6",
            "locale": "en_US",
        }
        self.receiver.accept(
            second,
            idempotency_key=second_id,
            now=datetime(2026, 8, 10, 13, tzinfo=timezone.utc),
            rate_limit=False,
        )
        digest = self.receiver.digest()
        encoded = json.dumps(digest)
        self.assertEqual(digest["reports"], 2)
        self.assertEqual(digest["days"][0]["withReplyEmail"], 1)
        self.assertEqual(digest["days"][0]["withAppContext"], 1)
        self.assertNotIn("private@example.org", encoded)
        self.assertNotIn("Another private message", encoded)
        self.assertNotIn(REPORT_ID, encoded)

    def test_expired_records_are_removed_without_using_client_identifiers(self) -> None:
        old = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
        self.receiver.accept(payload(), idempotency_key=REPORT_ID, now=old, rate_limit=False)
        new_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        self.receiver.accept(
            payload(new_id),
            idempotency_key=new_id,
            now=old + timedelta(days=31),
            rate_limit=False,
        )
        names = {path.stem for path in self.data_directory.glob("*.json")}
        self.assertEqual(names, {new_id})

    def test_explicit_maintenance_removes_expired_records_without_new_intake(self) -> None:
        old = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
        self.receiver.accept(payload(), idempotency_key=REPORT_ID, now=old, rate_limit=False)
        self.receiver.purge_expired(now=old + timedelta(days=31))
        self.assertEqual(list(self.data_directory.glob("*.json")), [])

    def test_receiver_requires_absolute_private_storage_and_exact_loopback(self) -> None:
        with self.assertRaisesRegex(ValueError, "absolute private path"):
            ReceiverConfig(data_directory=Path("relative-reports"))
        with self.assertRaisesRegex(ValueError, "exact IPv4 loopback"):
            run_server("0.0.0.0", 0, self.receiver)

    def test_http_contract_is_no_store_and_never_echoes_report_content(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.receiver))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            body = canonical_json(payload())
            connection.request(
                "POST",
                "/v1/reports",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Idempotency-Key": REPORT_ID,
                },
            )
            response = connection.getresponse()
            response_body = response.read()
            self.assertEqual(response.status, HTTPStatus.ACCEPTED)
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")
            self.assertNotIn(b"A calm suggestion", response_body)
            self.assertEqual(
                json.loads(response_body),
                {"reportId": REPORT_ID, "status": "accepted"},
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
