import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { SilentGlissGatewayPlatform } from './platform'; 

export = (api: API) => {
	console.log("asdasdasjdkkljasd lkasjdklajsd - " + PLATFORM_NAME)
  api.registerPlatform(PLATFORM_NAME, SilentGlissGatewayPlatform);
};
