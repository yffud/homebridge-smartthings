import { PlatformAccessory, Characteristic, CharacteristicValue, Service, WithUUID, Logger, API } from 'homebridge';
import axios = require('axios');
import { IKHomeBridgeHomebridgePlatform } from './platform';
import { BaseService } from './services/baseService';
// import { BasePlatformAccessory } from './basePlatformAccessory';
import { MotionService } from './services/motionService';
import { BatteryService } from './services/batteryService';
import { TemperatureService } from './services/temperatureService';
import { HumidityService } from './services/humidityService';
import { LightSensorService } from './services/lightSensorService';
import { ContactSensorService } from './services/contactSensorService';
import { LockService } from './services/lockService';
import { DoorService } from './services/doorService';
import { SwitchService } from './services/switchService';
import { LightService } from './services/lightService';
import { FanSwitchLevelService } from './services/fanSwitchLevelService';
import { OccupancySensorService } from './services/occupancySensorService';
import { LeakDetectorService } from './services/leakDetector';
import { SmokeDetectorService } from './services/smokeDetector';
import { CarbonMonoxideDetectorService } from './services/carbonMonoxideDetector';
import { ValveService } from './services/valveService';
import { ShortEvent } from './webhook/subscriptionHandler';
import { FanSpeedService } from './services/fanSpeedService';
import { WindowCoveriingService } from './services/windowCoveringService';
import { ThermostatService } from './services/thermostatService';
import { StatelessProgrammableSwitchService } from './services/statelessProgrammableSwitchService';

// type DeviceStatus = {
//   timestamp: number;
//   //status: Record<string, unknown>;
//   status: any;
// };

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
// export class MultiServiceAccessory extends BasePlatformAccessory {
export class MultiServiceAccessory {
  //  service: Service;
  //capabilities;
  components: {
    componentId: string;
    capabilities: string[];
    status: Record<string, unknown>;
  }[] = [];

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */

  private services: BaseService[] = [];

  // Order of these matters.  Make sure secondary capabilities like 'battery' and 'contactSensor' are at the end.
  private static capabilityMap = {
    'doorControl': DoorService,
    'lock': LockService,
    // 'switch': SwitchService,
    'windowShadeLevel': WindowCoveriingService,
    'motionSensor': MotionService,
    'waterSensor': LeakDetectorService,
    'smokeDetector': SmokeDetectorService,
    'carbonMonoxideDetector': CarbonMonoxideDetectorService,
    'presenceSensor': OccupancySensorService,
    'temperatureMeasurement': TemperatureService,
    'relativeHumidityMeasurement': HumidityService,
    'illuminanceMeasurement': LightSensorService,
    'contactSensor': ContactSensorService,
    'button': StatelessProgrammableSwitchService,
    'battery': BatteryService,
    'valve': ValveService,
  };

  // Maps combinations of supported capabilities to a service
  private static comboCapabilityMap = [
    {
      capabilities: ['switch', 'fanSpeed', 'switchLevel'],
      service: FanSwitchLevelService,
    },
    {
      capabilities: ['switch', 'fanSpeed'],
      service: FanSpeedService,
    },
    {
      capabilities: ['switch', 'switchLevel'],
      service: LightService,
    },
    {
      capabilities: ['switch', 'colorControl'],
      service: LightService,
    },
    {
      capabilities: ['switch', 'colorTemperature'],
      service: LightService,
    },
    {
      capabilities: ['switch', 'valve'],
      service: ValveService,
    },
    {
      capabilities: ['switch'],
      service: SwitchService,
    },
    {
      capabilities: ['temperatureMeasurement',
        'thermostatMode',
        'thermostatHeatingSetpoint',
        'thermostatCoolingSetpoint'],
      service: ThermostatService,
    },
  ];

  protected accessory: PlatformAccessory;
  protected platform: IKHomeBridgeHomebridgePlatform;
  public readonly name: string;
  protected characteristic: typeof Characteristic;
  protected log: Logger;
  protected baseURL: string;
  protected key: string;
  protected axInstance: axios.AxiosInstance;
  protected commandURL: string;
  protected statusURL: string;
  protected healthURL: string;
  protected api: API;
  protected online = true;
  //protected deviceStatus: DeviceStatus = { timestamp: 0, status: undefined };
  protected deviceStatusTimestamp = 0;
  protected failureCount = 0;
  protected giveUpTime = 0;
  protected commandInProgress = false;
  protected lastCommandCompleted = 0;

  protected statusQueryInProgress = false;
  protected lastStatusResult = true;

  get id() {
    return this.accessory.UUID;
  }

