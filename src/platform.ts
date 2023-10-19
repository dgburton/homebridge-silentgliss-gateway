import rp from 'request-promise';
import jwt from 'jsonwebtoken';
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import {
  get,
} from 'lodash';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  STATE_REFRESH_INTERVAL_MS,
  MYSMARTBLINDS_OPTIONS,
  MYSMARTBLINDS_HEADERS,
  MYSMARTBLINDS_GRAPHQL,
  MYSMARTBLINDS_QUERIES,
} from './settings';
import {
  SilentGlissConfig,
  SilentGlissBlind,
} from './config';
import { SilentGlissBlindsAccessory } from './platformAccessory';

const ADD_ACCESSORIES = false;

export class SilentGlissGatewayPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
	address!: string;
  updateStateTimeout?: NodeJS.Timeout;
	uuidCallbacks!: object;
	commandQueue: object[] = [];
  flushCommandQueueTimeout?: NodeJS.Timeout;
  
  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & SilentGlissConfig,
    public readonly api: API,
  ) {
    /* plugin not configured check */
    if (!config) {
      this.log.info('No configuration found for platform ', PLATFORM_NAME);
      return;
    }

    /* setup config */
		this.uuidCallbacks = {};
    this.config = config;
    this.log = log;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      if (ADD_ACCESSORIES) {
        this.log.debug('ADD_ACCESSORIES=true so running discoverDevices...');
        this.discoverDevices();
      } else {
        this.log.debug('ADD_ACCESSORIES=false so skipping discoverDevices...');
      }

			this.updateStateTimeout = setTimeout(this.updateState.bind(this), STATE_REFRESH_INTERVAL_MS);

    });
  }
	
  updateState() {

		//this.log.info('updateState.start');

		clearTimeout(this.updateStateTimeout);

		try {
			rp({
				uri: `http://${this.config.address}/motor_status.json`,
				timeout: 5000
			  })
			.then((response) => {

				//this.log.info('updateState.complete');

				try {
		
					const mstatus = JSON.parse(response).mstatus;
		
					const activeBlinds = mstatus.filter((blind: SilentGlissBlind) => blind.visible === '1');
		
					activeBlinds.forEach((blind) => {
						const uuid = this.api.hap.uuid.generate(blind.id);
						const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)
		
						if (existingAccessory) {
							//this.log.info('Found existing blind from state:', existingAccessory.displayName);
		
							//let func = this.uuidCallbacks[existingAccessory.UUID];
		
							//console.log("func", func);
		
							//console.log("this.uuidCallbacks",this.uuidCallbacks)
		
							if (this.uuidCallbacks[existingAccessory.UUID])
								this.uuidCallbacks[existingAccessory.UUID](blind);
		
							//this.log.info(this.uuidCallbacks?[existingAccessory.UUID]);
		
							//existingAccessory.updatePosition(Number(blind.pos_percent) / 10);
		
						}
					});
		
					/*if (this.config.verboseDebug) {
		
						console.log("mstatus", mstatus)
						const activeBlinds = mstatus.filter((blind: SilentGlissBlind) => blind.visible === '1');
						this.log.debug('updateState.activeBlinds', activeBlinds);
		
					}*/
		
					this.updateStateTimeout = setTimeout(this.updateState.bind(this), STATE_REFRESH_INTERVAL_MS);

				} catch(errInner) {
					this.log.error('updateState.innerError', errInner);
				}
	
			}).catch((e) => {
				this.log.error('updateState.innerError', e);
				this.updateStateTimeout = setTimeout(this.updateState.bind(this), (STATE_REFRESH_INTERVAL_MS * 5));
	
			});
		} catch(err) {
			this.log.error('updateState.outerError', err);
			if (this.updateStateTimeout) {
				clearTimeout(this.updateStateTimeout);
			}
			this.updateStateTimeout = setTimeout(this.updateState.bind(this), (STATE_REFRESH_INTERVAL_MS * 5));
		}


		
  }

  configureAccessory(accessory: PlatformAccessory) {
    //this.log.info('Loading blind from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {

		rp(`http://${this.config.address}/room.json`)
			.then((response) => {
				const rooms = JSON.parse(response).room;
				rp(`http://${this.config.address}/location.json`)
					.then((response) => {
						const locations = JSON.parse(response).location;
						rp(`http://${this.config.address}/glue.json`)
							.then((response) => {
								const glues = JSON.parse(response).glue;
								rp(`http://${this.config.address}/motor_fixed.json`)
									.then((response) => {
										const mfixed = JSON.parse(response).mfixed;
										rp(`http://${this.config.address}/motor_status.json`)
											.then((response) => {
												const mstatus = JSON.parse(response).mstatus;

												const activeBlinds = mstatus.filter((blind: SilentGlissBlind) => blind.visible === '1');
												const deletedBlinds = mstatus.filter((blind: SilentGlissBlind) => blind.visible === '0');

												if (this.config.verboseDebug) {
													//this.log.debug('activeBlinds', activeBlinds);
													//this.log.debug('deletedBlinds', deletedBlinds);
												}

												activeBlinds.forEach((blind: SilentGlissBlind) => {

													const uuid = this.api.hap.uuid.generate(blind.id);

													const glue = glues.find((g: { mid: string }) => g.mid === blind.id);
													const location = locations.find((l: { id: string }) => l.id === glue.lid);
													const motorInfo = mfixed.find((mi: { id: string }) => mi.id === blind.id);

													if (this.config.verboseDebug) {
														//console.log("blind", blind);
														//console.log("motorInfo", motorInfo);
														//console.log("glue", glue);
														//console.log("location", location);
													}

													const blindName = `${location.name}`;
													if (this.config.verboseDebug) {
														//console.log(`${uuid} - ${blind.id} - ${blindName}`);
													}

													const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
													if (existingAccessory) {
														//this.log.debug('Restore cached blind:', blindName);

														existingAccessory.context.blind = {
															name: blindName,
															id: blind.id,
															blindPosition: parseInt((Math.ceil(Number(blind.pos_percent) / 10)).toString()),
															moveStatus: Number(blind.move_status),
															model: motorInfo.model,
															serialNumber: motorInfo.serial
														};

														new SilentGlissBlindsAccessory(this, existingAccessory);

														this.api.updatePlatformAccessories([existingAccessory]);

													} else {
														// the accessory does not yet exist, so we need to create it

														//if ( (glue.mid === "34") || (glue.mid === "39") ) {
														this.log.info('Adding new blind:', blindName);
											
														// create a new accessory
														const accessory = new this.api.platformAccessory(blindName, uuid);

														//const homeKitBlindPosition = this.convertPosition(blindState.position);
														accessory.context.blind = {
															name: blindName,
															id: blind.id,
															blindPosition: parseInt((Math.ceil(Number(blind.pos_percent) / 10)).toString()),
															moveStatus: Number(blind.move_status),
															model: motorInfo.model,
															serialNumber: motorInfo.serial
														};
										
														new SilentGlissBlindsAccessory(this, accessory);
										
														this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
														//}

													}


												});

												/*
												deletedBlinds.forEach((blind) => {
													const uuid = this.api.hap.uuid.generate(blind.encodedMacAddress);
													const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
													const inActive = activeBlinds.findIndex(
														(activeBlind: SilentGlissBlind) => blind.encodedMacAddress === activeBlind.encodedMacAddress,
													) > -1;

													if (existingAccessory && !inActive) {
														this.accessories.splice(this.accessories.findIndex(acc => acc.UUID === existingAccessory.UUID), 1);
														this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
														this.log.info('Deleted blind from cache:', existingAccessory.displayName);
													}
												});
												*/
											
											});
									});
							});
					});
			});
  }

	registerListenerForUUID(uuid, callback) {
		if (this.uuidCallbacks) {
			this.uuidCallbacks[uuid] = callback;
		}
	}

	queueMoveTo(id, value) {

		// clear the existing timeout
		clearTimeout(this.flushCommandQueueTimeout);

		// add this command to the queue
		this.commandQueue.push(
			{
				command: 'moveto', 
				id: id, 
				value: value
			});

		this.flushCommandQueueTimeout = setTimeout(this.flushCommandQueue.bind(this), 250);

	}

	async flushCommandQueue() {

		let cmdQueue = JSON.parse(JSON.stringify(this.commandQueue));
		this.commandQueue = [];

		console.log("commandQueue: " + JSON.stringify(cmdQueue));

		let body = '';
		
		for (let cmd of cmdQueue) {
			if (cmd['command'] === 'moveto') {
				// SilentGliss firmward v1.5.8 now expects a value between 0 and 1000 for the "position", instead of 0 to 100
				body += `command=[{"action":"moveto","mid":${cmd['id']},"position":"${Number(cmd['value']) * 10}"}]\r\n`;
			}
		}

		if (body.length > 0) {

			console.log('command', body)
			
			await rp(
				{
					method: 'POST',
					uri: `http://${this.config.address}/command.jcf`,
					headers: {
						'Content-Type': 'text/plain',
						'Content-Length': body.length
					},
					body: body,
				}
			)
				.then((response) => {

					

					// update current position
					//this.updatePosition(targetPosition);
					
					//this.platform.log.info(`${this.name} currentPosition is now ${targetPosition}`);
				
				})
				.catch((err) => {
					this.log.error(`flushCommandQueue ERROR`, err.statusCode);
				});
		}



	}

}
