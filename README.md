# Homebridge Skyworth Airton

A local-only Homebridge platform plugin for Skyworth and Airton Wi-Fi air
conditioners using the TCP protocol exposed on port 1998. It does not require a
cloud account.

The air conditioner must already be connected to the same LAN as Homebridge.
See [PROVISIONING_PROTOCOL.md](PROVISIONING_PROTOCOL.md) and
`skyworth_provision.py` for the separate temporary-AP setup process.

## HomeKit services

Each configured air conditioner appears as one accessory with:

- Heater/Cooler control for power, auto/cool/heat mode, target temperature,
  measured room temperature, fan speed 0–6, and swing.
- Dry Mode and Fan Only Mode switches.
- Sleep Mode, Display Light, Health Filter, and Auxiliary Heat switches.
- Separate Vertical Swing and Horizontal Swing switches.

Fan speed `0` is the device's automatic fan setting. HomeKit does not natively
represent dry or fan-only HVAC targets, so those modes use companion switches.
The main Heater/Cooler target reports them as Auto.

## Requirements

- Homebridge 1.8 or 2.x
- Node.js 22.10 or 24
- A DHCP reservation or stable hostname for each air conditioner
- TCP reachability from Homebridge to the device on port 1998

## Connect the air conditioner to local Wi-Fi

The included `skyworth_provision.py` tool replaces the deprecated app's local
Wi-Fi setup flow. It has no third-party Python dependencies and requires
Python 3.10 or newer.

### 1. Start the device setup access point

Put the air conditioner into Wi-Fi setup mode using the procedure for its
panel or remote. The exact button sequence varies by model. Wait for a Wi-Fi
network named `SkySAC_<hex>` to appear.

Join that network from the computer running the provisioning tool:

- SSID: `SkySAC_<hex>`
- Password: `88888888`

The temporary network normally has no Internet access. Keep the computer
connected to it, and temporarily disable VPNs or automatic fallback to another
Wi-Fi network if they interfere with the route to `192.168.1.1`.

### 2. Check the networks visible to the device

From this repository, run:

```sh
python3 skyworth_provision.py scan
```

The tool connects to the device's setup service at `192.168.1.1:2008` and
prints its `wifilist` response. Confirm that the intended local Wi-Fi SSID is
listed. These devices generally require a 2.4 GHz network.

If the device responds slowly, place global options before the command:

```sh
python3 skyworth_provision.py --timeout 30 scan
```

### 3. Send the local Wi-Fi credentials

Pass the target SSID to the `provision` command:

```sh
python3 skyworth_provision.py provision "Your 2.4 GHz SSID"
```

Enter the target Wi-Fi password when prompted. Prompting keeps the password out
of shell history. A `--password` option exists for automation, but exposing a
password on the command line is not recommended.

The normal exchange is:

```text
received AP scan list; reopening the setup connection
credentials sent; device is joining the target network
device acknowledged the join attempt
```

The `SkySAC_*` network should then disappear as the air conditioner joins the
target network.

### 4. Find and reserve the device address

Reconnect the computer to the normal local Wi-Fi and find the air conditioner
in the router's DHCP client list. Create a DHCP reservation for that address,
then check that its normal control port is reachable:

```sh
nc -vz DEVICE_IP 1998
```

Use `DEVICE_IP` as the `host` in the Homebridge configuration below. Port
`2008` is only used while connected to the temporary setup AP; Homebridge uses
port `1998` after provisioning.

### Provisioning troubleshooting

- If `192.168.1.1` is unreachable, confirm the computer is still associated
  with `SkySAC_*` and has not switched to another network.
- If `scan` times out, restart setup mode on the air conditioner and retry with
  `--timeout 30`.
- If the target SSID is absent, ensure its 2.4 GHz radio is enabled and visible.
- If the socket closes after credentials are sent, check the router's DHCP list
  before retrying; the device may have joined successfully without sending its
  final status message.
- Full setup protocol details are in
  [PROVISIONING_PROTOCOL.md](PROVISIONING_PROTOCOL.md).

## Install for development

```sh
npm install
npm run build
npm link
```

Restart Homebridge after linking the plugin.

## Configuration

Use the Homebridge UI or add this platform entry to `config.json`:

```json
{
  "platform": "SkyworthAirton",
  "name": "Skyworth Airton",
  "pollInterval": 30,
  "timeout": 5,
  "devices": [
    {
      "name": "Living Room Air Conditioner",
      "host": "192.168.1.50",
      "id": "living-room-ac",
      "port": 1998,
      "model": "Airton Wi-Fi Air Conditioner"
    }
  ]
}
```

Use a stable `id` when possible. If it is omitted, the host is used to derive
the HomeKit accessory UUID; changing the host would then create a new accessory.

## Protocol behavior

The plugin sends status request command `0xA2` and decodes `0xA3` responses.
Writes use command `0xA1`. Every HomeKit write is serialized and follows a
read-modify-write-refresh sequence so changing one setting does not overwrite
unrelated mode bits.

Frames use CRC16-Modbus with polynomial `0xA001`, initial value `0xFFFF`, and
high-byte/low-byte wire order. The implementation validates response headers,
declared lengths, commands, and CRC values.

Protocol details and field mappings are based on:

- <https://github.com/coworking-metz/ha-skyworth-airton/blob/main/PROTOCOL.md>
- <https://github.com/coworking-metz/ha-skyworth-airton/blob/main/custom_components/skyworth_ac/protocol.py>

The protocol is unauthenticated and unencrypted. Keep the device on a trusted
network or an appropriately isolated IoT VLAN.
