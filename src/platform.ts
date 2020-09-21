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
      const splittedMessage = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(message);
      if (splittedMessage) {
        const deviceId = splittedMessage[1];
        const brigthness = Number(splittedMessage[2]);
        const uuid = this.api.hap.uuid.generate(deviceId);
        const targetDevice = this.homeworksAccesories.find(accessory => accessory.UUID === uuid);
        
        if (targetDevice) { //Found 
          this.log.debug('[Platform][EngineCallback] Set: %s to: %i', targetDevice.name, brigthness);
          targetDevice.updateBrightness(brigthness);          
        }
      }
    };

    const connectedCallback = (engine: NetworkEngine) : void => {      
      for (const accesory of this.homeworksAccesories) {
        this.log.debug('[Platform] Requesting updates for:', accesory.name);
        const command = `?OUTPUT,${accesory._integrationId},1`;
        engine.send(command);
      }
    };

    engine.registerReceiveCallback(rxCallback);
    engine.registerDidConnectCallback(connectedCallback);
  }

  

  // <<<<<<<<<<<<<<<<<<[HOMEBRIDGE]<<<<<<<<<<<<<<<<<<<
  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {    
    this.cachedPlatformAccessories.push(accessory);
  }

  
  
  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    

    // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.cachedPlatformAccessories);

    for (const confDevice of this.configuration.devices) {      
      const uuid = this.api.hap.uuid.generate(confDevice.integrationID);
    

      let loadedAccesory = this.cachedPlatformAccessories.find(accessory => accessory.UUID === uuid);            
      
      if (loadedAccesory === undefined || loadedAccesory === null) {
        this.log.info('+ Creating:', confDevice.name);
        const accessory = new this.api.platformAccessory(confDevice.name, uuid);
        accessory.context.device = confDevice;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        loadedAccesory = accessory;
      } 

      loadedAccesory.context.device = confDevice;
      loadedAccesory.displayName = confDevice.name;
      
            
      this.api.updatePlatformAccessories([loadedAccesory]);
      

      if (loadedAccesory) {
        this.log.info('~ Registering: %s as %s', loadedAccesory.displayName, confDevice.name);        
        const hwa = new HomeworksAccesory(this, loadedAccesory, loadedAccesory.UUID, confDevice.integrationID);
        
        // >>>Setup Callback to HomeworksAccesory
        hwa.homekitBrightnessUpdate = (value: number, accesory:HomeworksAccesory) : void => {          
          const command = `#OUTPUT,${accesory._integrationId},1,${value},00:01`;
          this.log.info('Updating fixture state to: %s %s', value, accesory.name);
          this.engine.send(command);          
        };
               

        this.homeworksAccesories.push(hwa);
            

      } else {
        this.log.error('[platform] Unable to load accesory. [Error]');
      }
    }
    // if (accesoriesToUpdate.length > 0) {
    //   this.log.warn('[platform] Updating %i accesories.', accesoriesToUpdate.length);
    //   this.api.updatePlatformAccessories(accesoriesToUpdate);      
    // }

  }
}
