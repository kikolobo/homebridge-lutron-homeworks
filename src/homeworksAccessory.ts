import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
import { ConfigDevice } from './Schemas/device';

interface SetLutronLevelCallback { 
  (value: number, isDimmable: boolean, accessory: HomeworksAccessory): void;
}

/**
 * HomeworksAccessory
 * An instance of this class is created for each accessory your platform registers
 */
export class HomeworksAccessory {
  public static CreateAccessory(
    platform: HomeworksPlatform,
    accessory: PlatformAccessory,
    uuid: string,
    config: ConfigDevice,
  ): HomeworksAccessory {
    switch (config.deviceType) {
      case 'shade':
        return new HomeworksShadeAccessory(platform, accessory, uuid, config);
      default:
      case 'light':
        return new HomeworksLightAccessory(platform, accessory, uuid, config);
    }
  }

  public lutronLevelChangeCallback?: SetLutronLevelCallback;
  protected readonly _name: string;

  constructor(
    protected readonly _platform: HomeworksPlatform,
    protected readonly _accessory: PlatformAccessory,
    protected readonly _uuid: string,
    protected readonly _config: ConfigDevice,
  ) {
    // Assign local variables
    this._name = this._accessory.context.device.name;

    // Set Info
    this._accessory.getService(this._platform.Service.AccessoryInformation)!
      .setCharacteristic(this._platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this._platform.Characteristic.Model, 'Homeworks Plugin')
      .setCharacteristic(this._platform.Characteristic.SerialNumber, 'n/a');
  }

  /**
   * Handle the "GET" integrationId
   */
  public getIntegrationId(): string {
    return this._config.integrationID;
  }

  /**
   * Handle the "GET" name
   */
  public getName(): string {
    return this._name;
  }

  /**
   * Handle the "GET" UUID
   */
  public getUUID(): string {
    return this._uuid;
  }

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor. (set externally)
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue): void {
    this._platform.log.error('[Accessory][HomeworksAccessory] [%s] updateBrightness %s not overridden', this._name, targetBrightnessVal);
  }
}

/**
 * HomeworksLightAccessory
 */
export class HomeworksLightAccessory extends HomeworksAccessory {
  private _service: Service;
  private _lastKnownBrightness = 100;

  public _dimmerState = {
    On: false,
    Brightness: 0,
    PositionState: 2,
  };

  constructor(
    platform: HomeworksPlatform,
    accessory: PlatformAccessory,
    uuid: string,
    config: ConfigDevice,
  ) {
    super(platform, accessory, uuid, config);  

    // Restore last known brightness from context if available
    if (this._accessory.context.lastKnownBrightness && this._accessory.context.lastKnownBrightness > 0) {
      this._lastKnownBrightness = this._accessory.context.lastKnownBrightness;
      this._platform.log.debug('[Accessory][%s] Restored lastKnownBrightness from context: %i', this._name, this._lastKnownBrightness);
    }

    // Assign HK Service
    this._service = this._accessory.getService(this._platform.Service.Lightbulb)
      || this._accessory.addService(this._platform.Service.Lightbulb);
    
    // Set Characteristic Name
    this._service.setCharacteristic(this._platform.Characteristic.Name, this._accessory.context.device.name);

    // register handlers for the On/Off Characteristic (minimum for lightbulb)
    this._service.getCharacteristic(this._platform.Characteristic.On)
      .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below
    
    // register handlers for the Brightness Characteristic
    if (this._config.isDimmable) {
      this._service.getCharacteristic(this._platform.Characteristic.Brightness)
        .on('set', this.setBrightness.bind(this))       // SET - bind to the 'setBrightness` method below
        .on('get', this.getBrightness.bind(this));      // GET - bind to the 'getBrightness` method below
    }
  }

  /**
   * Handle the "GET" is dimmable
   */
  public getIsDimmable(): boolean {
    return this._config.isDimmable;
  }

  /**
   * Store last known brightness for later restoration
   */
  private storeLastKnownBrightness(brightness: number): void {
    if (brightness > 0) {
      this._lastKnownBrightness = brightness;
      // Persist to context for restart survival
      this._accessory.context.lastKnownBrightness = brightness;
      this._platform.log.debug('[Accessory][%s] Stored lastKnownBrightness: %i', this._name, brightness);
    }
  }

