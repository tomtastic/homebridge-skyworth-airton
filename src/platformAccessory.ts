import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { SkyworthClient } from './client.js';
import { SkyworthController, type StateMutation } from './controller.js';
import type { SkyworthPlatform } from './platform.js';
import {
  applyAuxiliaryHeat,
  applyFanSpeed,
  applyHealth,
  applyHorizontalSwing,
  applyLight,
  applyMode,
  applyPower,
  applySleep,
  applyTemperature,
  applyVerticalSwing,
  DEFAULT_PORT,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  type AcMode,
  type AcState,
} from './protocol.js';
import type { SkyworthDeviceConfig } from './types.js';

export class SkyworthPlatformAccessory {
  private readonly controller: SkyworthController;
  private readonly heaterCoolerService: Service;

  constructor(
    private readonly platform: SkyworthPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: SkyworthDeviceConfig,
    pollIntervalMs: number,
    timeoutMs: number,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Skyworth / Airton')
      .setCharacteristic(this.platform.Characteristic.Model, device.model ?? 'Wi-Fi Air Conditioner')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.id ?? device.host);

    const client = new SkyworthClient(
      device.host,
      device.port ?? DEFAULT_PORT,
      timeoutMs,
    );
    this.controller = new SkyworthController(
      client,
      pollIntervalMs,
      platform.log,
      this.updateCharacteristics.bind(this),
    );

    this.heaterCoolerService = this.accessory.getService(this.platform.Service.HeaterCooler)
      ?? this.accessory.addService(this.platform.Service.HeaterCooler, device.name);
    this.configureHeaterCooler();
    this.configureCompanionSwitches();

