import socket
import threading
import unittest
from unittest import mock

from skyworth_provision import (
    DeviceSession,
    decode_message,
    encode_credentials,
    provision,
)


class ProvisioningProtocolTests(unittest.TestCase):
    def test_decode_message_ignores_device_preamble(self) -> None:
        self.assertEqual(
            decode_message('notice:{"status":"scanning"}'),
            {"status": "scanning"},
        )

    def test_credentials_are_compact_json_terminated_by_newline(self) -> None:
        self.assertEqual(
            encode_credentials('Office "2G"', "sëcret"),
            b'{"SSID":"Office \\"2G\\"","PW":"s\xc3\xabcret"}\n',
        )

    def test_receive_joins_lines_until_end_marker(self) -> None:
        client, server = socket.socketpair()
        reader = client.makefile("r", encoding="utf-8", errors="replace", newline=None)
        session = DeviceSession(client, reader)
        try:
            server.sendall(b'preamble\n{"status":\n"scanning"}\nend\n')
            self.assertEqual(session.receive(), {"status": "scanning"})
        finally:
            session.close()
            server.close()

    def test_provision_reconnects_after_scan_list(self) -> None:
        first_client, first_server = socket.socketpair()
        second_client, second_server = socket.socketpair()
        sessions = [
            DeviceSession(
                first_client,
                first_client.makefile(
                    "r", encoding="utf-8", errors="replace", newline=None
                ),
            ),
            DeviceSession(
                second_client,
                second_client.makefile(
                    "r", encoding="utf-8", errors="replace", newline=None
                ),
            ),
        ]
        received: list[bytes] = []

        def serve() -> None:
            try:
                with first_server:
                    first_server.sendall(b'{"wifilist":[{"ssid":"Home"}]}\nend\n')

                with second_server:
                    second_server.sendall(b'{"status":"scanning"}\nend\n')
                    received.append(second_server.makefile("rb").readline())
                    second_server.sendall(b'{"status":"connecting"}\nend\n')
            finally:
                first_server.close()
                second_server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            with mock.patch.object(DeviceSession, "connect", side_effect=sessions):
                self.assertEqual(
                    provision("192.168.1.1", 2008, 2.0, "Home", "secret"),
                    0,
                )
        finally:
            thread.join(timeout=2.0)

        self.assertEqual(received, [b'{"SSID":"Home","PW":"secret"}\n'])


if __name__ == "__main__":
    unittest.main()
