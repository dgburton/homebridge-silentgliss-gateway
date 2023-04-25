import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
} from 'homebridge';
import {
  SilentGlissBlind,
} from './config';
import rp from 'request-promise';
import { SilentGlissGatewayPlatform } from './platform';
import { MYSMARTBLINDS_QUERIES } from './settings';

export class SilentGlissBlindsAccessory {
  service!: Service;
  name: string;
  model: string;
  serialNumber: string;
  platform: SilentGlissGatewayPlatform;
  accessory: PlatformAccessory;
  verboseDebug: boolean;
	_currentPosition: number;
	_moveStatus: number;

  constructor(
    platform: SilentGlissGatewayPlatform,
    accessory: PlatformAccessory,
  ) {
    this.platform = platform;
    this.name = accessory.context.blind.name;
    this.model = accessory.context.blind.model;
    this.serialNumber = accessory.context.blind.serialNumber;
    this.verboseDebug = platform.config.verboseDebug || false;
		this._currentPosition = accessory.context.blind.blindPosition;
		this._moveStatus = accessory.context.blind.moveStatus;

		this.platform.registerListenerForUUID(accessory.UUID, this.callBack.bind(this));

    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Silent Gliss')
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.serialNumber);

    this.service = accessory.getService(this.platform.Service.WindowCovering) || accessory.addService(this.platform.Service.WindowCovering);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.name);

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .on('set', this.setTargetPosition.bind(this));
    //this.updatePosition(accessory.context.blind.blindPosition);
    
    this.accessory = accessory;

  }

	callBack(value: SilentGlissBlind) {

		let currentPosition = Number(value.pos_percent);
		if (currentPosition !== this._currentPosition) {
			if (this.verboseDebug) {
				this.platform.log.info(`Status Update: ${this.name} Current Position : ${currentPosition}%`);
			}
			this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, currentPosition); // do we need to update this?
			this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);

			if (currentPosition > this._currentPosition) {
				this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.DECREASING);
				if (this.verboseDebug) {
					this.platform.log.info(`Status Update: ${this.name} Position State : DECREASING`);
				}
				
			} else if (currentPosition < this._currentPosition) {
				this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.INCREASING);
				if (this.verboseDebug) {
					this.platform.log.info(`Status Update: ${this.name} Position State : INCREASING`);
				}

			} else {
				this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);
				if (this.verboseDebug) {
					this.platform.log.info(`Status Update: ${this.name} Position State : STOPPED`);
				}

			}
			this._currentPosition = currentPosition;
		}



    
	}

  updatePosition(currentPosition: number) {

    if (this.verboseDebug) {
      //this.platform.log.info(`STATUS: ${this.name} updateCurrentPosition : ${currentPosition}`);
    }

    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, currentPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);
  }

  setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const targetPosition = value as number;
    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, targetPosition);

    this.platform.log.info(`${this.name} setTargetPosition to ${value}`);

		/*
    rp(Object.assign(
      {},
      this.platform.requestOptions,
      {
        body: {
          query: MYSMARTBLINDS_QUERIES.UpdateBlindsPosition,
          variables: { position: this.closeUp ? (Math.abs(targetPosition - 200)) : targetPosition, blinds: this.serialNumber },
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

			*/
  }

}