    void this.controller.start().catch((error: unknown) => {
      this.platform.log.warn(
        `[${this.device.name}] Initial status request failed:`,
        this.errorMessage(error),
      );
    });
  }

  public stop(): void {
    this.controller.stop();
  }

  private configureHeaterCooler(): void {
    const characteristic = this.platform.Characteristic;
    const service = this.heaterCoolerService;

    service.setCharacteristic(characteristic.Name, this.device.name);
    service.getCharacteristic(characteristic.Active)
      .onGet(async () => {
        const state = await this.getState();
        return state.power ? characteristic.Active.ACTIVE : characteristic.Active.INACTIVE;
      })
      .onSet(async (value: CharacteristicValue) => {
        await this.mutate((state) => [
          applyPower(state.data1, Number(value) === characteristic.Active.ACTIVE),
          state.data2,
          state.data3,
          state.data4,
        ]);
      });

    service.getCharacteristic(characteristic.CurrentHeaterCoolerState)
      .onGet(async () => this.currentHeaterCoolerState(await this.getState()));

    service.getCharacteristic(characteristic.TargetHeaterCoolerState)
      .onGet(async () => this.targetHeaterCoolerState(await this.getState()))
      .onSet(async (value: CharacteristicValue) => {
        const mode = this.homeKitTargetToMode(Number(value));
        await this.mutate((state) => [
          applyMode(state.data1, mode),
          state.data2,
          state.data3,
          state.data4,
        ]);
      });

    service.getCharacteristic(characteristic.CurrentTemperature)
      .onGet(async () => (await this.getState()).currentTemperatureC);

    for (const temperatureCharacteristic of [
      characteristic.CoolingThresholdTemperature,
      characteristic.HeatingThresholdTemperature,
    ]) {
      service.getCharacteristic(temperatureCharacteristic)
        .setProps({
          minValue: MIN_TEMPERATURE,
          maxValue: MAX_TEMPERATURE,
          minStep: 1,
        })
        .onGet(async () => (await this.getState()).setpointC)
        .onSet(async (value: CharacteristicValue) => {
          await this.mutate((state) => [
            state.data1,
            applyTemperature(state.data2, Number(value)),
            state.data3,
            state.data4,
          ]);
        });
    }

    service.getCharacteristic(characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 6, minStep: 1 })
      .onGet(async () => (await this.getState()).fanSpeed)
      .onSet(async (value: CharacteristicValue) => {
        await this.mutate((state) => [
          applyFanSpeed(state.data1, Number(value)),
          state.data2,
          state.data3,
          state.data4,
        ]);
      });

    service.getCharacteristic(characteristic.SwingMode)
      .onGet(async () => {
        const state = await this.getState();
        return state.swingRaw === 0
          ? characteristic.SwingMode.SWING_DISABLED
          : characteristic.SwingMode.SWING_ENABLED;
      })
      .onSet(async (value: CharacteristicValue) => {
        const enabled = Number(value) === characteristic.SwingMode.SWING_ENABLED;
        await this.mutate((state) => [
          state.data1,
          state.data2,
          applyVerticalSwing(state.data3, enabled),
          state.data4,
        ]);
      });

    service.setCharacteristic(
      characteristic.TemperatureDisplayUnits,
      characteristic.TemperatureDisplayUnits.CELSIUS,
    );
  }

  private configureCompanionSwitches(): void {
    this.configureModeSwitch('Dry Mode', 'dry-mode', 'dry');
    this.configureModeSwitch('Fan Only Mode', 'fan-only-mode', 'fanOnly');

    this.configureSwitch(
      'Sleep Mode',
      'sleep-mode',
      (state) => state.sleep,
      (state, enabled) => [
        state.data1,
        state.data2,
        state.data3,
        applySleep(state.data4, enabled),
      ],
    );
    this.configureSwitch(
      'Display Light',
      'display-light',
      (state) => state.light,
      (state, enabled) => [
        state.data1,
        state.data2,
        state.data3,
        applyLight(state.data4, enabled),
      ],
    );
    this.configureSwitch(
      'Health Filter',
      'health-filter',
      (state) => state.health,
      (state, enabled) => [
        state.data1,
        state.data2,
        state.data3,
        applyHealth(state.data4, enabled),
      ],
    );
    this.configureSwitch(
      'Auxiliary Heat',
      'auxiliary-heat',
      (state) => state.auxiliaryHeat,
      (state, enabled) => [
        state.data1,
        state.data2,
        state.data3,
        applyAuxiliaryHeat(state.data4, enabled),
      ],
    );
    this.configureSwitch(
      'Vertical Swing',
      'vertical-swing',
      (state) => (state.swingRaw & 0x01) !== 0,
      (state, enabled) => [
        state.data1,
        state.data2,
        applyVerticalSwing(state.data3, enabled),
        state.data4,
      ],
    );
    this.configureSwitch(
      'Horizontal Swing',
      'horizontal-swing',
      (state) => (state.swingRaw & 0x10) !== 0,
      (state, enabled) => [
        state.data1,
        state.data2,
        applyHorizontalSwing(state.data3, enabled),
        state.data4,
      ],
    );
  }

  private configureModeSwitch(name: string, subtype: string, mode: AcMode): void {
    this.configureSwitch(
      name,
      subtype,
      (state) => state.power && state.mode === mode,
      (state, enabled) => [
        enabled
          ? applyMode(state.data1, mode)
          : state.mode === mode
            ? applyPower(state.data1, false)
            : state.data1,
        state.data2,
        state.data3,
        state.data4,
      ],
    );
  }

  private configureSwitch(
    name: string,
    subtype: string,
    isOn: (state: AcState) => boolean,
    mutation: (state: AcState, enabled: boolean) => ReturnType<StateMutation>,
  ): void {
    const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
      ?? this.accessory.addService(this.platform.Service.Switch, name, subtype);
    service.setCharacteristic(this.platform.Characteristic.Name, name);
    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => isOn(await this.getState()))
      .onSet(async (value: CharacteristicValue) => {
        await this.mutate((state) => mutation(state, Boolean(value)));
      });
  }

  private updateCharacteristics(state: AcState): void {
    const characteristic = this.platform.Characteristic;
    this.heaterCoolerService
      .updateCharacteristic(
        characteristic.Active,
        state.power ? characteristic.Active.ACTIVE : characteristic.Active.INACTIVE,
      )
      .updateCharacteristic(
        characteristic.CurrentHeaterCoolerState,
        this.currentHeaterCoolerState(state),
      )
      .updateCharacteristic(
        characteristic.TargetHeaterCoolerState,
        this.targetHeaterCoolerState(state),
      )
      .updateCharacteristic(characteristic.CurrentTemperature, state.currentTemperatureC)
      .updateCharacteristic(characteristic.CoolingThresholdTemperature, state.setpointC)
      .updateCharacteristic(characteristic.HeatingThresholdTemperature, state.setpointC)
      .updateCharacteristic(characteristic.RotationSpeed, state.fanSpeed)
      .updateCharacteristic(
        characteristic.SwingMode,
        state.swingRaw === 0
          ? characteristic.SwingMode.SWING_DISABLED
          : characteristic.SwingMode.SWING_ENABLED,
      );

    this.updateSwitch('dry-mode', state.power && state.mode === 'dry');
    this.updateSwitch('fan-only-mode', state.power && state.mode === 'fanOnly');
    this.updateSwitch('sleep-mode', state.sleep);
    this.updateSwitch('display-light', state.light);
    this.updateSwitch('health-filter', state.health);
    this.updateSwitch('auxiliary-heat', state.auxiliaryHeat);
    this.updateSwitch('vertical-swing', (state.swingRaw & 0x01) !== 0);
    this.updateSwitch('horizontal-swing', (state.swingRaw & 0x10) !== 0);
  }

  private updateSwitch(subtype: string, enabled: boolean): void {
    this.accessory.getServiceById(this.platform.Service.Switch, subtype)
      ?.updateCharacteristic(this.platform.Characteristic.On, enabled);
  }

  private currentHeaterCoolerState(state: AcState): number {
    const current = this.platform.Characteristic.CurrentHeaterCoolerState;
    if (!state.power) {
      return current.INACTIVE;
    }
    if (state.mode === 'heat') {
      return current.HEATING;
    }
    if (state.mode === 'cool') {
      return current.COOLING;
    }
    return current.IDLE;
  }

  private targetHeaterCoolerState(state: AcState): number {
    const target = this.platform.Characteristic.TargetHeaterCoolerState;
    if (state.mode === 'heat') {
      return target.HEAT;
    }
    if (state.mode === 'cool') {
      return target.COOL;
    }
    return target.AUTO;
  }

  private homeKitTargetToMode(value: number): AcMode {
    const target = this.platform.Characteristic.TargetHeaterCoolerState;
    if (value === target.HEAT) {
      return 'heat';
    }
    if (value === target.COOL) {
      return 'cool';
    }
    return 'auto';
  }

  private async getState(): Promise<AcState> {
    try {
      return await this.controller.currentState();
    } catch (error: unknown) {
      throw this.communicationError(error);
    }
  }

  private async mutate(mutation: StateMutation): Promise<void> {
    try {
      await this.controller.mutate(mutation);
    } catch (error: unknown) {
      throw this.communicationError(error);
    }
  }

  private communicationError(error: unknown): Error {
    this.platform.log.error(`[${this.device.name}]`, this.errorMessage(error));
    return new this.platform.api.hap.HapStatusError(
      this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
