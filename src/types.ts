import type { PlatformConfig } from 'homebridge';

export interface SkyworthDeviceConfig {
  name: string;
  host: string;
  id?: string;
  port?: number;
  model?: string;
}

export interface SkyworthPlatformConfig extends PlatformConfig {
  devices?: SkyworthDeviceConfig[];
  pollInterval?: number;
  timeout?: number;
}

export interface SkyworthAccessoryContext {
  device: SkyworthDeviceConfig;
}
