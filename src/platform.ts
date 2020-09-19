import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { Device } from './Schemas/device';
import { Configuration } from './Schemas/configuration';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HomeworksAccesory } from './homeworksAccessory';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HomeworksPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly devices: Device[] = [];
  public configuration: Configuration = {devices:[], apiPort:23, host:'127.0.0.1', username:'', password:''};
  private readonly net = require('net');
  public readonly processor = new this.net.Socket();
  private processorIsReady = false;
  private retryInterval;   //Holds the retryInterval in case of disconnect 
  
  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {

    const obj = JSON.parse(JSON.stringify(this.config));
    this.configuration = obj;  



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
      // *************** DATA ANALISIS
    });
    // this.processor.on('error', (err) => {      
    //   this.log.debug('Connection Error: ', err);      
    // });

    this.processor.on('close', () => {
      this.processorIsReady = false;
      this.log.error('Processor closed Connection...');      
      if (this.retryInterval === null) {
        this.log.debug('Scheduling Reconnect');
        this.retryInterval = setInterval(this.connectToProcessor, 5000, this);
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
    this.log.debug('** Loading: ', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
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
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('~ Restoring:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new HomeworksAccesory(this, existingAccessory);

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
        new HomeworksAccesory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

  }
}
