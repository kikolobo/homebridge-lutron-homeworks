import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { ConfigDevice } from './Schemas/device';
import { Configuration } from './Schemas/configuration';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HomeworksAccesory } from './homeworksAccessory';
import { NetworkEngine } from './network';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HomeworksPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  private readonly devices: ConfigDevice[] = [];
  private configuration: Configuration = {devices:[], apiPort:23, host:'127.0.0.1', username:'', password:''};
  private readonly net = require('net');
  private readonly engine: NetworkEngine;
  private readonly processor = new this.net.Socket();
  private processorIsReady = false;
  private retryIntervalRef;
  
  // this is used to track restored cached accessories
  private readonly cachedPlatformAccessories: PlatformAccessory[] = [];
  private readonly homeworksAccesories: HomeworksAccesory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {

    const obj = JSON.parse(JSON.stringify(this.config));
    this.configuration = obj;  

    this.engine = new NetworkEngine(this.log, 
      this.configuration.host, this.configuration.apiPort, 
      this.configuration.username, this.configuration.password);

    this.engine.connect();
    


    this.log.debug('Initialization Complete');
    this.connectToProcessor(this);

    //SOCKET EVENTS
    this.processor.on('data', (data) => {
      // *************** DATA ANALISIS
      const datarx = data.toString();
      // this.log.debug('>>>> ' + datarx);

      
      if (datarx.includes('login:')) {
        this.log.debug('Establishing Session...');
        this.processor.write(this.configuration.username + '\r\n');
        return;
      }

      if (datarx.includes('password:')) {
        this.log.debug('Authenticating...');
        this.processor.write(this.configuration.password + '\r\n');
        return;
      }

      if (datarx.includes('~MONITORING,5,1')) {                
        this.log.debug('Monitoring Zones Aknowledged by Server');
        this.log.info('Connected to HW Processor [' + this.configuration.host + ']');
        
        for (const accesory of this.homeworksAccesories) {
          this.log.debug('Requesting updates for:', accesory.name);
          const command = `?OUTPUT,${accesory._integrationId},1`;
          this.processor.write(command + '\r\n');
        }

        this.processorIsReady = true;
        return;
      }

      if (datarx.includes('QNET>')) {
        if (this.processorIsReady === false) {
          this.log.debug('Session Ready');
          this.log.debug('Requesting #Monitoring Zones');
          this.processor.write('#MONITORING,5,1' + '\r\n');          
          return;
        }
      }

      const m = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(datarx);
      if (m) {
        const deviceId = m[1];
        const brigthness = Number(m[2]);
        const uuid = this.api.hap.uuid.generate(deviceId);
        const targetDevice = this.homeworksAccesories.find(accessory => accessory.UUID === uuid);
        
        if (targetDevice) {
          this.log.debug('Found Observed Accesory :', targetDevice.name);
          targetDevice.updateBrightness(brigthness);          
        }
      }

      // *************** DATA ANALISIS
    });
    
    this.processor.on('error', (err) => {      
      this.log.debug('Socket Error: ', err);      
    });

    this.processor.on('close', () => {
      this.processorIsReady = false;
      this.log.error('Processor closed Connection...');      
      if (this.retryIntervalRef === null) {
        this.log.debug('Scheduling Reconnect');
        this.retryIntervalRef = setInterval(this.connectToProcessor, 5000, this);
      }
    });
    //***************  SOCKET EVENTS

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Loading Devices...');             
      this.discoverDevices();
    });
  }



  connectToProcessor(self) {
    this.log.info('Connecting to:', self.configuration.host);
    if (self.processorIsReady === false) {
      self.log.debug('Connecting to processor...');
      self.processor.connect(self.configuration.apiPort, self.configuration.host, () => {        
        self.log.debug('Processor Connected');
        clearInterval(self.retryInterval);
        self.retryInterval = null;
      });
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {    
    this.cachedPlatformAccessories.push(accessory);
  }

  updateLight(value: number, accesory: HomeworksAccesory) {
    //this.log.info('Updating fixture state to: %s %s', value, accesory.name);
  }
  
  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    for (const device of this.configuration.devices) {
      this.devices.push(device);      
    }
      

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of this.configuration.devices) {      
      const uuid = this.api.hap.uuid.generate(device.integrationID);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.cachedPlatformAccessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('~ Restoring:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`        
        const hwa = new HomeworksAccesory(this, existingAccessory, existingAccessory.UUID, device.integrationID);
        hwa.brightnessToProcessorCallback = (value: number, accesory:HomeworksAccesory) : void => {
          //#OUTPUT,1,1,75,01:30
          const command = `#OUTPUT,${accesory._integrationId},1,${value},00:01`;

          this.log.info('Updating fixture state to: %s %s', value, accesory.name);
          this.processor.write(command + '\r\n');
        };
        
        // obj.refreshConnection(() => { console.log('It works!'); });

        this.homeworksAccesories.push(hwa);
            

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('+ Creating:', device.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        const hwa = new HomeworksAccesory(this, accessory, accessory.UUID, device.integrationID);
        hwa.brightnessToProcessorCallback = this.updateLight;
        this.homeworksAccesories.push(hwa);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

  }
}
