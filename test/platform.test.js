import assert from 'node:assert/strict';
import test from 'node:test';

import { SkyworthPlatform } from '../dist/platform.js';

class AccessoryInformation {}
class HeaterCooler {}
class Switch {}
const Service = { AccessoryInformation, HeaterCooler, Switch };

function characteristic(values = {}) {
  return { ...values };
}

const Characteristic = {
  Name: characteristic(),
  Manufacturer: characteristic(),
  Model: characteristic(),
  SerialNumber: characteristic(),
  Active: characteristic({ ACTIVE: 1, INACTIVE: 0 }),
  CurrentHeaterCoolerState: characteristic({ INACTIVE: 0, IDLE: 1, COOLING: 2, HEATING: 3 }),
  TargetHeaterCoolerState: characteristic({ HEAT: 0, COOL: 1, AUTO: 2 }),
  CurrentTemperature: characteristic(),
  CoolingThresholdTemperature: characteristic(),
  HeatingThresholdTemperature: characteristic(),
  RotationSpeed: characteristic(),
  SwingMode: characteristic({ SWING_DISABLED: 0, SWING_ENABLED: 1 }),
  TemperatureDisplayUnits: characteristic({ CELSIUS: 0, FAHRENHEIT: 1 }),
  On: characteristic(),
};

// The handler chain is service.getCharacteristic(c).setProps({}).onGet(fn).onSet(fn),
// so one reusable chainable stand-in covers every characteristic.
const chainable = {
  setProps() {
    return chainable;
  },
  onGet() {
    return chainable;
  },
  onSet() {
    return chainable;
  },
};

class FakeService {
  setCharacteristic() {
    return this;
  }

  getCharacteristic() {
    return chainable;
  }

  updateCharacteristic() {
    return this;
  }
}

class FakeAccessory {
  constructor(displayName, uuid) {
    this.displayName = displayName;
    this.UUID = uuid;
    // Homebridge owns this object and stores its own keys in it.
    this.context = { _skipWindowCoveringBehavior: true };
    this.services = new Map();
    // Every real PlatformAccessory carries an AccessoryInformation service.
    this.addService(AccessoryInformation);
  }

  serviceKey(service, subtype) {
    return `${service.name}|${subtype ?? ''}`;
  }

  getService(service) {
    return this.services.get(this.serviceKey(service));
  }

  getServiceById(service, subtype) {
    return this.services.get(this.serviceKey(service, subtype));
  }

  addService(service, name, subtype) {
    const added = new FakeService(service, name, subtype);
    this.services.set(this.serviceKey(service, subtype), added);
    return added;
  }
}

function createHarness(config) {
  const events = new Map();
  const log = { info: [], warn: [], error: [] };
  const calls = { registered: [], updated: [], unregistered: [] };
  const logger = {};
  for (const level of Object.keys(log)) {
    logger[level] = (...messages) => log[level].push(messages.join(' '));
  }

  const api = {
    hap: {
      Service,
      Characteristic,
      uuid: { generate: (id) => `uuid:${id}` },
      HapStatusError: class HapStatusError extends Error {},
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70487 },
    },
    on(event, handler) {
      if (!events.has(event)) {
        events.set(event, []);
      }
      events.get(event).push(handler);
    },
    // Homebridge exposes the PlatformAccessory class itself here.
    platformAccessory: FakeAccessory,
    registerPlatformAccessories(_plugin, _platform, accessories) {
      calls.registered.push(...accessories);
    },
    updatePlatformAccessories(accessories) {
      calls.updated.push(...accessories);
    },
    unregisterPlatformAccessories(_plugin, _platform, accessories) {
      calls.unregistered.push(...accessories);
    },
  };

  const platform = new SkyworthPlatform(logger, config, api);
  return {
    platform,
    log,
    calls,
    emit(event) {
      for (const handler of events.get(event) ?? []) {
        handler();
      }
    },
  };
}

// Port 1 on loopback refuses immediately, so the initial status read fails the
// way an offline air conditioner would and no poll timer is ever armed.
const unreachableDevice = { name: 'Test Air Conditioner', host: '127.0.0.1', port: 1 };

test('registers configured devices and merges accessory context', () => {
  const harness = createHarness({
    platform: 'SkyworthAirton',
    name: 'Skyworth Airton',
    devices: [unreachableDevice],
  });

  harness.emit('didFinishLaunching');

  assert.equal(harness.calls.registered.length, 1);
  const [accessory] = harness.calls.registered;
  assert.equal(accessory.displayName, 'Test Air Conditioner');
  // No stable id is configured, so the UUID derives from the host.
  assert.equal(accessory.UUID, 'uuid:127.0.0.1');
  assert.deepEqual(accessory.context.device, unreachableDevice);
  assert.equal(
    accessory.context._skipWindowCoveringBehavior,
    true,
    'context keys owned by Homebridge must survive a reconfigure',
  );
  assert.equal(accessory.services.has('HeaterCooler|'), true);
  for (const subtype of [
    'dry-mode',
    'fan-only-mode',
    'sleep-mode',
    'display-light',
    'health-filter',
    'auxiliary-heat',
    'vertical-swing',
    'horizontal-swing',
  ]) {
    assert.equal(accessory.services.has(`Switch|${subtype}`), true, `missing Switch service: ${subtype}`);
  }

  harness.emit('shutdown');
});

test('restores a cached accessory instead of registering a duplicate', () => {
  const harness = createHarness({
    platform: 'SkyworthAirton',
    name: 'Skyworth Airton',
    devices: [unreachableDevice],
  });
  const cached = new FakeAccessory('Old Name', 'uuid:127.0.0.1');
  harness.platform.configureAccessory(cached);

  harness.emit('didFinishLaunching');

  assert.equal(harness.calls.registered.length, 0);
  assert.equal(harness.calls.unregistered.length, 0);
  assert.deepEqual(harness.log.info.filter((line) => line.includes('Restoring accessory from cache')), [
    'Restoring accessory from cache: Test Air Conditioner',
  ]);

  harness.emit('shutdown');
});

test('removes cached accessories that left the config', () => {
  const harness = createHarness({
    platform: 'SkyworthAirton',
    name: 'Skyworth Airton',
    devices: [unreachableDevice],
  });
  const orphan = new FakeAccessory('Removed Air Conditioner', 'uuid:removed');
  harness.platform.configureAccessory(orphan);

  harness.emit('didFinishLaunching');

  assert.deepEqual(harness.calls.unregistered, [orphan]);
  assert.equal(harness.calls.registered.length, 1);

  harness.emit('shutdown');
});

test('skips invalid device entries', () => {
  const harness = createHarness({
    platform: 'SkyworthAirton',
    name: 'Skyworth Airton',
    devices: [
      { name: '  ', host: '127.0.0.1' },
      { name: 'No Host' },
      unreachableDevice,
      null,
    ],
  });

  harness.emit('didFinishLaunching');

  assert.equal(harness.calls.registered.length, 1);
  assert.equal(harness.log.error.length, 3);

  harness.emit('shutdown');
});

test('starts nothing when no devices are configured', () => {
  const harness = createHarness({ platform: 'SkyworthAirton', name: 'Skyworth Airton' });

  harness.emit('didFinishLaunching');

  assert.equal(harness.calls.registered.length, 0);
  assert.equal(harness.calls.updated.length, 0);
  assert.deepEqual(harness.log.warn, ['No Skyworth/Airton devices are configured.']);

  harness.emit('shutdown');
});
