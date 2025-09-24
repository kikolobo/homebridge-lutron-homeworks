import {API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic} from 'homebridge';
import {Configuration} from './Schemas/configuration';
import {ConfigDevice} from './Schemas/device';
import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {HomeworksAccessory, HomeworksShadeAccessory} from './homeworksAccessory';
import {NetworkEngine} from './network';

interface ParsedOutputMessage {
  deviceId: string;
  operation: string;
  value?: string;
  action?: string;
  rawMessage: string;
}

// Remove this interface and use the existing ConfigDevice type from your schema

export class HomeworksPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  
  private configuration: Configuration = {
    devices: [], 
    apiPort: 23, 
    host: '127.0.0.1', 
    username: '', 
    password: '',
  };
  
  private readonly engine: NetworkEngine;
  private readonly cachedPlatformAccessories: PlatformAccessory[] = [];
  private readonly homeworksAccessories: HomeworksAccessory[] = [];

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
    this.setupNetworkEngineCallbacks();

    this.api.on('didFinishLaunching', () => {  
      this.log.debug('[Platform] didFinishLaunching:');    
      this.discoverDevices();                
      this.engine.connect();      
    });
  }

  // Configuration Management
  private loadUserConfiguration(): void {
    try {
      this.log.debug('[Platform] Raw config received:', JSON.stringify(this.config, null, 2));
      
      this.configuration = { ...this.configuration, ...this.config };
      this.validateConfiguration();
      this.logConfigurationSummary();
      
    } catch (error) {
      this.log.error('[Platform] Failed to load user configuration:', error);
      this.log.error('[Platform] Using default configuration');
    }
  }

  private validateConfiguration(): void {
    if (!this.configuration.devices || !Array.isArray(this.configuration.devices)) {
      this.log.warn('[Platform] No valid devices array found, initializing empty array');
      this.configuration.devices = [];
    }

    const requiredFields: (keyof Configuration)[] = ['host', 'username', 'password'];
    const missingFields = requiredFields.filter(field => !this.configuration[field]);
    
    if (missingFields.length > 0) {
      this.log.error(`[Platform] Missing required fields: ${missingFields.join(', ')}`);
    }

    if (!this.configuration.apiPort) {
      this.configuration.apiPort = 23;
    }
  }

  private logConfigurationSummary(): void {
    this.log.debug('[Platform] Configuration Summary:');
    this.log.debug(`  Host: ${this.configuration.host}`);
    this.log.debug(`  Port: ${this.configuration.apiPort}`);
    this.log.debug(`  Username: ${this.configuration.username ? '[SET]' : '[NOT SET]'}`);
    this.log.debug(`  Password: ${this.configuration.password ? '[SET]' : '[NOT SET]'}`);
    this.log.debug(`  Devices: ${this.configuration.devices.length}`);
    
    if (this.configuration.devices.length > 0) {
      this.configuration.devices.forEach((device, index) => {
        this.log.debug(`    ${index + 1}. ${device?.name || '[NO NAME]'} (ID: ${device?.integrationID || '[NO ID]'})`);
      });
    }
  }

  // Network Engine Setup
  private setupNetworkEngineCallbacks(): void {
    this.engine.registerReceiveCallback((_engine, message) => {
      this.handleReceivedMessage(message);
    });

    this.engine.registerDidConnectCallback(() => {
      this.handleConnectionEstablished();
    });

    // Configure devices for monitoring
    this.engine.addDevicesFromConfig(this.configuration.devices);
  }

  private handleReceivedMessage(message: string): void {
    const messages = this.splitAndCleanMessages(message);

    for (const singleMessage of messages) {
      if (this.shouldSkipMessage(singleMessage)) {
        continue;
      }

      this.logTrafficMessage(singleMessage);
      
      // Only parse ~OUTPUT messages (ignoring ~DEVICE messages)
      const parsedMessage = this.parseOutputMessage(singleMessage);
      if (parsedMessage) {
        this.handleOutputMessage(parsedMessage);
      }
    }
  }

  private splitAndCleanMessages(message: string): string[] {
    return message
      .split('\n')
      .map(msg => msg.trim())
      .filter(msg => msg.length > 0);
  }

  private shouldSkipMessage(message: string): boolean {
    const skipPatterns = [
      '~SYSTEM,6,',              // PONG replies
      'GLINK_DEVICE_SERIAL_NUM', // Serial number messages
      'Device serial ',          // Device serial messages
      '~ADDRESS',                // Address messages
      '~DEVICE',                 // Explicitly skip ~DEVICE messages as requested
    ];

    return skipPatterns.some(pattern => message.includes(pattern));
  }

  private logTrafficMessage(message: string): void {
    this.log.debug('[Platform][Traffic]', message);
  }

  private parseOutputMessage(message: string): ParsedOutputMessage | null {
    const parts = message.split(',');
    
    // Only handle ~OUTPUT messages
    if (!parts || parts[0] !== '~OUTPUT' || parts.length < 4) {
      return null;
    }

    // Standard output message: ~OUTPUT,deviceId,operation,value
    if (parts.length === 4) {
      return {
        deviceId: parts[1],
        operation: parts[2],
        value: parts[3],
        rawMessage: message,
      };
    }

    // Shade stop message: ~OUTPUT,deviceId,32,action,value
    if (parts.length === 5 && parts[2] === '32') {
      return {
        deviceId: parts[1],
        operation: parts[2],
        action: parts[3],
        value: parts[4],
        rawMessage: message,
      };
    }

    this.log.debug('[Platform] Unrecognized OUTPUT format:', message);
    return null;
  }

  private handleOutputMessage(parsedMessage: ParsedOutputMessage): void {
    const targetDevice = this.findAccessoryByDeviceId(parsedMessage.deviceId);
    
    if (!targetDevice) {
      this.log.debug(`[Platform] No accessory found for device ID: ${parsedMessage.deviceId}`);
      return;
    }

    switch (parsedMessage.operation) {
      case '1':
        this.handleLightLevelUpdate(targetDevice, parsedMessage);
        break;
        
      case '32':
        this.handleShadeOperation(targetDevice, parsedMessage);
        break;
        
      default:
        //Simply ignore. 
        // this.log.debug(`[Platform] Unknown operation: ${parsedMessage.operation} for ${targetDevice.getName()}`);
    }
  }

  private findAccessoryByDeviceId(deviceId: string): HomeworksAccessory | undefined {
    const uuid = this.api.hap.uuid.generate(deviceId);
    return this.homeworksAccessories.find(accessory => accessory.getUUID() === uuid);
  }

  private handleLightLevelUpdate(device: HomeworksAccessory, message: ParsedOutputMessage): void {
    if (message.value === undefined) {
      this.log.warn(`[Platform] Light level message missing value: ${message.rawMessage}`);
      return;
    }

    const brightness = Number(message.value);
    if (isNaN(brightness)) {
      this.log.warn(`[Platform] Invalid brightness value: ${message.value}`);
      return;
    }

    this.log.info(`[Platform] ${device.getName()} brightness: ${brightness}%`);
    device.updateBrightness(brightness);
  }

  private handleShadeOperation(device: HomeworksAccessory, message: ParsedOutputMessage): void {
    if (message.action === '2') {
      this.log.info(`[Platform] ${device.getName()} stopped`);
      if (device instanceof HomeworksShadeAccessory) {
        (device as HomeworksShadeAccessory).stopped();
      }
    } else {
      this.log.debug(`[Platform] Unknown shade action: ${message.action} for ${device.getName()}`);
    }
  }

  private handleConnectionEstablished(): void {
    this.log.info('[Platform] Connection established, querying device states');
    
    // Query all devices with staggered timing
    this.homeworksAccessories.forEach((accessory, index) => {
      setTimeout(() => {
        const command = `?OUTPUT,${accessory.getIntegrationId()}`;
        this.log.debug(`[Platform] Querying: ${accessory.getName()}`);
        this.engine.send(command);
      }, index * 100); // 100ms between queries
    });
  }

  // Device Management
  public discoverDevices(): void {
    const brightnessChangeCallback = this.createBrightnessChangeCallback();
    const processedAccessories: PlatformAccessory[] = [];

    for (const deviceConfig of this.configuration.devices) {
      const validationResult = this.validateDeviceConfig(deviceConfig);
      
      if (!validationResult.isValid) {
        this.logValidationErrors(deviceConfig, validationResult.errors);
        continue;
      }

      const accessory = this.createOrUpdateAccessory(deviceConfig);
      if (accessory) {
        this.registerAccessory(accessory, deviceConfig, brightnessChangeCallback);
        processedAccessories.push(accessory);
      }
    }

    this.removeOrphanedAccessories(processedAccessories);
  }

  private createBrightnessChangeCallback() {
    return (
      value: number, 
      isDimmable: boolean, 
      accessory: HomeworksAccessory,
    ): void => {
      const fadeTime = isDimmable ? '00:01' : '00:00';
      const command = `#OUTPUT,${accessory.getIntegrationId()},1,${value},${fadeTime}`;

      this.log.debug(`[Platform][createBrightnessChangeCallback][command] ${command}`);
      // #OUTPUT,204,1,26,00:01
      //Unrecognized OUTPUT format: ~OUTPUT,204,30,1,29.00

      // Update local state immediately for better responsiveness
      accessory.updateBrightness(value);

      // this.log.debug(`[Platform][createBrightnessChangeCallback] ${accessory.getName()} to ${value}%`);
      this.engine.send(command);
    };
  }

  private validateDeviceConfig(device: unknown): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    const requiredFields = [
      { name: 'name', type: 'string' },
      { name: 'integrationID', type: 'string' },
      { name: 'deviceType', type: 'string' },
      { name: 'isDimmable', type: 'boolean' },
    ];

    // Check for missing or invalid properties
    for (const field of requiredFields) {
      if (!device || !Object.prototype.hasOwnProperty.call(device, field.name)) {
        errors.push(`Missing required property: ${field.name}`);
      } else if (typeof (device as Record<string, unknown>)[field.name] !== field.type) {
        errors.push(`${field.name} must be ${field.type} (got: ${typeof (device as Record<string, unknown>)[field.name]})`);
      }
    }

    // Validate deviceType enum
    const deviceRecord = device as Record<string, unknown>;
    if (deviceRecord?.deviceType && !['light', 'shade'].includes(deviceRecord.deviceType as string)) {
      errors.push(`deviceType must be 'light' or 'shade' (got: ${deviceRecord.deviceType})`);
    }

    // Validate integrationID is not empty
    if (deviceRecord?.integrationID && (deviceRecord.integrationID as string).trim() === '') {
      errors.push('integrationID cannot be empty');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private logValidationErrors(device: unknown, errors: string[]): void {
    this.log.error('[Platform] Invalid device configuration:');
    this.log.error(JSON.stringify(device, null, 2));
    this.log.error('[Platform] Validation errors:');
    errors.forEach((error, index) => {
      this.log.error(`  ${index + 1}. ${error}`);
    });
  }

  private createOrUpdateAccessory(deviceConfig: ConfigDevice): PlatformAccessory | null {
    const uuid = this.api.hap.uuid.generate(deviceConfig.integrationID);
    let accessory = this.cachedPlatformAccessories.find(acc => acc.UUID === uuid);

    if (!accessory) {
      this.log.info(`[Platform] Creating: ${deviceConfig.name}`);
      accessory = new this.api.platformAccessory(deviceConfig.name, uuid);
      accessory.context.device = deviceConfig;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.log.info(`[Platform] Updating: ${deviceConfig.name}`);
      accessory.context.device = deviceConfig;
      accessory.displayName = deviceConfig.name;
      this.api.updatePlatformAccessories([accessory]);
    }

    return accessory;
  }

  private registerAccessory(
    accessory: PlatformAccessory,
    deviceConfig: ConfigDevice,
    brightnessChangeCallback: (
      value: number,
      isDimmable: boolean,
      accessory: HomeworksAccessory,
    ) => void,
  ): void {
    const isDimmable = deviceConfig.isDimmable !== false;

    this.log.info(
      `[Platform] Registering: ${accessory.displayName} (ID: ${deviceConfig.integrationID}, Dimmable: ${isDimmable})`,
    );

    const homeworksAccessory = HomeworksAccessory.CreateAccessory(
      this,
      accessory,
      accessory.UUID,
      deviceConfig,
    );

    homeworksAccessory.lutronLevelChangeCallback = brightnessChangeCallback;
    this.homeworksAccessories.push(homeworksAccessory);
  }

  private removeOrphanedAccessories(currentAccessories: PlatformAccessory[]): void {
    const orphanedAccessories = this.difference(this.cachedPlatformAccessories, currentAccessories);

    if (orphanedAccessories.length > 0) {
      this.log.warn(`[Platform] Removing ${orphanedAccessories.length} orphaned accessories`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphanedAccessories);
    }
  }

  // HomeKit Platform API
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`[Platform] Loading cached accessory: ${accessory.displayName}`);
    this.cachedPlatformAccessories.push(accessory);
  }

  // Utility Methods
  private difference<T>(arrayA: T[], arrayB: T[]): T[] {
    const setB = new Set(arrayB);
    return arrayA.filter(item => !setB.has(item));
  }
}