  /**
   * Handle the "SET" ON requests from HomeKit
   */
  private setOn(targetValue: CharacteristicValue, callback: CharacteristicSetCallback): void {
    const isDimmable = this.getIsDimmable();

    if (targetValue === this._dimmerState.On) {
      callback(null);
      return;
    }

    this._dimmerState.On = targetValue as boolean;

    if (targetValue === true) {
      // Turning ON - restore last known brightness
      this._dimmerState.Brightness = this._lastKnownBrightness;
      this._platform.log.debug('[Accessory][%s][setOn] Restoring brightness to %i', this._name, this._lastKnownBrightness);
      
      // Update HomeKit characteristic to reflect the restored brightness
      if (this.getIsDimmable()) {
        this._service.updateCharacteristic(this._platform.Characteristic.Brightness, this._dimmerState.Brightness);
      }
    } else {
      // Turning OFF - store current brightness if it's not zero
      if (this._dimmerState.Brightness > 0) {
        this.storeLastKnownBrightness(this._dimmerState.Brightness);
      }
      this._dimmerState.Brightness = 0;
    }

    // For non-dimmable lights, ensure brightness is updated in HomeKit
    if (!this.getIsDimmable()) {
      this._service.updateCharacteristic(this._platform.Characteristic.Brightness, this._dimmerState.Brightness);
    }

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(this._dimmerState.Brightness, isDimmable, this);
    }

    this._platform.log.debug('[Accessory][%s][setOn] [state: %s|dim: %s|brightness: %i]', 
      this._name, this._dimmerState.On, this.getIsDimmable(), this._dimmerState.Brightness);

    callback(null);
  }

  /**
   * Handle the "GET" ON requests from HomeKit
   */
  private getOn(callback: CharacteristicGetCallback): void {
    const isOn = this._dimmerState.On;

    this._platform.log.debug('[Accessory][%s][getOn] is %s', this.getName(), isOn ? 'ON' : 'OFF');

    callback(null, isOn); // error,value
  }

  /**
   * Handle the "GET" Brightness requests from HomeKit
   */
  private getBrightness(callback: CharacteristicGetCallback): void {
    const brightness = this._dimmerState.Brightness;

    this._platform.log.debug('[Accessory][%s][getBrightness] -> %i', this._name, brightness);

    callback(null, brightness); // error,value
  }

  /**
   * Handle the "SET" Brightness requests from HomeKit
   */
  private setBrightness(targetValue: CharacteristicValue, callback: CharacteristicSetCallback): void {
    if (targetValue === this._dimmerState.Brightness) {
      callback(null);
      return;
    }

    this._platform.log.debug('[Accessory][%s][setBrightness] -> %i', this.getName(), targetValue);

    const targetBrightnessVal = targetValue as number;
    
    // Store non-zero brightness values for later restoration
    this.storeLastKnownBrightness(targetBrightnessVal);
    
    this._dimmerState.Brightness = targetBrightnessVal;

    // Update the On state based on brightness
    this._dimmerState.On = targetBrightnessVal > 0;

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }

    callback(null); // null or error
  }

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor.
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue): void {
    this._platform.log.debug('[Accessory][%s][updateBrightness] to %i', this._name, targetBrightnessVal);

    if (targetBrightnessVal === this._dimmerState.Brightness) { // If the value is the same. Ignore to save network traffic.
      return;
    }

    const brightnessNumber = targetBrightnessVal as number;

    // Store non-zero brightness for future restoration
    this.storeLastKnownBrightness(brightnessNumber);

    // Update internal state
    if (brightnessNumber > 0) {
      this._dimmerState.On = true;
    } else if (brightnessNumber <= 0) {
      this._dimmerState.On = false;
    }

    this._dimmerState.Brightness = brightnessNumber;
    
    // Update HomeKit characteristics
    this._service.updateCharacteristic(this._platform.Characteristic.On, this._dimmerState.On);
    this._service.updateCharacteristic(this._platform.Characteristic.Brightness, this._dimmerState.Brightness);
  }
}

/**
 * HomeworksShadeAccessory covers the shade class of devices from Lutron.
 *
 * Output commands will set the TargetPosition and automatically initiate the
 * motion. The immediately reported status from Homeworks is the TargetPosition.
 *
 * It appears that the end of the scrolling is indicated by an undocumented
 * status ~OUTPUT,XXX,32,2,level. For now, we'll use this as a forced terminator
 *
 * Outside of this, no further status is reported. Worse, subsequent ?OUTPUT,x,1 polls
 * will show this TargetPosition but nothing in between
 */
export class HomeworksShadeAccessory extends HomeworksAccessory {
  private _service: Service;

  public _shadeState = {
    IsInitialized: false,
    Position: 0,
    TargetPosition: 0,
    PositionState: 2,
  };

