import type { API } from 'homebridge';

import { SkyworthPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

export default function registerPlatform(api: API): void {
  api.registerPlatform(PLATFORM_NAME, SkyworthPlatform);
}
