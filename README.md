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
