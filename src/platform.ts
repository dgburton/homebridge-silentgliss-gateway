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
  MySmartBlindsAuth,
  MySmartBlindsBlind,
} from './config';
import { MySmartBlindsAccessory } from './platformAccessory';

export class MySmartBlindsBridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  auth!: MySmartBlindsAuth;
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

    try {
      if (!this.config.address) {
        throw new Error('Silent Gliss Gateway - You must provide an address');
      }
      this.address = this.config.address;
    } catch(err) {
      //this.log.error(err);
    }

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

      if (this.config.allowDebug) {
        const authTokenExpireDate = new Date((jwt.decode(response.id_token || '{ exp: 0 }') as { exp: number }).exp * 1000).toISOString();
        this.log.info(`authToken refresh, now expires ${authTokenExpireDate}`);
      }
    });
  }

  convertPosition(blindPosition: string) {
    let convertedPosition = parseInt(blindPosition);

    if (this.config.closeUp && convertedPosition > 100) {
      convertedPosition = Math.abs(convertedPosition - 200);
    }
    return convertedPosition;
  }

  discoverDevices() {
    this.refreshAuthToken().then(() => {
      this.authTokenInterval = setInterval(this.refreshAuthToken.bind(this), 1000 * 60 * 60 * 8);
      rp(Object.assign({}, this.requestOptions, { body: { query: MYSMARTBLINDS_QUERIES.GetUserInfo, variables: null } }))
        .then((response) => {
          if (this.config.allowDebug) {
            this.log.debug('GetUserInfo', response.data.user);
          }
          const {
            rooms,
            blinds,
          } = response.data.user;

          const activeBlinds = blinds.filter((blind: MySmartBlindsBlind) => !blind.deleted);
          const deletedBlinds = blinds.filter((blind: MySmartBlindsBlind) => blind.deleted);

          activeBlinds.forEach((blind: MySmartBlindsBlind) => {
            const uuid = this.api.hap.uuid.generate(blind.encodedMacAddress);
            const blindName = `${rooms.find((room: { id: number }) => room.id === blind.roomId).name} ${blind.name}`;

            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
            if (existingAccessory) {
              this.log.debug('Restore cached blind:', blindName);
              new MySmartBlindsAccessory(this, existingAccessory);
              this.api.updatePlatformAccessories([existingAccessory]);
            } else {
            // the accessory does not yet exist, so we need to create it
              this.log.info('Adding new blind:', blindName);
        
              // create a new accessory
              const accessory = new this.api.platformAccessory(blindName, uuid);
              rp(Object.assign(
                {},
                this.requestOptions,
                { body: { query: MYSMARTBLINDS_QUERIES.GetBlindSate, variables: { blinds: blind.encodedMacAddress } } },
              )).then((response) => {
                const blindState = get(response, 'data.blindsState[0]', { position: 0, batteryLevel: 0 });

                if (blindState.batteryLevel <= 0) {
                  this.log.error(`${blindName} state fetch failed.  Do you have the Hardware bridge? Is the battery charged?`);
                }

                const homeKitBlindPosition = this.convertPosition(blindState.position);
                accessory.context.blind = {
                  name: blindName,
                  macAddress: blind.encodedMacAddress,
                  blindPosition: homeKitBlindPosition,
                  batteryLevel: blindState.batteryLevel as number,
                };
        
                new MySmartBlindsAccessory(this, accessory);
        
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
              }).catch((error) => this.log.error(error));
            }
          });
          deletedBlinds.forEach((blind) => {
            const uuid = this.api.hap.uuid.generate(blind.encodedMacAddress);
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
            const inActive = activeBlinds.findIndex(
              (activeBlind: MySmartBlindsBlind) => blind.encodedMacAddress === activeBlind.encodedMacAddress,
            ) > -1;

            if (existingAccessory && !inActive) {
              this.accessories.splice(this.accessories.findIndex(acc => acc.UUID === existingAccessory.UUID), 1);
              this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
              this.log.info('Deleted blind from cache:', existingAccessory.displayName);
            }
          });
        });
    });
  }
}
