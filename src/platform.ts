import rp from 'request-promise';
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
  PLATFORM_NAME,
  PLUGIN_NAME,
  STATE_REFRESH_INTERVAL_MS,
} from './settings';
import {
  SilentGlissConfig,
  SilentGlissBlind,
} from './config';
import { SilentGlissBlindsAccessory } from './platformAccessory';
import { CommandBatcher, MoveRequest } from './commandBatcher';
import {
  canonicalKind,
  collectGroupCandidates,
  ControllerAction,
  groupSignature,
  managedGroupName,
  MotorMetadata,
  NativeGroup,
  planControllerActions,
} from './controllerCommands';

export class SilentGlissGatewayPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  address!: string;
  updateStateTimeout?: NodeJS.Timeout;
  uuidCallbacks!: Record<string, (value: SilentGlissBlind) => void>;
  private readonly commandBatcher: CommandBatcher;
  private readonly motorMetadata = new Map<string, MotorMetadata>();
  private nativeGroups: NativeGroup[] = [];
  private readonly groupCandidateCounts = new Map<string, number>();
  private lastStateErrorLogAt = 0;
  
  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & SilentGlissConfig,
    public readonly api: API,
  ) {
    this.commandBatcher = new CommandBatcher(this.flushMoveRequests.bind(this), {
      onError: (error, requests) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error(`Failed to send ${requests.length} Silent Gliss move request(s): ${message}`);
      },
    });

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
      this.discoverDevices();
      void this.refreshNativeGroups();

      this.updateStateTimeout = setTimeout(this.updateState.bind(this), STATE_REFRESH_INTERVAL_MS);

    });

    this.api.on('shutdown', () => this.commandBatcher.dispose());
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
					this.logStateRefreshError(errInner);
					this.updateStateTimeout = setTimeout(this.updateState.bind(this), (STATE_REFRESH_INTERVAL_MS * 5));
				}
	
			}).catch((e) => {
				this.logStateRefreshError(e);
				this.updateStateTimeout = setTimeout(this.updateState.bind(this), (STATE_REFRESH_INTERVAL_MS * 5));
	
			});
		} catch(err) {
			this.logStateRefreshError(err);
			if (this.updateStateTimeout) {
				clearTimeout(this.updateStateTimeout);
			}
			this.updateStateTimeout = setTimeout(this.updateState.bind(this), (STATE_REFRESH_INTERVAL_MS * 5));
		}


		
  }

  private logStateRefreshError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastStateErrorLogAt < 30000) {
      return;
    }

    this.lastStateErrorLogAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.log.warn(`Silent Gliss state refresh failed; retrying: ${message}`);
  }

  configureAccessory(accessory: PlatformAccessory) {
    //this.log.info('Loading blind from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {

		/*
		// 155654433221 <-- code to remove a blind with this serial number (in the case of a motor being replaced)
		for (let i = 0; i < 100; i++) {

			const uuidToRemove = this.api.hap.uuid.generate(`${i}`);
			const existingAccessoryToRemove = this.accessories.find(accessory => accessory.UUID === uuidToRemove);
			if (existingAccessoryToRemove) {
				if (existingAccessoryToRemove.context.blind.serialNumber === "155654433221") {
					console.error("****** REMOVE THIS BLIND: " + JSON.stringify(existingAccessoryToRemove.context.blind));
					this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessoryToRemove]);
				}
			} else {
				//console.error("REMOVE THIS BLIND: existingAccessoryToRemove not found with UUID: " + uuidToRemove);
			}

		}
		*/


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
													this.log.debug('deletedBlinds', deletedBlinds);
												}

												activeBlinds.forEach((blind: SilentGlissBlind) => {

													const uuid = this.api.hap.uuid.generate(blind.id);

													const glue = glues.find((g: { mid: string }) => g.mid === blind.id);
													const location = locations.find((l: { id: string }) => l.id === glue.lid);
													const motorInfo = mfixed.find((mi: { id: string }) => mi.id === blind.id);
													const room = rooms.find((g: { id: string }) => g.id === location.rid);

													if (this.config.verboseDebug) {
														console.log("blind", blind);
														console.log("motorInfo", motorInfo);
														console.log("glue", glue);
														console.log("location", location);
														console.log("room", room);
													}

													const blindName = `${room.name} ${location.name}`;
													this.motorMetadata.set(blind.id, {
														motorId: blind.id,
														locationId: Number(location.id),
														room: room.name,
														kind: canonicalKind(location.name),
													});
													if (this.config.verboseDebug) {
														console.log(`${uuid} - ${blind.id} - ${blindName}`);
													}

													const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
													if (existingAccessory) {
														this.log.debug('Restore cached blind:', blindName);

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
													const uuid = this.api.hap.uuid.generate(blind.id);
													const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

													if (existingAccessory) {
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

  queueMoveTo(id: string, value: number, requiresMove = true): void {
    this.commandBatcher.queue({
      motorId: String(id),
      targetPosition: Number(value),
      requiresMove,
    });
  }

  private async flushMoveRequests(requests: MoveRequest[]): Promise<void> {
    const plan = planControllerActions(requests, this.nativeGroups, this.motorMetadata);

    if (plan.actions.length > 0) {
      await this.sendControllerActions(plan.actions);
      this.log.debug(
        `Sent ${requests.length} covering request(s) as ${plan.actions.length} controller action(s) ` +
        `using ${plan.groupIds.length} native group(s)`,
      );
    }

    if (this.config.autoGroups !== false) {
      try {
        await this.learnNativeGroups(requests);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Could not learn Silent Gliss groups: ${message}`);
      }
    }
  }

  private async sendControllerActions(actions: ControllerAction[]): Promise<void> {
    const body = `command=${JSON.stringify(actions)}\r\n`;
    await rp({
      method: 'POST',
      uri: `http://${this.config.address}/command.jcf`,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': body.length,
      },
      body,
      timeout: 5000,
    });
  }

  private async refreshNativeGroups(): Promise<void> {
    if (!this.config.address) {
      return;
    }

    try {
      const response = await rp({
        uri: `http://${this.config.address}/group.json`,
        timeout: 5000,
      });
      const parsed = JSON.parse(response).group ?? [];
      this.nativeGroups = parsed.map((group: { id: string; name: string; lid: number[] }) => ({
        id: Number(group.id),
        name: group.name,
        locationIds: group.lid.map(Number),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Could not refresh Silent Gliss groups: ${message}`);
    }
  }

  private async learnNativeGroups(requests: MoveRequest[]): Promise<void> {
    const candidates = collectGroupCandidates(requests, this.motorMetadata);

    for (const candidate of candidates) {
      const alreadyExists = this.nativeGroups.some(group =>
        groupSignature(group.locationIds) === candidate.signature,
      );
      if (alreadyExists) {
        this.groupCandidateCounts.delete(candidate.signature);
        continue;
      }

      const observationCount = (this.groupCandidateCounts.get(candidate.signature) ?? 0) + 1;
      this.groupCandidateCounts.set(candidate.signature, observationCount);
      if (observationCount < candidate.threshold) {
        continue;
      }

      if (this.nativeGroups.length >= 64) {
        this.log.warn('Silent Gliss group capacity reached; continuing with multi-motor command arrays');
        return;
      }

      const usedIds = new Set(this.nativeGroups.map(group => group.id));
      let groupId = 1;
      while (usedIds.has(groupId) && groupId <= 64) {
        groupId++;
      }
      if (groupId > 64) {
        return;
      }

      const name = managedGroupName(candidate);
      const payload = [{ id: groupId, name, lid: candidate.locationIds }];
      const body = `group=${JSON.stringify(payload)}`;
      await rp({
        method: 'POST',
        uri: `http://${this.config.address}/command.jcf`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': body.length,
        },
        body,
        timeout: 5000,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      await this.refreshNativeGroups();
      const created = this.nativeGroups.some(group =>
        group.id === groupId && groupSignature(group.locationIds) === candidate.signature,
      );
      if (!created) {
        throw new Error(`controller did not persist group ${groupId}`);
      }

      this.groupCandidateCounts.delete(candidate.signature);
      this.log.info(`Created managed Silent Gliss group ${name} with ${candidate.locationIds.length} covering(s)`);
    }
  }

}
