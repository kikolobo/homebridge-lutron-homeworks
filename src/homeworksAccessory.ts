import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
import { ConfigDevice } from './Schemas/device';

interface SetLutronLevelCallback { 
  // Returns false if the command could not be sent to the processor.
  (value: number, isDimmable: boolean, accessory: HomeworksAccessory): boolean;
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
   * Send a level to the processor. Returns false if it could not be sent.
   */
  protected sendLevel(level: number, isDimmable: boolean): boolean {
    if (!this.lutronLevelChangeCallback) {
      return true;
    }
    return this.lutronLevelChangeCallback(level, isDimmable, this);
  }

  /**
   * Error to hand HomeKit when the processor is unreachable, so the Home app
   * shows "No Response" instead of a change that never happened.
   */
  protected communicationFailure(): Error {
    this._platform.log.warn('[Accessory][%s] Processor not connected. Command not sent', this._name);
    return new this._platform.api.hap.HapStatusError(this._platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
    } else if (this._service.testCharacteristic(this._platform.Characteristic.Brightness)) {
      // A previous version pushed Brightness onto non-dimmable lights, and HAP
      // adds optional characteristics on access. Drop it from the cached
      // service so these show up as a plain switch in HomeKit.
      this._platform.log.debug('[Accessory][%s] Removing Brightness from non-dimmable light', this._name);
      this._service.removeCharacteristic(this._service.getCharacteristic(this._platform.Characteristic.Brightness));
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
    const previousState = { ...this._dimmerState };

    // Always send, even if we believe the light is already in this state: if
    // our state has drifted from the processor, skipping would swallow the
    // command and leave the light stuck.
    this._dimmerState.On = targetValue as boolean;

    if (targetValue === true) {
      // Turning ON - keep the current level if already on, else restore the last known one
      if (!(previousState.On && previousState.Brightness > 0)) {
        this._dimmerState.Brightness = this._lastKnownBrightness;
      }
      this._platform.log.debug('[Accessory][%s][setOn] Restoring brightness to %i', this._name, this._dimmerState.Brightness);
      
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

    if (!this.sendLevel(this._dimmerState.Brightness, isDimmable)) {
      this._dimmerState = previousState;
      callback(this.communicationFailure());
      return;
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
    const previousState = { ...this._dimmerState };

    this._platform.log.debug('[Accessory][%s][setBrightness] -> %i', this.getName(), targetValue);

    const targetBrightnessVal = targetValue as number;
    
    // Store non-zero brightness values for later restoration
    this.storeLastKnownBrightness(targetBrightnessVal);
    
    this._dimmerState.Brightness = targetBrightnessVal;

    // Update the On state based on brightness
    this._dimmerState.On = targetBrightnessVal > 0;

    if (!this.sendLevel(targetBrightnessVal, this.getIsDimmable())) {
      this._dimmerState = previousState;
      callback(this.communicationFailure());
      return;
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

    if (this.getIsDimmable()) {
      this._service.updateCharacteristic(this._platform.Characteristic.Brightness, this._dimmerState.Brightness);
    }
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
  /**
   * Upper bound on how long we report a shade as moving. The stop message is
   * undocumented, so this backstops one that never arrives and prevents a
   * shade from being stuck "opening"/"closing" in the Home app forever.
   */
  private static readonly MOTION_TIMEOUT_MS = 60000;

  private _service: Service;
  private _motionTimeoutRef: NodeJS.Timeout | null = null;

  public _shadeState = {
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

    // Current position of the shade (read-only: reported by the processor)
    this._service.getCharacteristic(this._platform.Characteristic.CurrentPosition)
      .on('get', this.getCurrentPosition.bind(this));

    // Target position of the shade
    this._service.getCharacteristic(this._platform.Characteristic.TargetPosition)
      .on('set', this.setTargetPosition.bind(this))
      .on('get', this.getTargetPosition.bind(this));

    // Current status of shade motion (read-only: derived from the processor)
    this._service.getCharacteristic(this._platform.Characteristic.PositionState)
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

    // Begin motion to the target level. We only set the target level and let reported status
    // set the current position. No motion to report if we are already there.
    // This must precede sending: the send echoes the level back through
    // updateBrightness(), which has to see the move as in flight.
    this._shadeState.TargetPosition = targetPositionNumber;
    if (targetPositionNumber !== this._shadeState.Position) {
      this.beginMotion();
    }

    // Always send, even if the target looks unchanged, so a shade whose state
    // drifted from the processor still moves.
    if (!this.sendLevel(targetPositionNumber, false)) {
      // Nothing moved: settle back on the current position.
      this.stopped();
      callback(this.communicationFailure());
      return;
    }

    callback(null); // null or error
  }

  /**
   * True while we are waiting for a move we commanded to finish.
   */
  private get isMoving(): boolean {
    return this._motionTimeoutRef !== null;
  }

  /**
   * Report the shade as moving until the processor tells us it stopped.
   *
   * The processor echoes the commanded level back immediately, so
   * CurrentPosition reaching TargetPosition is not evidence that the shade has
   * arrived. Only the ~OUTPUT,x,32,2 message (or the timeout) ends the motion.
   */
  private beginMotion(): void {
    this._shadeState.PositionState = this._shadeState.TargetPosition > this._shadeState.Position
      ? this._platform.Characteristic.PositionState.INCREASING
      : this._platform.Characteristic.PositionState.DECREASING;

    this._platform.log.debug('[Accessory][%s][beginMotion] -> %i', this._name, this._shadeState.PositionState);

    this._service.updateCharacteristic(this._platform.Characteristic.PositionState, this._shadeState.PositionState);

    if (this._motionTimeoutRef) {
      clearTimeout(this._motionTimeoutRef);
    }

    this._motionTimeoutRef = setTimeout(() => {
      this._platform.log.debug('[Accessory][%s] No stop message received, assuming motion finished', this._name);
      this.stopped();
    }, HomeworksShadeAccessory.MOTION_TIMEOUT_MS);

    // Never hold Homebridge open on our account.
    this._motionTimeoutRef.unref();
  }

  /**
   * Handle the "GET" PositionState requests from HomeKit
   */
  private getPositionState(callback: CharacteristicGetCallback): void {
    this._platform.log.info('[Accessory][%s][getPositionState] -> %i', this._name, this._shadeState.PositionState);

    callback(null, this._shadeState.PositionState); // error,value
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

    this._shadeState.Position = targetPositionNumber;
    this._service.updateCharacteristic(this._platform.Characteristic.CurrentPosition, this._shadeState.Position);

    // A change we did not command (keypad, scene, or the initial poll): follow
    // it and stay stopped. A move we did command ends on the stop message.
    if (!this.isMoving) {
      this._shadeState.TargetPosition = this._shadeState.Position;
      this._service.updateCharacteristic(this._platform.Characteristic.TargetPosition, this._shadeState.TargetPosition);
      this.stopped();
    }
  }

  /**
   * Called when shade motion stops
   */
  public stopped(): void {
    this._platform.log.info('[Accessory][%s][stopped]', this.getName());

    if (this._motionTimeoutRef) {
      clearTimeout(this._motionTimeoutRef);
      this._motionTimeoutRef = null;
    }

    // Stopping part-way through travel would otherwise leave HomeKit showing a
    // target the shade will never reach, so settle it on where we ended up.
    if (this._shadeState.TargetPosition !== this._shadeState.Position) {
      this._shadeState.TargetPosition = this._shadeState.Position;
      this._service.updateCharacteristic(this._platform.Characteristic.TargetPosition, this._shadeState.TargetPosition);
    }

    this._shadeState.PositionState = this._platform.Characteristic.PositionState.STOPPED;
    this._service.updateCharacteristic(this._platform.Characteristic.PositionState, this._shadeState.PositionState);
  }
}