  constructor(
    platform: IKHomeBridgeHomebridgePlatform,
    accessory: PlatformAccessory,
    // capabilities,
  ) {

    this.accessory = accessory;
    this.platform = platform;
    this.name = accessory.context.device.label;
    this.log = platform.log;
    this.baseURL = platform.config.BaseURL;
    this.key = platform.config.AccessToken;
    this.api = platform.api;
    const headerDict = { 'Authorization': 'Bearer: ' + this.key };

    this.axInstance = axios.default.create({
      baseURL: this.baseURL,
      headers: headerDict,
    });

    this.commandURL = 'devices/' + accessory.context.device.deviceId + '/commands';
    this.statusURL = 'devices/' + accessory.context.device.deviceId + '/status';
    this.healthURL = 'devices/' + accessory.context.device.deviceId + '/health';
    this.characteristic = platform.Characteristic;

    // set accessory information
    accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, accessory.context.device.manufacturerName)
      .setCharacteristic(platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(platform.Characteristic.SerialNumber, 'Default-Serial');

    // // Find out if we are online
    this.axInstance.get(this.healthURL)
      .then(res => {
        if (res.data.state === 'ONLINE') {
          this.online = true;
        } else {
          this.online = false;
        }
      });
  }

  public addComponent(componentId: string, capabilities: string[]) {
    const component = {
      componentId,
      capabilities,
      status: {},
    };
    this.components.push(component);

    // If this device has a 'switch' or 'thermostatMode' capability, need to look at the combinations to
    // determine what kind of device.  Fans, lights,
    // switches all have a switch capability and we need to add the correct one.

    Object.keys(MultiServiceAccessory.capabilityMap).forEach((capability) => {
      if (capabilities.find((c) => c === capability)) {
        this.services.push(new (
          MultiServiceAccessory.capabilityMap[capability])(
            this.platform,
            this.accessory,
            componentId,
            [capability],
            this,
            this.name,
            component,
          ));
      }
    });
    if (capabilities.find(c => (c === 'switch') || c === 'thermostatMode')) {
      let service = this.findComboService(capabilities);
      if (service === undefined) {
        service = SwitchService;
      }
      this.services.push(new service(this.platform, this.accessory, componentId, capabilities, this, this.name, component));
    }
  }

  // If this is a capability that needs to be combined with others in order to determone the service,
  // go through the combinations of cabailities in the map and return the first matching service.
  // We look at combinations because devices like lights that dim also have switch capabilities
  // as well as switchlevel capabilities.  Fans have switch and fanlevel capabilities.  This allows
  // us to find a services that best matches the combination of capabilities reported by the device.
  public findComboService(deviceCapabilities): typeof BaseService | undefined {
    let service: typeof BaseService | undefined = undefined;

    MultiServiceAccessory.comboCapabilityMap.forEach(entry => {
      if (service === undefined) {
        let found = true;
        entry.capabilities.forEach(c => {
          if (!deviceCapabilities.find((dc) => dc === c)) {
            found = false;
          }
        });
        if (found) {
          service = entry.service;
        }
      }
    });
    return service;
  }

  public isOnline(): boolean {
    return this.online;
  }

  // Find return if a capability is supported by the multi-service accessory
  public static capabilitySupported(capability: string): boolean {
    if (Object.keys(MultiServiceAccessory.capabilityMap).find(c => c === capability) || capability === 'switch') {
      return true;
    } else {
      return false;
    }
  }

  // public async refreshStatus(): Promise<boolean> {
  //   return super.refreshStatus();
  // }

    // Called by subclasses to refresh the status for the device.  Will only refresh if it has been more than
  // 4 seconds since last refresh
  //
  async refreshStatus(): Promise<boolean> {
    return new Promise((resolve) => {
      this.log.debug(`Refreshing status for ${this.name} - current timestamp is ${this.deviceStatusTimestamp}`);
      if (Date.now() - this.deviceStatusTimestamp > 5000) {
        // If there is already a call to smartthings to update status for this device, don't issue another one until
        // we return from that.
        if (this.statusQueryInProgress){
          this.log.debug(`Status query already in progress for ${this.name}.  Waiting...`);
          this.waitFor(() => !this.statusQueryInProgress).then(() => resolve(this.lastStatusResult));
          return;
        }
        this.log.debug(`Calling Smartthings to get an update for ${this.name}`);
        this.statusQueryInProgress = true;
        this.failureCount = 0;
        this.waitFor(() => this.commandInProgress === false).then(() => {
          this.lastStatusResult = true;
          this.axInstance.get(this.statusURL).then((res) => {
            const componentsStatus = res.data.components;
            this.components.forEach(component => {
              if (componentsStatus[component.componentId] !== undefined) {
                component.status = componentsStatus[component.componentId];
                this.deviceStatusTimestamp = Date.now();
                this.log.debug(`Updated status for ${this.name}-${component.componentId}: ${JSON.stringify(component.status)}`);
              } else {
                this.log.error(`Failed to get status for ${this.name}-${component.componentId}`);
              }
            });
            this.statusQueryInProgress = false;
            resolve(true);
            // if (res.data.components.main !== undefined) {
            //   this.deviceStatus.status = res.data.components.main;
            //   this.deviceStatus.timestamp = Date.now();
            //   this.log.debug(`Updated status for ${this.name}: ${JSON.stringify(this.deviceStatus.status)}`);
            //   this.statusQueryInProgress = false;
            //   resolve(true);
            // } else {
            //   this.log.debug(`No status returned for ${this.name}`);
            //   this.statusQueryInProgress = false;
            //   resolve(this.lastStatusResult = false);
            // }
          }).catch(error => {
            this.failureCount++;
            this.log.error(`Failed to request status from ${this.name}: ${error}.  This is failure number ${this.failureCount}`);
            if (this.failureCount >= 5) {
              this.log.error(`Exceeded allowed failures for ${this.name}.  Device is offline`);
              this.giveUpTime = Date.now();
              this.online = false;
            }
            this.statusQueryInProgress = false;
            resolve(this.lastStatusResult = false);
          });
        });
      } else {
        resolve(true);
      }
    });
  }

