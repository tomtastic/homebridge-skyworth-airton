import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFanSpeed,
  applyMode,
  applyTemperature,
  buildCommandFrame,
  buildStatusRequest,
  crc16Modbus,
  decodeStatus,
} from '../dist/protocol.js';

test('builds the validated status request', () => {
  assert.equal(buildStatusRequest().toString('hex'), '7a7a21d50c0000a2101055a3');
});

test('builds a 24-byte command with a valid CRC', () => {
  const frame = buildCommandFrame(0x39, 0x06, 0x11, 0xd2);
  assert.equal(frame.length, 24);
  assert.deepEqual(frame.subarray(-2), crc16Modbus(frame.subarray(0, -2)));
});

test('decodes a status frame', () => {
  const body = Buffer.alloc(32);
  Buffer.from([0x7a, 0x7a, 0xd5, 0x21, 0x22, 0, 0, 0xa3, 0x10, 0x10]).copy(body);
  body[10] = 23;
  body[11] = 5;
  body[13] = 0x39;
  body[14] = 0x06;
  body[15] = 0x11;
  body[16] = 0xd2;
  const state = decodeStatus(Buffer.concat([body, crc16Modbus(body)]));

  assert.equal(state.power, true);
  assert.equal(state.mode, 'cool');
  assert.equal(state.fanSpeed, 3);
  assert.equal(state.setpointC, 22);
  assert.equal(state.currentTemperatureC, 23.5);
  assert.equal(state.swingRaw, 0x11);
  assert.equal(state.light, true);
  assert.equal(state.health, true);
  assert.equal(state.sleep, true);
  assert.equal(state.auxiliaryHeat, true);
});

test('bit modifiers preserve unrelated state', () => {
  assert.equal(applyMode(0xf8, 'cool'), 0xf9);
  assert.equal(applyFanSpeed(0x8a, 4), 0xca);
  assert.equal(applyTemperature(0xe0, 22), 0xe6);
});
