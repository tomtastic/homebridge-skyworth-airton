import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { SkyworthPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type {
  SkyworthAccessoryContext,
  SkyworthDeviceConfig,
  SkyworthPlatformConfig,
} from './types.js';

const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_TIMEOUT_SECONDS = 5;

export class SkyworthPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly accessories = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, SkyworthPlatformAccessory>();
  private readonly platformConfig: SkyworthPlatformConfig;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.platformConfig = config as SkyworthPlatformConfig;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on('didFinishLaunching', () => {
      this.discoverConfiguredDevices();
    });
    this.api.on('shutdown', () => {
      for (const handler of this.handlers.values()) {
        handler.stop();
      }
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private discoverConfiguredDevices(): void {
    const devices = this.platformConfig.devices;
    if (!Array.isArray(devices) || devices.length === 0) {
      this.log.warn('No Skyworth/Airton devices are configured.');
      return;
    }

    const activeUuids = new Set<string>();
    for (const device of devices) {
      if (!this.isValidDevice(device)) {
        this.log.error('Skipping invalid device configuration:', JSON.stringify(device));
        continue;
      }

      const stableId = device.id?.trim() || device.host.trim();
      const uuid = this.api.hap.uuid.generate(stableId);
      activeUuids.add(uuid);

      let accessory = this.accessories.get(uuid);
      if (accessory) {
        this.log.info('Restoring accessory from cache:', device.name);
      } else {
        this.log.info('Adding accessory:', device.name);
        accessory = new this.api.platformAccessory(device.name, uuid);
        this.accessories.set(uuid, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      const context: SkyworthAccessoryContext = { device };
      accessory.context = context;
      this.api.updatePlatformAccessories([accessory]);

      const handler = new SkyworthPlatformAccessory(
        this,
        accessory,
        device,
        this.pollIntervalMs(),
        this.timeoutMs(),
      );
      this.handlers.set(uuid, handler);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!activeUuids.has(uuid)) {
        this.log.info('Removing accessory no longer present in config:', accessory.displayName);
        this.handlers.get(uuid)?.stop();
        this.handlers.delete(uuid);
        this.accessories.delete(uuid);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  private isValidDevice(device: unknown): device is SkyworthDeviceConfig {
    if (typeof device !== 'object' || device === null) {
      return false;
    }
    const candidate = device as Partial<SkyworthDeviceConfig>;
    return typeof candidate.name === 'string'
      && candidate.name.trim().length > 0
      && typeof candidate.host === 'string'
      && candidate.host.trim().length > 0;
  }

  private pollIntervalMs(): number {
    const seconds = this.platformConfig.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS;
    return Math.max(5, seconds) * 1000;
  }

  private timeoutMs(): number {
    const seconds = this.platformConfig.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    return Math.max(1, seconds) * 1000;
  }
}
