import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { Configuration } from './Schemas/configuration';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HomeworksAccesory } from './homeworksAccessory';
import { NetworkEngine } from './network';


export class HomeworksPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;  
  private configuration: Configuration = {devices:[], apiPort:23, host:'127.0.0.1', username:'', password:''};
  private readonly engine: NetworkEngine;
  private readonly cachedPlatformAccessories: PlatformAccessory[] = [];
  private readonly homeworksAccesories: HomeworksAccesory[] = [];

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
   * Register all NetworkEngine Event Callbacks
   */
  private setupNetworkEngineCallbacks(engine: NetworkEngine) {
    const rxCallback = (engine: NetworkEngine, message:string) : void => {      
      // const splittedMessage = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(message);      
      // const splittedMessage = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(message);
      // this.log.debug('[platform][traffic]', message);     
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

        this.log.debug('[platform][traffic]', singleMessage);      
      
      
        const splittedMessage = singleMessage.split(',');
        if (splittedMessage && (splittedMessage[2] === '1')) { 
          const deviceId = splittedMessage[1];
          const brigthness = Number(splittedMessage[splittedMessage.length-1]);
          const uuid = this.api.hap.uuid.generate(deviceId);
          const targetDevice = this.homeworksAccesories.find(accessory => accessory.getUUID() === uuid);
        
          if (targetDevice) { //Found 
            this.log.debug('[Platform][EngineCallback] Set: %s to: %i', targetDevice.getName(), brigthness);
            targetDevice.updateBrightness(brigthness);          
          }
        }

      }
      
    };

    const connectedCallback = (engine: NetworkEngine) : void => {      
      for (const accesory of this.homeworksAccesories) {
        this.log.debug('[Platform] Requesting updates for:', accesory.getName());
        const command = `?OUTPUT,${accesory.getIntegrationId()},1`;
        engine.send(command);        
      }
    };

    engine.registerReceiveCallback(rxCallback);
    engine.registerDidConnectCallback(connectedCallback);    
  }

  // <<<<<<<<<<<<<<<<<<[HD_API]<<<<<<<<<<<<<<<<<<<

  /**
   * Called when homebridge restores cached accessories from disk at startup.   
   */
  configureAccessory(accessory: PlatformAccessory) {    
    this.cachedPlatformAccessories.push(accessory);
  }
  
  /**
   * Register devices in HomeKit (Api Method)
   */
  discoverDevices() {
    
    const brightnessUpdateCallback = (value: number, accesory:HomeworksAccesory) : void => { //Callback from HK
      const command = `#OUTPUT,${accesory.getIntegrationId()},1,${value},00:01`;
      this.log.debug('[Platform] brightnessUpdateCallback to: %s %s // %s', value, accesory.getName(), command);
      this.engine.send(command);          
    };


    const allAddedAccesories: PlatformAccessory[] = [];

    for (const confDevice of this.configuration.devices) {       //Iterate thru the devices in config.
      const uuid = this.api.hap.uuid.generate(confDevice.integrationID);            
      let loadedAccesory = this.cachedPlatformAccessories.find(accessory => accessory.UUID === uuid);
  
      if (loadedAccesory === undefined || loadedAccesory === null) { //New Device
        this.log.info('[Platform] + Creating:', confDevice.name);
        const accessory = new this.api.platformAccessory(confDevice.name, uuid);
        accessory.context.device = confDevice;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        loadedAccesory = accessory;
      } else { //Updated Davice
        this.log.info('[Platform] ~ Updating:', confDevice.name);
        loadedAccesory.context.device = confDevice;
        loadedAccesory.displayName = confDevice.name;
        this.api.updatePlatformAccessories([loadedAccesory]);
      }
      
      if (loadedAccesory) { 
        this.log.info('[Platform] >> Registering: %s as %s', loadedAccesory.displayName, confDevice.name); //Registering to platform
        const hwa = new HomeworksAccesory(this, loadedAccesory, loadedAccesory.UUID, confDevice.integrationID, confDevice.isDimmable);
        this.homeworksAccesories.push(hwa);
        hwa.homekitBrightnessUpdate = brightnessUpdateCallback;
        allAddedAccesories.push(loadedAccesory);
      } else {
        this.log.error('[platform] Unable to load accesory. [Error]');
      }            
    }

    let toDelete: PlatformAccessory[] = [];
    toDelete = this.diference(this.cachedPlatformAccessories, allAddedAccesories) as PlatformAccessory[];
    if (toDelete.length > 0) {
      this.log.warn('[platform] Removing: %i accesories', toDelete.length);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toDelete);
    }

  }

  diference(a, b) {
    const setB = new Set(b);
    return [...new Set(a)].filter(x => !setB.has(x));
  }

}
