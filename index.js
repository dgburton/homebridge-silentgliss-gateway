const auth0 = require('auth0');
const rp = require('request-promise');
const _ = require('lodash');
var auth0Token;

const smartblinds_auth = {
  domain: 'mysmartblinds.auth0.com',
  clientId: '1d1c3vuqWtpUt1U577QX5gzCJZzm8WOB',
};

const smartblinds_options = {
  device: 'smartblinds_client',
  scope: "openid offline_access",
  realm: 'Username-Password-Authentication',
}

const smartblindsGraphQL = 'https://api.mysmartblinds.com/v1/graphql';

function MySmartBlindsBridge(log, config) {
  /* setup config */
	this.config = config;
	this.username = config["username"];
	this.password = config["password"];

	this.log = log;

	if (!this.username) throw new Error('MySmartBlinds Bridge - You must provide a username');
	if (!this.password) throw new Error('MySmartBlinds Bridge - You must provide a password');
}

MySmartBlindsBridge.prototype = {
  accessories: function(callback) {
    this.log('Looking for blinds...');
    var platform = this;
    const foundBlinds = [];

    const authenticationClient = new auth0.AuthenticationClient(
      smartblinds_auth
    );
    authenticationClient.database.signIn(
      Object.assign(
        {},
        smartblinds_options,
        { username: platform.username, password: platform.password }
      ),
      function(err, authResult) {
        if (err) {
          platform.log(err);
        } else {
          auth0Token = authResult.id_token;
          const options = {
            method: 'POST',
            uri: smartblindsGraphQL,
            body: {
            query: `
              query GetUserInfo {
                user {
                  rooms {
                    id
                    name
                    deleted
                  }
                  blinds {
                    name
                    encodedMacAddress
                    roomId
                    deleted
                  }
                }
              }
            `,
              variables: null,
            },
            json: true,
            headers: {
              Authorization: `Bearer ${auth0Token}`
            }
          };
          rp(options)
          .then(function (parsedBody) {
            const {
              rooms,
              blinds,
            }= parsedBody.data.user;

            const blindPromise = [];
            blinds.forEach((blind) => {
              if (!blind.deleted) {
                const blind_options = {
                  method: 'POST',
                  uri: 'https://api.mysmartblinds.com/v1/graphql',
                  body: {
                    query: `
                      query GetBlindsState($blinds: [String]) {
                        blindsState(encodedMacAddresses: $blinds) {
                          encodedMacAddress
                          position
                          rssi
                          batteryLevel
                        }
                      }
                    `,
                    variables: { blinds: blind.encodedMacAddress },
                  },
                  json: true,
                  headers: {
                    Authorization: `Bearer ${auth0Token}`,
                  }
                };
                blindPromise.push(
                  rp(blind_options)
                  .then(function (parsedBody) {
                    const blindState = parsedBody.data.blindsState[0];
                    const homeKitBlindPercent = parseInt(blindState.position);
                    var accessory = new MySmartBlindsBridgeAccessory(platform.log,platform.config,
                      {
                      name: `${rooms[_.findIndex(rooms, { id: blind.roomId })].name} ${blind.name}`,
                      encodedMacAddress: blind.encodedMacAddress,
                      blindPercent: homeKitBlindPercent,
                      batteryPercent: blindState.batteryLevel
                    });
                    foundBlinds.push(accessory);
                  })
                );
              }
            })
            Promise.all(blindPromise).then(() => {
              console.log('Found Binds', foundBlinds)
              callback(foundBlinds);
            });
          })
          .catch(function (err) {
            platform.log('Error getting user info/auth token', err);
          });
        }
      }
    )
  }
}

function MySmartBlindsBridgeAccessory(log, config, blind) {
  this.log = log;
  this.config = config;
  this.name = blind.name;
  this.encodedMacAddress = blind.encodedMacAddress;
  this.blindPercent = blind.blindPercent;
  this.batteryPercent = blind.batteryPercent
  this.currentPosition = 0;
	this.targetPosition = 0;
	
	this.positionState = Characteristic.PositionState.STOPPED;
}

MySmartBlindsBridgeAccessory.prototype = {
  getTargetPosition: function(callback){
		this.log("getTargetPosition :", this.targetPosition);
		this.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
		callback(null, this.targetPosition);
	},
	setTargetPosition: function(value, callback) {
    const thisBlind = this;
    thisBlind.targetPosition = parseInt(value);

    thisBlind.log("setTargetPosition from %s to %s", thisBlind.targetPosition, thisBlind.targetPosition);

    const options = {
      method: 'POST',
      uri: smartblindsGraphQL,
      body: {
      query: `
        mutation UpdateBlindsPosition($blinds: [String], $position: Int!) {
          updateBlindsPosition(encodedMacAddresses: $blinds, position: $position) {
            encodedMacAddress
            position
            rssi
            batteryLevel
          }
        }
      `,
        variables: {
          position: thisBlind.targetPosition,
          blinds: this.encodedMacAddress
        },
      },
      json: true,
      headers: {
        Authorization: `Bearer ${auth0Token}`
      }
    };
    rp(options)
    .then(function () {
      thisBlind.currentPosition = thisBlind.targetPosition;
			thisBlind.service.setCharacteristic(Characteristic.CurrentPosition, thisBlind.currentPosition);
			thisBlind.service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
			thisBlind.log("currentPosition is now %s", thisBlind.currentPosition);
			callback(null);
    });
  },
  getPositionState: function(callback) {
		this.log("getPositionState :", this.positionState);
		callback(null, this.positionState);
	},
  getServices: function() {
    var services = []
    
    this.service = new Service.WindowCovering(this.name);

    this.service.getCharacteristic(Characteristic.CurrentPosition).on('get', function(callback) {
      // function coming soon
      callback(null, this.currentPosition);
    }.bind(this));

    this.service.getCharacteristic(Characteristic.TargetPosition)
    .on('get', this.getTargetPosition.bind(this))
    .on('set', this.setTargetPosition.bind(this));

    this.service.getCharacteristic(Characteristic.PositionState)
		.on('get', this.getPositionState.bind(this));

    services.push(this.service);

    var service = new Service.AccessoryInformation();

    service.setCharacteristic(Characteristic.Manufacturer, "MySmartBlinds")
    .setCharacteristic(Characteristic.Name, this.name)
		.setCharacteristic(Characteristic.SerialNumber, this.encodedMacAddress)
		.setCharacteristic(Characteristic.Model, 'Window Blind');

    services.push(service);

    return services;
  }
}

module.exports.accessory = MySmartBlindsBridgeAccessory;
module.exports.platform = MySmartBlindsBridge;

var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-mysmartblinds", "MySmartBlinds", MySmartBlindsBridgeAccessory);
  homebridge.registerPlatform('homebridge-mysmartblinds-bridge', 'MySmartBlindsBridge', MySmartBlindsBridge);
};