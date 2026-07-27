export const DEFAULT_PORT = 1998;
export const MIN_TEMPERATURE = 16;
export const MAX_TEMPERATURE = 31;

const AC_ADDRESS = 0x21;
const APP_ADDRESS = 0xd5;
const STATUS_COMMAND = 0xa3;

export type AcMode = 'auto' | 'cool' | 'dry' | 'fanOnly' | 'heat';

export interface AcState {
  data1: number;
  data2: number;
  data3: number;
  data4: number;
  power: boolean;
  mode: AcMode;
  modeRaw: number;
  fanSpeed: number;
  setpointC: number;
  currentTemperatureC: number;
  swingRaw: number;
  light: boolean;
  health: boolean;
  sleep: boolean;
  auxiliaryHeat: boolean;
}

const MODE_TO_RAW: Readonly<Record<AcMode, number>> = {
  auto: 0,
  cool: 1,
  dry: 2,
  fanOnly: 3,
  heat: 4,
};

const RAW_TO_MODE: Readonly<Record<number, AcMode>> = {
  0: 'auto',
  1: 'cool',
  2: 'dry',
  3: 'fanOnly',
  4: 'heat',
};

export function crc16Modbus(data: Uint8Array): Buffer {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return Buffer.from([(crc >>> 8) & 0xff, crc & 0xff]);
}

export function buildStatusRequest(): Buffer {
  const body = Buffer.from([
    0x7a, 0x7a, AC_ADDRESS, APP_ADDRESS, 0x0c,
    0x00, 0x00, 0xa2, 0x10, 0x10,
  ]);
  return Buffer.concat([body, crc16Modbus(body)]);
}

export function buildCommandFrame(
  data1: number,
  data2: number,
  data3: number,
  data4: number,
): Buffer {
  const body = Buffer.from([
    0x7a, 0x7a, AC_ADDRESS, APP_ADDRESS, 0x18,
    0x00, 0x00, 0xa1, 0x10, 0x10, 0x00, 0x00,
    data1 & 0xff, data2 & 0xff, data3 & 0xff, data4 & 0xff,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  return Buffer.concat([body, crc16Modbus(body)]);
}

export function decodeStatus(raw: Uint8Array): AcState {
  const frame = Buffer.from(raw);
  if (frame.length < 17 || frame[0] !== 0x7a || frame[1] !== 0x7a) {
    throw new Error(`Invalid or truncated Skyworth status frame: ${frame.toString('hex')}`);
  }

  const declaredLength = frame[4] ?? 0;
  if (declaredLength < 17 || frame.length < declaredLength) {
    throw new Error(`Incomplete Skyworth frame: expected ${declaredLength}, received ${frame.length}`);
  }
  if (frame[7] !== STATUS_COMMAND) {
    throw new Error(`Unexpected Skyworth response command: 0x${(frame[7] ?? 0).toString(16)}`);
  }

  const payload = frame.subarray(0, declaredLength - 2);
  const expectedCrc = crc16Modbus(payload);
  if (
    frame[declaredLength - 2] !== expectedCrc[0]
    || frame[declaredLength - 1] !== expectedCrc[1]
  ) {
    throw new Error(`Invalid Skyworth frame CRC: ${frame.subarray(0, declaredLength).toString('hex')}`);
  }

  const data1 = frame[13] ?? 0;
  const data2 = frame[14] ?? 0;
  const data3 = frame[15] ?? 0;
  const data4 = frame[16] ?? 0;
  const modeRaw = data1 & 0x07;

  return {
    data1,
    data2,
    data3,
    data4,
    power: (data1 & 0x08) !== 0,
    mode: RAW_TO_MODE[modeRaw] ?? 'auto',
    modeRaw,
    fanSpeed: (data1 & 0x70) >>> 4,
    setpointC: (data2 & 0x1f) + MIN_TEMPERATURE,
    currentTemperatureC: (frame[10] ?? 0) + (frame[11] ?? 0) / 10,
    swingRaw: data3,
    light: (data4 & 0x80) !== 0,
    health: (data4 & 0x40) !== 0,
    sleep: (data4 & 0x02) !== 0,
    auxiliaryHeat: (data4 & 0x10) !== 0,
  };
}

export function applyPower(data1: number, enabled: boolean): number {
  return (data1 & ~0x08) | (enabled ? 0x08 : 0x00);
}

export function applyMode(data1: number, mode: AcMode): number {
  return (applyPower(data1, true) & ~0x07) | MODE_TO_RAW[mode];
}

export function applyFanSpeed(data1: number, speed: number): number {
  const normalizedSpeed = Math.max(0, Math.min(6, Math.round(speed)));
  return (applyPower(data1, true) & ~0x70) | (normalizedSpeed << 4);
}

export function applyTemperature(data2: number, temperatureC: number): number {
  const normalizedTemperature = Math.max(
    MIN_TEMPERATURE,
    Math.min(MAX_TEMPERATURE, Math.round(temperatureC)),
  );
  return (data2 & ~0x1f) | (normalizedTemperature - MIN_TEMPERATURE);
}

export function applyVerticalSwing(data3: number, enabled: boolean): number {
  return (data3 & ~0x01) | (enabled ? 0x01 : 0x00);
}

export function applyHorizontalSwing(data3: number, enabled: boolean): number {
  return (data3 & ~0x10) | (enabled ? 0x10 : 0x00);
}

export function applyLight(data4: number, enabled: boolean): number {
  return (data4 & ~0x80) | (enabled ? 0x80 : 0x00);
}

export function applyHealth(data4: number, enabled: boolean): number {
  return (data4 & ~0x40) | (enabled ? 0x40 : 0x00);
}

export function applySleep(data4: number, enabled: boolean): number {
  return (data4 & ~0x02) | (enabled ? 0x02 : 0x00);
}

export function applyAuxiliaryHeat(data4: number, enabled: boolean): number {
  return (data4 & ~0x10) | (enabled ? 0x10 : 0x00);
}