  constructor(
    platform: HomeworksPlatform,
    accessory: PlatformAccessory,
    uuid: string,
    config: ConfigDevice,
  ) {
    super(platform, accessory, uuid, config);

    this._service = this._accessory.getService(this._platform.Service.WindowCovering)
      || this._accessory.addService(this._platform.Service.WindowCovering);
    this._service.setCharacteristic(this._platform.Characteristic.Name, this._accessory.context.device.name);

    // Current position of the shade
    this._service.getCharacteristic(this._platform.Characteristic.CurrentPosition)
      .on('set', this.setCurrentPosition.bind(this))
      .on('get', this.getCurrentPosition.bind(this));

    // Target position of the shade
    this._service.getCharacteristic(this._platform.Characteristic.TargetPosition)
      .on('set', this.setTargetPosition.bind(this))
      .on('get', this.getTargetPosition.bind(this));

    // Current status of shade motion
    this._service.getCharacteristic(this._platform.Characteristic.PositionState)
      .on('set', this.setPositionState.bind(this))
      .on('get', this.getPositionState.bind(this));

    this._shadeState.PositionState = this._platform.Characteristic.PositionState.STOPPED;
  }

  /**
   * Handle the "GET" CurrentPosition requests from HomeKit
   */
  private getCurrentPosition(callback: CharacteristicGetCallback): void {
    const position = this._shadeState.Position;

    this._platform.log.info('[Accessory][%s][getCurrentPosition] -> %i', this._name, position);

    callback(null, position); // error,value
  }

  /**
   * Handle the "SET" CurrentPosition requests from HomeKit
   */
  private setCurrentPosition(position: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this._platform.log.info('[Accessory][%s][setCurrentPosition] -> %i', this.getName(), position);

    const positionNumber = position as number;

    // If there is no movement, no change necessary
    if (positionNumber === this._shadeState.Position) {
      callback(null);
      return;
    }

    this._shadeState.Position = positionNumber;

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(this._shadeState.Position, false, this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "GET" TargetPosition requests from HomeKit
   */
  private getTargetPosition(callback: CharacteristicGetCallback): void {
    this._platform.log.info('[Accessory][%s][getTargetPosition] -> %i', this._name, this._shadeState.TargetPosition);

    callback(null, this._shadeState.TargetPosition); // error,value
  }

  /**
   * Handle the "SET" TargetPosition requests from HomeKit
   */
  private setTargetPosition(targetPosition: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this._platform.log.info('[Accessory][%s][setTargetPosition] -> %i', this.getName(), targetPosition);

    const targetPositionNumber = targetPosition as number;
    if (targetPositionNumber === this._shadeState.TargetPosition) {
      callback(null);
      return;
    }

    // Begin motion to the target level. We only set the target level and let reported status
    // set the current position
    this._shadeState.TargetPosition = targetPositionNumber;

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(this._shadeState.TargetPosition, false, this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "GET" PositionState requests from HomeKit
   */
  private getPositionState(callback: CharacteristicGetCallback): void {
    this._platform.log.info('[Accessory][%s][getPositionState] -> %i', this._name, this._shadeState.PositionState);

    callback(null, this._shadeState.PositionState); // error,value
  }

  /**
   * Handle the "SET" PositionState requests from HomeKit
   */
  private setPositionState(targetState: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this._platform.log.info('[Accessory][%s][setPositionState] -> %i', this.getName(), targetState);

    // Don't know what to do here.
    callback(null); // null or error
  }

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor. (set externally)
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue): void {
    this._platform.log.info('[Accessory][%s][updateBrightness] to %i', this._name, targetBrightnessVal);

    const targetPositionNumber = targetBrightnessVal as number;

    // If there is no change, then there's nothing for us to do
    if (targetPositionNumber === this._shadeState.Position) {
      return;
    }

    if (!this._shadeState.IsInitialized) {
      this._shadeState.TargetPosition = targetPositionNumber;
      this._shadeState.IsInitialized = true;
    }

    this._shadeState.Position = targetPositionNumber;
    this._service.updateCharacteristic(this._platform.Characteristic.CurrentPosition, this._shadeState.Position);

    // When the current position matches the target position, motion of the shade is stopped. Note
    // we do this regardless of whether the device is stopped
    if (this._shadeState.Position === this._shadeState.TargetPosition) {
      this.stopped();
    }
  }

  /**
   * Called when shade motion stops
   */
  public stopped(): void {
    this._platform.log.info('[Accessory][%s][stopped]', this.getName());

    this._shadeState.PositionState = this._platform.Characteristic.PositionState.STOPPED;
    this._service.updateCharacteristic(this._platform.Characteristic.PositionState, this._shadeState.PositionState);
  }
}