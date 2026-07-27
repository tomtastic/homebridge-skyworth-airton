# Skyworth/Airton Wi-Fi provisioning protocol

This note describes the dedicated setup protocol recovered from
`Easy Home AMS_2.0.2.apk`. It is separate from the binary air-conditioner
control protocol on TCP port 1998.

## Recovered setup parameters

| Property | Value |
| --- | --- |
| Temporary device SSID | `SkySAC_<hex>` |
| Temporary device WPA password | `88888888` |
| Device address on temporary AP | `192.168.1.1` |
| Setup transport | TCP |
| Setup port | `2008` |
| Encoding | UTF-8 JSON carried as text lines |
| Device message terminator | A line containing `end` |
| Client message terminator | Newline |

The APK SHA-256 is
`729938cfd3e366f4617e27251d9880796c5aa8d4adc0e11f8ef5f56ed8045abf`.
It contains one Dalvik `classes.dex` and no native libraries, so the relevant
evidence is in decoded smali rather than a native Ghidra program.

## Exchange

After the phone or computer joins the `SkySAC_*` access point, it opens a TCP
connection to `192.168.1.1:2008`. The device sends JSON as one or more text
lines, followed by a separate `end` line. The app concatenates all lines before
`end` and parses from the first `{` character.

A scan response has this shape:

```text
{"wifilist":[{"ssid":"Example 2.4 GHz"},{"ssid":"Other network"}]}
end
```

The original app closes that setup connection after receiving `wifilist`. It
opens a fresh connection after the user selects a network. When the device
reports:

```text
{"status":"scanning"}
end
```

the app sends exactly this JSON object followed by a newline:

```json
{"SSID":"Example 2.4 GHz","PW":"target-password"}
```

The device then reports:

```text
{"status":"connecting"}
end
```

At that point the app leaves the temporary AP and reconnects the phone to the
target Wi-Fi. The device should disappear from `192.168.1.1`; discover its new
DHCP address on the target LAN and use TCP port 1998 for normal AC control.

## Reproduction

Join the temporary AP using SSID `SkySAC_<hex>` and password `88888888`. The
device may provide no Internet access, so disable automatic fallback to another
network while provisioning.

Inspect the networks visible to the AC:

```sh
python3 skyworth_provision.py scan
```

Provision it; the tool prompts for the target password:

```sh
python3 skyworth_provision.py provision "Example 2.4 GHz"
```

The implementation tolerates the app's two-phase behavior: if the first
connection returns `wifilist`, it reconnects and waits for `status=scanning`
before sending credentials.

## Evidence in the decoded APK

- `com/skyworth/client/TCPClient` fixes the setup endpoint at
  `192.168.1.1:0x7d8` (`2008`), reads lines until case-insensitive `end`, and
  sends client messages with `PrintWriter.println`.
- `ConnectingFragment.resolveJson` waits for `status=scanning`, builds
  `{"SSID":"...","PW":"..."}`, sends it through `TCPClient`, and treats
  `status=connecting` as the signal to reconnect to the original Wi-Fi.
- `SearchAirconditionAPFragment` accepts device AP names beginning `SkySAC_`.
- `SearchAirconditionAPFragment$6` joins that AP using password `88888888`.
- `Target` and the ordinary TCP transport default to `0x7ce` (`1998`), which
  confirms that setup port 2008 and control port 1998 serve different roles.

## Caveats

- This result is from static analysis of app version 2.0.2. It still needs a
  capture against the physical unit to confirm its exact response timing.
- The app performs no explicit authentication or encryption on setup port 2008.
  Anyone connected to the temporary AP can submit Wi-Fi credentials.
- The target network is likely required to be 2.4 GHz, as is typical for the
  Wi-Fi module generation used by this app.
- If the device drops the socket immediately after receiving credentials, check
  the DHCP client list before retrying; it may have joined successfully without
  delivering the final `connecting` message.

The port-1998 binary control framing is independently documented in
<https://github.com/coworking-metz/ha-skyworth-airton/blob/main/custom_components/skyworth_ac/protocol.py>.
