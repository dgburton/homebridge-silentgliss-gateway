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
  homekitInitiatedMoveInProgress: boolean;
  homekitInitiatedMoveInProgressStartTime: number;
  homekitInitiatedMoveInProgressTimeout?: NodeJS.Timeout;
  verboseDebug: boolean;
  _currentPosition: number;
  _moveStatus: number;

  constructor(
    platform: SilentGlissGatewayPlatform,
    accessory: PlatformAccessory,
  ) {
	this.homekitInitiatedMoveInProgress = false;
	this.homekitInitiatedMoveInProgressStartTime = 0;
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

			let currentPosition = parseInt((Math.ceil(Number(value.pos_percent) / 10)).toString());
			let moveStatus = Number(value.move_status);

			if ( (moveStatus === 4) && (this.homekitInitiatedMoveInProgress === true) ) {

				let delta = (new Date().getTime() - this.homekitInitiatedMoveInProgressStartTime);

				if (delta > 3000) {

					this.homekitInitiatedMoveInProgress = false;	
					this.platform.log.info(`${this.name} Homekit initiated move timeout ENDED BECAUSE RECEIVED 'STOPPED' FROM SG GATEWAY. Delta ${delta}`);
					clearTimeout(this.homekitInitiatedMoveInProgressTimeout);
				} else {
					this.platform.log.info(`${this.name} Homekit initiated move timeout ENDED BECAUSE RECEIVED 'STOPPED' FROM SG GATEWAY ** BUT ** IGNORED AS IS WITHIN 3s DELTA. Delta ${delta}`);
				}
			}

			if (this.homekitInitiatedMoveInProgress) {
				this.platform.log.info(`${this.name} State update skipped as homekitInitiatedMoveInProgress=true`);

			} else {

				//this.platform.log.info(`${this.name} ${JSON.stringify(value)} `);



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
						this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.DECREASING);
						this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, 0);
						this.platform.log.info(`${this.name} Move Status: DECREASING, Current Position: ${currentPosition}`);

					} else if (moveStatus === 1) {
						// blind going up
						this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.INCREASING);
						this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, 100);
						this.platform.log.info(`${this.name} Move Status: INCREASING, Current Position: ${currentPosition}`);

					}

					this._moveStatus = moveStatus;

				} else if (currentPosition !== this._currentPosition) {
					this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
					this.platform.log.info(`${this.name} Move Status: NOT CHANGED BUT CURRENT POSITION CHANGED, Old Current Position ${this._currentPosition}, New Current Position: ${currentPosition}`);
					this._currentPosition = currentPosition;
				}

			}



			
		} catch(e) {
			console.error('callback error', e);
		}

	}

	setHomekitInitiatedMoveInProgressFalse() {

		this.homekitInitiatedMoveInProgress = false;
		this.platform.log.info(`${this.name} Homekit initiated move timeout ENDED`);

		clearTimeout(this.homekitInitiatedMoveInProgressTimeout);
	}

  setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const targetPosition = value as number;

	// pause state updates for the duration of this move
	this.homekitInitiatedMoveInProgress = true;
	this.homekitInitiatedMoveInProgressStartTime = new Date().getTime();
	if (this.homekitInitiatedMoveInProgressTimeout) {
		clearTimeout(this.homekitInitiatedMoveInProgressTimeout);
  	}
	this.homekitInitiatedMoveInProgressTimeout = setTimeout(this.setHomekitInitiatedMoveInProgressFalse.bind(this), 25000); // maximum travel-time is 17 seconds, so use 25 for some margin. Biggest blind is the Landing

	this.platform.log.info(`${this.name} Homekit initiated move timeout STARTED`);

	this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, targetPosition);

	if (targetPosition < this._currentPosition) {
		this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.DECREASING);
		this._moveStatus = 2;
		this.platform.log.info(`${this.name} Move Status via Homekit: DECREASING`);
	} else if (targetPosition > this._currentPosition) {
		this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.INCREASING);
		this._moveStatus = 1;
		this.platform.log.info(`${this.name} Move Status via Homekit: INCREASING`);
	}

	this.platform.queueMoveTo(this.accessory.context.blind.id, targetPosition);

	//this.platform.log.info(`${this.name} setTargetPosition to ${value}`);

	callback(null);

  }

}



