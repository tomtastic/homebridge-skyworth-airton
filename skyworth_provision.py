#!/usr/bin/env python3
"""Provision a Skyworth/Airton AC while connected to its temporary Wi-Fi AP."""

from __future__ import annotations

import argparse
import getpass
import json
import socket
import sys
from dataclasses import dataclass
from typing import Sequence, TextIO, TypeAlias, cast


DEFAULT_HOST = "192.168.1.1"
DEFAULT_PORT = 2008
DEFAULT_TIMEOUT = 15.0
MAX_CONNECTIONS = 4
MAX_MESSAGES_PER_CONNECTION = 8

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


class ProvisioningError(RuntimeError):
    pass


def decode_message(message: str) -> JsonObject:
    json_start = message.find("{")
    if json_start < 0:
        raise ProvisioningError(f"device message contains no JSON object: {message!r}")

    try:
        decoded = json.loads(message[json_start:])
    except json.JSONDecodeError as error:
        raise ProvisioningError(f"invalid JSON from device: {message!r}") from error

    if not isinstance(decoded, dict):
        raise ProvisioningError(f"expected a JSON object from device, got: {decoded!r}")
    return cast(JsonObject, decoded)


def encode_credentials(ssid: str, password: str) -> bytes:
    payload = json.dumps(
        {"SSID": ssid, "PW": password},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return payload.encode("utf-8") + b"\n"


@dataclass
class DeviceSession:
    connection: socket.socket
    reader: TextIO

    @classmethod
    def connect(cls, host: str, port: int, timeout: float) -> "DeviceSession":
        connection = socket.create_connection((host, port), timeout=timeout)
        connection.settimeout(timeout)
        reader = connection.makefile("r", encoding="utf-8", errors="replace", newline=None)
        return cls(connection=connection, reader=reader)

    def close(self) -> None:
        self.reader.close()
        self.connection.close()

    def receive(self) -> JsonObject:
        parts: list[str] = []
        while True:
            line = self.reader.readline()
            if line == "":
                raise ProvisioningError("device closed the connection before the 'end' marker")

            line = line.rstrip("\r\n")
            if line.casefold() == "end":
                return decode_message("".join(parts))
            parts.append(line)

    def send_credentials(self, ssid: str, password: str) -> None:
        self.connection.sendall(encode_credentials(ssid, password))


def print_message(message: JsonObject) -> None:
    print(json.dumps(message, ensure_ascii=False, indent=2, sort_keys=True))


def scan(host: str, port: int, timeout: float) -> int:
    session = DeviceSession.connect(host, port, timeout)
    try:
        message = session.receive()
    finally:
        session.close()

    print_message(message)
    wifi_list = message.get("wifilist")
    if isinstance(wifi_list, list):
        return 0

    print("warning: response did not contain 'wifilist'", file=sys.stderr)
    return 2


def provision(host: str, port: int, timeout: float, ssid: str, password: str) -> int:
    credentials_sent = False

    for connection_number in range(1, MAX_CONNECTIONS + 1):
        print(f"connecting to {host}:{port} (attempt {connection_number})", file=sys.stderr)
        try:
            session = DeviceSession.connect(host, port, timeout)
        except OSError as error:
            if credentials_sent:
                raise ProvisioningError(
                    "the setup socket disappeared after credentials were sent; "
                    "check whether the device joined the target network"
                ) from error
            if connection_number == MAX_CONNECTIONS:
                raise
            continue

        try:
            for _ in range(MAX_MESSAGES_PER_CONNECTION):
                try:
                    message = session.receive()
                except (OSError, ProvisioningError):
                    break

                status = message.get("status")
                if status == "scanning":
                    session.send_credentials(ssid, password)
                    credentials_sent = True
                    print("credentials sent; device is joining the target network", file=sys.stderr)
                elif status == "connecting":
                    print("device acknowledged the join attempt", file=sys.stderr)
                    return 0
                elif "wifilist" in message:
                    print("received AP scan list; reopening the setup connection", file=sys.stderr)
                    break
                else:
                    print_message(message)
        finally:
            session.close()

    if credentials_sent:
        raise ProvisioningError(
            "credentials were sent, but the device never reported status 'connecting'"
        )
    raise ProvisioningError("device never reported status 'scanning'")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect or provision a SkySAC_* air-conditioner setup AP."
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--timeout", default=DEFAULT_TIMEOUT, type=float)

    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("scan", help="print the Wi-Fi networks seen by the device")

    provision_parser = subparsers.add_parser(
        "provision", help="send target Wi-Fi credentials"
    )
    provision_parser.add_argument("ssid", help="target 2.4 GHz Wi-Fi SSID")
    provision_parser.add_argument(
        "--password",
        help="target Wi-Fi password; omit to enter it without shell-history exposure",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "scan":
            return scan(arguments.host, arguments.port, arguments.timeout)

        password = arguments.password
        if password is None:
            password = getpass.getpass("Target Wi-Fi password: ")
        return provision(
            arguments.host,
            arguments.port,
            arguments.timeout,
            arguments.ssid,
            password,
        )
    except (OSError, ProvisioningError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
