import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
} from 'homebridge';
import {
  SilentGlissBlind,
} from './config';
import { SilentGlissGatewayPlatform } from './platform';

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

			const currentPosition = parseInt((Math.ceil(Number(value.pos_percent) / 10)).toString());
			const moveStatus = Number(value.move_status);

			if ( (moveStatus === 4) && (this.homekitInitiatedMoveInProgress === true) ) {

				const delta = (new Date().getTime() - this.homekitInitiatedMoveInProgressStartTime);

				if (delta > 3000) {

					this.homekitInitiatedMoveInProgress = false;	
					this.platform.log.debug(`${this.name} HomeKit move completed after ${delta}ms`);
					clearTimeout(this.homekitInitiatedMoveInProgressTimeout);
				}
			}

			if (this.homekitInitiatedMoveInProgress) {
				return;

			} else {

				//this.platform.log.info(`${this.name} ${JSON.stringify(value)} `);



				//console.log("moveStatus", moveStatus);

				if (moveStatus !== this._moveStatus) {
					if (moveStatus === 4) {
						// blind stopped
						this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, currentPosition);
						this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
						this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.STOPPED);
						this.platform.log.debug(`${this.name} stopped at ${currentPosition}%`);

					} else if (moveStatus === 2) {
						// blind going down
						this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.DECREASING);
						this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, 0);
						this.platform.log.debug(`${this.name} decreasing from ${currentPosition}%`);

					} else if (moveStatus === 1) {
						// blind going up
						this.service.updateCharacteristic(this.platform.Characteristic.PositionState, this.platform.Characteristic.PositionState.INCREASING);
						this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, 100);
						this.platform.log.debug(`${this.name} increasing from ${currentPosition}%`);

					}

					this._moveStatus = moveStatus;

				} else if (currentPosition !== this._currentPosition) {
					this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, currentPosition);
				}

				this._moveStatus = moveStatus;
				this._currentPosition = currentPosition;

			}



			
		} catch(e) {
			const message = e instanceof Error ? e.message : String(e);
			this.platform.log.error(`Silent Gliss callback error for ${this.name}: ${message}`);
		}

	}

	setHomekitInitiatedMoveInProgressFalse() {

		this.homekitInitiatedMoveInProgress = false;
		this.platform.log.debug(`${this.name} HomeKit move guard timed out`);

		clearTimeout(this.homekitInitiatedMoveInProgressTimeout);
	}

  setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const targetPosition = value as number;
    const requiresMove = targetPosition !== this._currentPosition || this._moveStatus !== 4;

    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, targetPosition);

    if (!requiresMove) {
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, this._currentPosition);
      this.service.updateCharacteristic(
        this.platform.Characteristic.PositionState,
        this.platform.Characteristic.PositionState.STOPPED,
      );
      this.platform.queueMoveTo(this.accessory.context.blind.id, targetPosition, false);
      callback(null);
      return;
    }

    // Pause state updates for the duration of this move.
    this.homekitInitiatedMoveInProgress = true;
    this.homekitInitiatedMoveInProgressStartTime = new Date().getTime();
    if (this.homekitInitiatedMoveInProgressTimeout) {
      clearTimeout(this.homekitInitiatedMoveInProgressTimeout);
    }
    // Maximum travel time is 17 seconds, with extra margin for the Landing blind and batching delay.
    this.homekitInitiatedMoveInProgressTimeout = setTimeout(
      this.setHomekitInitiatedMoveInProgressFalse.bind(this),
      25000,
    );

    if (targetPosition < this._currentPosition) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.PositionState,
        this.platform.Characteristic.PositionState.DECREASING,
      );
      this._moveStatus = 2;
      this.platform.log.debug(`${this.name} HomeKit target decreasing to ${targetPosition}%`);
    } else if (targetPosition > this._currentPosition) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.PositionState,
        this.platform.Characteristic.PositionState.INCREASING,
      );
      this._moveStatus = 1;
      this.platform.log.debug(`${this.name} HomeKit target increasing to ${targetPosition}%`);
    }

    this.platform.queueMoveTo(this.accessory.context.blind.id, targetPosition, true);
    callback(null);

  }

}
