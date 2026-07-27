import assert from 'node:assert/strict';
import test from 'node:test';

import { SkyworthController } from '../dist/controller.js';

function state(data1 = 0x08, data2 = 0, data3 = 0, data4 = 0) {
  return {
    data1,
    data2,
    data3,
    data4,
    power: (data1 & 0x08) !== 0,
    mode: 'auto',
    modeRaw: data1 & 0x07,
    fanSpeed: (data1 & 0x70) >>> 4,
    setpointC: 16,
    currentTemperatureC: 20,
    swingRaw: data3,
    light: (data4 & 0x80) !== 0,
    health: (data4 & 0x40) !== 0,
    sleep: (data4 & 0x02) !== 0,
    auxiliaryHeat: (data4 & 0x10) !== 0,
  };
}

test('serializes concurrent read-modify-write operations', async () => {
  let current = state();
  const commands = [];
  const client = {
    async getStatus() {
      return current;
    },
    async setState(data1, data2, data3, data4) {
      commands.push([data1, data2, data3, data4]);
      current = state(data1, data2, data3, data4);
    },
  };
  const log = { warn() {} };
  const controller = new SkyworthController(client, 30_000, log, () => {});

  await Promise.all([
    controller.mutate((original) => [
      original.data1 | 0x01,
      original.data2,
      original.data3,
      original.data4,
    ]),
    controller.mutate((original) => [
      original.data1,
      original.data2,
      original.data3,
      original.data4 | 0x80,
    ]),
  ]);

  assert.deepEqual(commands, [
    [0x09, 0, 0, 0],
    [0x09, 0, 0, 0x80],
  ]);
});
