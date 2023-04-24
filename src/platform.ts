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
  MYSMARTBLINDS_DOMAIN,
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

export class SilentGlissGatewayPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
	address!: string;
  authToken!: string | undefined;
  authTokenInterval?: NodeJS.Timeout;
  requestOptions!: {
    method: string;
    uri: string;
    body?: {
      query: string;
      variables: {
        position: string;
        blinds: string;
      };
    };
    json: boolean;
    headers: {
      Authorization: string;
    };
  };
  
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
    this.config = config;
    this.log = log;

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading blind from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

	/*
  refreshAuthToken() {
    return rp({
      method: 'POST',
      uri: `https://${MYSMARTBLINDS_DOMAIN}/oauth/ro`,
      json: true,
      body: Object.assign({}, MYSMARTBLINDS_OPTIONS, this.auth),
    }).then((response) => {
      this.authToken = response.id_token;
      this.requestOptions = {
        method: 'POST',
        uri: MYSMARTBLINDS_GRAPHQL,
        json: true,
        headers: Object.assign({}, MYSMARTBLINDS_HEADERS, { Authorization: `Bearer ${this.authToken}` }),
      };

      if (this.config.verboseDebug) {
        const authTokenExpireDate = new Date((jwt.decode(response.id_token || '{ exp: 0 }') as { exp: number }).exp * 1000).toISOString();
        this.log.info(`authToken refresh, now expires ${authTokenExpireDate}`);
      }
    });
  }
	*/

  convertPosition(blindPosition: string) {
    let convertedPosition = parseInt(blindPosition);

    if (this.config.closeUp && convertedPosition > 100) {
      convertedPosition = Math.abs(convertedPosition - 200);
    }
    return convertedPosition;
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
														this.log.debug('Restore cached blind:', blindName);
														new SilentGlissBlindsAccessory(this, existingAccessory);
														this.api.updatePlatformAccessories([existingAccessory]);
													} else {
														// the accessory does not yet exist, so we need to create it
														this.log.info('Adding new blind:', blindName);
											
														// create a new accessory
														const accessory = new this.api.platformAccessory(blindName, uuid);

														//const homeKitBlindPosition = this.convertPosition(blindState.position);
														accessory.context.blind = {
															name: blindName,
															id: blind.id,
															blindPosition: blind.pos_percent,
															model: motorInfo.model,
															serialNumber: motorInfo.serial
														};
										
														new SilentGlissBlindsAccessory(this, accessory);
										
														this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

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
}