  public forceNextStatusRefresh() {
    this.deviceStatusTimestamp = 0;
  }


  // public startPollingState(pollSeconds: number, getValue: () => Promise<CharacteristicValue>, service: Service,
  //   chracteristic: WithUUID<new () => Characteristic>, targetStateCharacteristic?: WithUUID<new () => Characteristic>,
  //   getTargetState?: () => Promise<CharacteristicValue>) {
  //   return super.startPollingState(pollSeconds, getValue, service, chracteristic, targetStateCharacteristic, getTargetState);
  // }

  startPollingState(pollSeconds: number, getValue: () => Promise<CharacteristicValue>, service: Service,
  chracteristic: WithUUID<new () => Characteristic>, targetStateCharacteristic?: WithUUID<new () => Characteristic>,
  getTargetState?: () => Promise<CharacteristicValue>):NodeJS.Timer|void {

  if (this.platform.config.WebhookToken && this.platform.config.WebhookToken !== '') {
    return;  // Don't poll if we have a webhook token
  }

  if (pollSeconds > 0) {
    return setInterval(() => {
      // If we are in the middle of a commmand call, or it hasn't been at least 10 seconds, we don't want to poll.
      if (this.commandInProgress || Date.now() - this.lastCommandCompleted < 20 * 1000) {
        // Skip polling until command is complete
        this.log.debug(`Command in progress, skipping polling for ${this.name}`);
        return;
      }
      if (this.online) {
        this.log.debug(`${this.name} polling...`);
        // this.commandInProgress = true;
        getValue().then((v) => {
          service.updateCharacteristic(chracteristic, v);
          this.log.debug(`${this.name} value updated.`);
        }).catch(() => {  // If we get an error, ignore
          this.log.warn(`Poll failure on ${this.name}`);
          return;
        });
        // Update target if we have to
        if (targetStateCharacteristic && getTargetState) {
          //service.updateCharacteristic(targetStateCharacteristic, getTargetState());
          getTargetState().then(value => service.updateCharacteristic(targetStateCharacteristic, value));
        }
      } else {
        // If we failed this accessory due to errors. Reset the failure count and online status after 10 minutes.
        if (this.giveUpTime > 0 && (Date.now() - this.giveUpTime > (10 * 60 * 1000))) {
          this.axInstance.get(this.healthURL)
            .then(res => {
              if (res.data.state === 'ONLINE') {
                this.online = true;
                this.giveUpTime = 0;
                this.failureCount = 0;
              }
            });
        }
      }
    }, pollSeconds * 1000 + Math.floor(Math.random() * 1000));  // Add a random delay to avoid collisions
  }
}

async sendCommand(capability: string, command: string, args?: unknown[]): Promise<boolean> {

  let cmd: unknown;

  if (args) {
    cmd = {
      capability: capability,
      command: command,
      arguments: args,
    };
  } else {
    cmd = {
      capability: capability,
      command: command,
    };
  }

  const commandBody = JSON.stringify([cmd]);
  return new Promise((resolve) => {
    this.waitFor(() => !this.commandInProgress).then(() => {
      this.commandInProgress = true;
      this.axInstance.post(this.commandURL, commandBody).then(() => {
        this.log.debug(`${command} successful for ${this.name}`);
        this.deviceStatusTimestamp = 0; // Force a refresh on next poll after a state change
        this.commandInProgress = false;
        resolve(true);
        // Force a small delay so that status fetch is correct
        // setTimeout(() => {
        //   this.log.debug(`Delay complete for ${this.name}`);
        //   this.commandInProgress = false;
        //   resolve(true);
        // }, 1500);
      }).catch((error) => {
        this.commandInProgress = false;
        this.log.error(`${command} failed for ${this.name}: ${error}`);
        resolve(false);
      });
    });
  });
}

// Wait for the condition to be true.  Will check every 500 ms
private async waitFor(condition: () => boolean): Promise<void> {
  if (condition()) {
    return;
  }

  this.log.debug(`${this.name} command or request is waiting...`);
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (condition()) {
        this.log.debug(`${this.name} command or request is proceeding.`);
        clearInterval(interval);
        resolve();
      }
      this.log.debug(`${this.name} still waiting...`);
    }, 250);
  });
}

  public processEvent(event: ShortEvent): void {
    this.log.debug(`Received events for ${this.name}`);

    const service = this.services.find(s => s.componentId === event.componentId && s.capabilities.find(c => c === event.capability));

    if (service) {
      this.log.debug(`Event for ${this.name}:${event.componentId} - ${event.value}`);
      service.processEvent(event);
    }

  }

}
