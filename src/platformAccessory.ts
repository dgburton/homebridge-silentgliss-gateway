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

		this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, accessory.context.blind.blindPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, accessory.context.blind.blindPosition);
    this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);
    
    this.accessory = accessory;

  }

	callBack(value: SilentGlissBlind) {

		try {

			//this.platform.log.info(`${this.name} ${JSON.stringify(value)} `);

			let currentPosition = parseInt((Number(value.pos_percent) / 10).toString());
			let moveStatus = Number(value.move_status);

			//console.log("moveStatus", moveStatus);

			if (moveStatus !== this._moveStatus) {
				if (moveStatus === 4) {
					// blind stopped
					this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, currentPosition);
					this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
					this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);
					this.platform.log.info(`${this.name} Move Status: STOPPED, Current Position: ${currentPosition}`);

				} else if (moveStatus === 2) {
					// blind going down
					this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.INCREASING);
					this.platform.log.info(`${this.name} Move Status: INCREASING, Current Position: ${currentPosition}`);

				} else if (moveStatus === 1) {
					// blind going up
					this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.DECREASING);
					this.platform.log.info(`${this.name} Move Status: DECREASING, Current Position: ${currentPosition}`);

				}

				this._moveStatus = moveStatus;

			} else if (currentPosition !== this._currentPosition) {
				//this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, currentPosition);
				this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
				this.platform.log.info(`${this.name} Move Status: NOT CHANGED BUT CURRENT POSITION CHANGED, Old Current Position ${this._currentPosition}, New Current Position: ${currentPosition}`);
				this._currentPosition = currentPosition;
			}

			if (currentPosition !== this._currentPosition) {

				/*				
				this._currentPosition = currentPosition;

				this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, currentPosition);
				this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
				this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);

				if (this.verboseDebug) {
					this.platform.log.info(`Status Update: ${this.name} Current Position : ${currentPosition}%`);
				}
				*/


				/*


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
				*/

			} else {
				//this.platform.log.info(`_currentPosition: ${this._currentPosition} equals currentPosition : ${currentPosition}%`);
			}



			
		} catch(e) {
			console.error('callback error', e);
		}

	}


  setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const targetPosition = value as number;

		this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, targetPosition);

		this.platform.queueMoveTo(this.accessory.context.blind.id, targetPosition);

		//this.platform.log.info(`${this.name} setTargetPosition to ${value}`);

		callback(null);

  }

}



