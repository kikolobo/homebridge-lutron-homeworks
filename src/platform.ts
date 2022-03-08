import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { Configuration } from './Schemas/configuration';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HomeworksAccessory } from './homeworksAccessory';
import { NetworkEngine } from './network';


export class HomeworksPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;  
  private configuration: Configuration = {devices:[], apiPort:23, host:'127.0.0.1', username:'', password:''};
  private readonly engine: NetworkEngine;
  private readonly cachedPlatformAccessories: PlatformAccessory[] = [];
  private readonly homeworksAccesories: HomeworksAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.loadUserConfiguration();

    this.engine = new NetworkEngine(
      this.log, 
      this.configuration.host,
      this.configuration.apiPort, 
      this.configuration.username, 
      this.configuration.password,
    );

    this.setupNetworkEngineCallbacks(this.engine);    

    this.api.on('didFinishLaunching', () => {      
      this.discoverDevices();
      this.engine.connect();      
    });
  }

  // <<<<<<<<<<<<<<<<[SETUP HELPERS]<<<<<<<<<<<<<<<<<
  /**
   * Loads and parses de user config.json for this platform
   */
  private loadUserConfiguration() {
    const obj = JSON.parse(JSON.stringify(this.config));
    this.configuration = obj;      
    this.log.debug('[Platform] User Configuration Loaded.');
  }


  // <<<<<<<<<<<<<<<<<<[NETWORKING]<<<<<<<<<<<<<<<<<<<
  /**
   * Register NetworkEngine Event Callbacks
   * Create callback for new message. 
   * This callback will be called everytime we get a new msg from the processor (socket)
   */
  private setupNetworkEngineCallbacks(engine: NetworkEngine) {

    const rxCallback = (engine: NetworkEngine, message:string) : void => {   //ON SOCKET TRAFFIC CALLBACK
      const messagesArray = message.split('\n');

      for (let singleMessage of messagesArray) {
        singleMessage = singleMessage.trim();
        if (singleMessage === '') {
          continue; 
        }
       
        if (singleMessage.includes('~SYSTEM,6,') === true) { //This is considered a PONG reply.
          this.log.debug('[platform][Pong] Received'); //TODO: Move to NETWORK Class (why waste cycles here)
          continue;
        }

        if (singleMessage.includes('GLINK_DEVICE_SERIAL_NUM') !== true &&
            singleMessage.includes('Device serial ') !== true) {
          this.log.debug('[platform][traffic]', singleMessage);
        }
      
        const splittedMessage = singleMessage.split(',');  //Parse Message by splitting comas
        if (splittedMessage && (splittedMessage[2] === '1')) {   //Update Message from processor. (1 means update)
          const deviceId = splittedMessage[1];  //Assign values from splitted message
          const brigthness = Number(splittedMessage[splittedMessage.length-1]);
          const uuid = this.api.hap.uuid.generate(deviceId);
          const targetDevice = this.homeworksAccesories.find(accessory => accessory.getUUID() === uuid);
        
          if (targetDevice) { //If we find a device, it means we are observing it and need the value.
            this.log.debug('[Platform][EngineCallback] Set: %s to: %i', targetDevice.getName(), brigthness);
            targetDevice.updateBrightness(brigthness); 
          }
        }
      }
      
    };

    // * Will be called eveytime we connect to the processor (socket)
    const connectedCallback = (engine: NetworkEngine) : void => {      
      //When we connect. We want to get the latest state for the lights. So we issue a query
      for (const accessory of this.homeworksAccesories) {
        this.log.debug('[Platform] Requesting updates for:', accessory.getName());
        const command = `?OUTPUT,${accessory.getIntegrationId()},1`;
        engine.send(command);        
      }
    };

    // * Do register the callbacks in the network engine
    engine.registerReceiveCallback(rxCallback);
    engine.registerDidConnectCallback(connectedCallback);    
  }

  // <<<<<<<<<<<<<<<<<<[Homebridge API]<<<<<<<<<<<<<<<<<<<
  /**
   * Delegate: Called when homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {    
    this.cachedPlatformAccessories.push(accessory);
  }
  
  /**
   * Register devices in HomeKit (When API finishes launching)
   */
  discoverDevices() {
    //TODO: Move elsewhere. 
    //This will be called when a request from HK comes to change a value in the processor
    const brightnessChangeCallback = (value: number, isDimmable: boolean, accessory:HomeworksAccessory) : void => { //Callback from HK
      let fadeTime = '00:01';
      
      if (isDimmable === false) {        
        fadeTime = '00:00';
      }
      
      const command = `#OUTPUT,${accessory.getIntegrationId()},1,${value},${fadeTime}`;

      accessory.updateBrightness(value); //Shall we update it locally?

      this.log.debug('[Platform][setLutronCallback] %s to %s (%s)', accessory.getName(), value, command);
      this.engine.send(command);          
    };

    //The following will iterate thru the config file, check if the device is cached or updated.
    //And also check if we find a device that is no longer in HK but was. And issue a remove.
    const allAddedAccesories: PlatformAccessory[] = []; 

    for (const confDevice of (this.configuration.devices || [])) {       //Iterate thru the devices in config.
      const uuid = this.api.hap.uuid.generate(confDevice.integrationID);            
      let loadedAccessory = this.cachedPlatformAccessories.find(accessory => accessory.UUID === uuid);
  
      if (loadedAccessory === undefined || loadedAccessory === null) { //New Device
        this.log.info('[Platform] + Creating:', confDevice.name);
        const accessory = new this.api.platformAccessory(confDevice.name, uuid);
        accessory.context.device = confDevice;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        loadedAccessory = accessory;
      } else { //Updated Davice
        this.log.debug('[Platform] ~ Updating:', confDevice.name);
        loadedAccessory.context.device = confDevice;
        loadedAccessory.displayName = confDevice.name; //Will be updated unless changed in Homekit.
        this.api.updatePlatformAccessories([loadedAccessory]);
      }
      
      if (loadedAccessory) {
        //Registering to platform
        let isDimmable = true;
        if (confDevice.isDimmable === undefined || confDevice.isDimmable === false) {
          isDimmable = false;
          confDevice.isDimmable = isDimmable;
        }
        

        this.log.info('[Platform] Registering: %s as %s Dimmable: %s', loadedAccessory.displayName, confDevice.name, isDimmable);
        const hwa = new HomeworksAccessory(this, loadedAccessory, loadedAccessory.UUID, confDevice.integrationID, confDevice.deviceType, isDimmable);
        this.homeworksAccesories.push(hwa);
        hwa.lutronBrightnessChangeCallback = brightnessChangeCallback;
        allAddedAccesories.push(loadedAccessory);
      } else {
        this.log.error('[platform][Error] Unable to load accessory: %s', confDevice.name);
      }            
    }

    let toDelete: PlatformAccessory[] = [];
    toDelete = this.diference(this.cachedPlatformAccessories, allAddedAccesories) as PlatformAccessory[];
    if (toDelete.length > 0) {
      this.log.warn('[platform] Removing: %i accesories', toDelete.length);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toDelete);
    }

  }

  //Helper function to get the diference in an array
  diference(a, b) {
    const setB = new Set(b);
    return [...new Set(a)].filter(x => !setB.has(x));
  }

}
