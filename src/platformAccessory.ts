import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
} from 'homebridge';
import rp from 'request-promise';
import { SilentGlissGatewayPlatform } from './platform';
import { MYSMARTBLINDS_QUERIES } from './settings';

export class SilentGlissBlindsAccessory {
  service!: Service;
  batteryService: Service;
  pollingInterval: number;
  name: string;
  closeUp: boolean;
  macAddress: string;
  platform: SilentGlissGatewayPlatform;
  accessory: PlatformAccessory;
  verboseDebug: boolean;

  constructor(
    platform: SilentGlissGatewayPlatform,
    accessory: PlatformAccessory,
  ) {
    this.platform = platform;
    this.name = accessory.context.blind.name;
    this.macAddress = accessory.context.blind.macAddress;
    this.closeUp = platform.config.closeUp || false;
    this.pollingInterval = platform.config.pollingInterval || 0;
    this.verboseDebug = platform.config.verboseDebug || false;

    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'MySmartBlinds')
      .setCharacteristic(this.platform.Characteristic.Model, 'Blind')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.macAddress);

    this.service = accessory.getService(this.platform.Service.WindowCovering) || accessory.addService(this.platform.Service.WindowCovering);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.name);

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .on('set', this.setTargetPosition.bind(this));
    this.updatePosition(accessory.context.blind.blindPosition);

    this.batteryService = accessory.getService(this.platform.Service.BatteryService)
    || accessory.addService(this.platform.Service.BatteryService, `${this.name} Battery`, `${this.macAddress} Battery`);
    this.updateBattery(accessory.context.blind.batteryLevel);
    
    this.accessory = accessory;

    if (this.pollingInterval > 0) {
      if (this.verboseDebug) {
        this.platform.log.info(`Begin polling for ${this.name}`);
      }
      setTimeout(() => this.refreshBlind(), this.pollingInterval * 1000 * 60);
    }
  }

  updatePosition(currentPosition: number) {
    let reportCurrentPosition = currentPosition;

    /* eslint-disable brace-style */
    // fix for blinds opned with finger via app
    if (reportCurrentPosition === 99) { reportCurrentPosition = 100; }

    // fix for blinds closed wth finger via app (1) or error (-1)
    if (reportCurrentPosition === 1 || reportCurrentPosition === -1) { reportCurrentPosition = 0; }
    // fix for MySmartBlinds being range 0 to 200 and Homebridge 0 to 100
    if (reportCurrentPosition > 100) { reportCurrentPosition = Math.abs(reportCurrentPosition - 200); }
    /* eslint-enable brace-style */

    if (this.verboseDebug) {
      this.platform.log.info(`STATUS: ${this.name} updateCurrentPosition : ${reportCurrentPosition} (Actual ${currentPosition})`);
    }

    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, reportCurrentPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, reportCurrentPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);
  }

  updateBattery(batteryLevel: number) {
    const {
      StatusLowBattery,
    } = this.platform.Characteristic;
    // value of -1 means data was not sent correctly, so ignore it for now

    this.batteryService.updateCharacteristic(this.platform.Characteristic.BatteryLevel, batteryLevel < 0 ? 0 : batteryLevel);
    this.batteryService
      .updateCharacteristic(
        StatusLowBattery,
        (batteryLevel < 20 && batteryLevel !== -1) ? StatusLowBattery.BATTERY_LEVEL_LOW : StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
  }

  setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const targetPosition = value as number;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, targetPosition);

    this.platform.log.info(`${this.name} setTargetPosition to ${value}`);

    rp(Object.assign(
      {},
      this.platform.requestOptions,
      {
        body: {
          query: MYSMARTBLINDS_QUERIES.UpdateBlindsPosition,
          variables: { position: this.closeUp ? (Math.abs(targetPosition - 200)) : targetPosition, blinds: this.macAddress },
        },
        resolveWithFullResponse: true,
      },
    ))
      .then((response) => {
        // update battery level since we just ran the motor a bit
        this.updateBattery(response.body.data.updateBlindsPosition[0].batteryLevel as number);

        // update current position
        this.updatePosition(targetPosition);
        
        this.platform.log.info(`${this.name} currentPosition is now ${targetPosition}`);
        callback(null);
      })
      .catch((err) => {
        this.platform.log.error(`${this.name} setTargetPosition ERROR`, err.statusCode);
        callback(null);
      });
  }

  refreshBlind() {
    if (this.verboseDebug) {
      this.platform.log.info(`Refresh blind ${this.name}`);
    }
    rp(Object.assign(
      {},
      this.platform.requestOptions,
      { body: { query: MYSMARTBLINDS_QUERIES.GetBlindSate, variables: { blinds: this.macAddress } }, resolveWithFullResponse: true },
    )).then((response) => {
      const blindState = response.body.data.blindsState[0];
      this.updatePosition(this.platform.convertPosition(blindState.position));
      this.updateBattery(blindState.batteryLevel as number);
      let refreshBlindTimeOut = this.pollingInterval * 1000 * 60; // convert minutes to milliseconds
      if (response.headers['x-ratelimit-reset']) {
        refreshBlindTimeOut = new Date(parseInt(response.headers['x-ratelimit-reset']) * 1000).getTime() - new Date().getTime();
        this.platform.log.warn(`Rate Limit reached, refresh for ${this.name} delay to ${new Date(response.headers['x-ratelimit-reset'])}`);
      }
      setTimeout(() => this.refreshBlind(), refreshBlindTimeOut);
    }).catch((err) => this.platform.log.error(`${this.name} refreshBlind ERROR`, err.statusCode));
  }
}
