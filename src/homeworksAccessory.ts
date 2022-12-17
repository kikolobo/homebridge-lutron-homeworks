import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
import { ConfigDevice} from './Schemas/device';

interface SetLutronLevelCallback { (value: number, isDimmable:boolean, Accessory:HomeworksAccessory): void }


//*************************************
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

  public lutronLevelChangeCallback? : SetLutronLevelCallback;
  protected readonly _name;

  constructor (
    protected readonly _platform: HomeworksPlatform,
    protected readonly _accessory: PlatformAccessory,
    protected readonly _uuid: string,
    protected readonly _config: ConfigDevice,
  ) {
    //Assign local variables
    this._name = this._accessory.context.device.name;

    //Set Info
    this._accessory.getService(this._platform.Service.AccessoryInformation)!
      .setCharacteristic(this._platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this._platform.Characteristic.Model, 'Homeworks Plugin')
      .setCharacteristic(this._platform.Characteristic.SerialNumber, 'n/a');
    // .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '0.2');

  }

  /**
   * Handle the "GET" integrationId
   * @example
   * getIntegrationId()
   */
  public getIntegrationId() {
    return this._config.integrationID;
  }

  /**
   * Handle the "GET" name
   * @example
   * getName()
   */
  public getName() {
    return this._name;
  }

  /**
   * Handle the "GET" UUID
   * @example
   * getUUID()
   */
  public getUUID() {
    return this._uuid;
  }

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor. (set externally)
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue) {
    this._platform.log.error('[Accessory][HomeworksAccessory] [%s] updateBrightness %s not overridden', this._name, targetBrightnessVal);
  }

}

/**
 *
 */
export class HomeworksLightAccessory extends HomeworksAccessory {
  private _service: Service;

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

    //Assign HK Service
    this._service = this._accessory.getService(this._platform.Service.Lightbulb)
      || this._accessory.addService(this._platform.Service.Lightbulb);
    //Set Characteristic Name
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

  //*************************************
  //* Class Getters
  /**
   * Handle the "GET" is dimmable
   * @example
   * getIsDimable()
   */
  public getIsDimmable() {
    return this._config.isDimmable;
  }

  //*************************************
  //* HomeBridge Delegates (Binds)

  /**
   * Handle the "SET/GET" ON requests from HomeKit
   */

  private setOn(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {
    const isDimmable = this.getIsDimmable();

    if (targetValue === this._dimmerState.On) {
      callback(null);
      return;
    }

    this._dimmerState.On = targetValue as boolean;

    if (targetValue === true) {
      this._dimmerState.Brightness = 100;
    } else {
      this._dimmerState.Brightness = 0;
    }

    if (!this.getIsDimmable()) { //If we are not dimmable. Assume 100% brightness on on state.
      this._service.updateCharacteristic(this._platform.Characteristic.Brightness, this._dimmerState.Brightness);
    }

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(this._dimmerState.Brightness, isDimmable, this);
    }

    this._platform.log.debug('[Accessory][%s][setOn] [state: %s|dim: %s]', this._name, this._dimmerState.On, this.getIsDimmable());

    callback(null);
  }

  private getOn(callback: CharacteristicGetCallback) {
    const isOn = this._dimmerState.On;

    this._platform.log.debug('[Accessory][%s][getOn] is %s', this.getName(), isOn ? 'ON' : 'OFF');

    callback(null, isOn); //error,value
  }

  /**
   * Handle the "SET/GET" Brightness requests from HomeKit
   */

  private getBrightness(callback: CharacteristicGetCallback) {
    const brightness = this._dimmerState.Brightness;

    this._platform.log.debug('[Accessory][%s][getBrightness] -> %i', this._name, brightness);

    callback(null, brightness); //error,value
  }

  private setBrightness(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    if (targetValue === this._dimmerState.Brightness) {
      callback(null);
      return;
    }

    this._platform.log.debug('[Accessory][%s][setBrightness] -> %i', this.getName(), targetValue);

    const targetBrightnessVal = targetValue as number;
    this._dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }


    callback(null); // null or error
  }

  //*************************************
  //* Accessory Callbacks

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor.
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue) {
    this._platform.log.info('[Accessory][%s][updateBrightness] to %i', this._name, targetBrightnessVal);

    if (targetBrightnessVal === this._dimmerState.Brightness) { //If the value is the same. Ignore to save network traffic.
      return;
    }

    if (targetBrightnessVal > 0) {
      this._dimmerState.On = true;
    } else if (targetBrightnessVal <= 0) {
      this._dimmerState.On = false;
    }

    this._dimmerState.Brightness = targetBrightnessVal as number;
    this._service.updateCharacteristic(this._platform.Characteristic.On, this._dimmerState.On);
    this._service.updateCharacteristic(this._platform.Characteristic.Brightness, this._dimmerState.Brightness);
  }
}

/**
 * HomeworksShadeAccessory covers the shade class of devices from Lutron.
 *
 * Output commands will  set the TargetPosition and automatically initiate the
 * motion. The immediately reported status from Homeworks is the TargetPosition.
 *
 *  It appears that the end of the scrolling is indicated by an undocumented
 *  status ~OUTPUT,XXX,32,2,level. For now, we'll use this as a forced terminator
 *
 * Outside of this, no further status is reported. Worse, subsequent ?OUTPUT,x,1 polls
 * will show this TargetPosition but nothing in between
 */
export class HomeworksShadeAccessory extends HomeworksAccessory {
  private _service: Service;
  public lutronLevelChangeCallback? : SetLutronLevelCallback;

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
    super( platform, accessory, uuid, config);

    this._service = this._accessory.getService(this._platform.Service.WindowCovering)
      || this._accessory.addService(this._platform.Service.WindowCovering);
    this._service.setCharacteristic(this._platform.Characteristic.Name, this._accessory.context.device.name);

    //  Current position of the shade
    this._service.getCharacteristic(this._platform.Characteristic.CurrentPosition)
      .on('set', this.setCurrentPosition.bind(this))
      .on('get', this.getCurrentPosition.bind(this));

    //  Target position of the shade
    this._service.getCharacteristic(this._platform.Characteristic.TargetPosition)
      .on('set', this.setTargetPosition.bind(this))
      .on('get', this.getTargetPosition.bind(this));

    //  Current status of shade motion
    this._service.getCharacteristic(this._platform.Characteristic.PositionState)
      .on('set', this.setPositionState.bind(this))
      .on('get', this.getPositionState.bind(this));

    this._shadeState.PositionState = this._platform.Characteristic.PositionState.STOPPED;
  }


  //*************************************
  //* HomeBridge Delegates (Binds)

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getCurrentPosition(callback: CharacteristicGetCallback) {

    const position = this._shadeState.Position;

    this._platform.log.info('[Accessory][%s][getCurrentPosition] -> %i', this._name, position);

    callback(null, position); //error,value
  }

  private setCurrentPosition(position: CharacteristicValue, callback: CharacteristicSetCallback) {

    this._platform.log.info('WTF [Accessory][%s][setCurrentPosition] -> %i', this.getName(), position);

    const positionNumber = position as number;

    //  If there is no movement, no change necessary
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
   * Handle the "SET/GET" TargetPosition requests from HomeKit
   */

  private getTargetPosition(callback: CharacteristicGetCallback) {

    this._platform.log.info('[Accessory][%s][getTargetPosition] -> %i', this._name, this._shadeState.TargetPosition);

    callback(null, this._shadeState.TargetPosition); //error,value
  }

  private setTargetPosition(targetPosition: CharacteristicValue, callback: CharacteristicSetCallback) {
    this._platform.log.info('[Accessory][%s][setTargetPosition] -> %i', this.getName(), targetPosition);

    const targetPositionNumber = targetPosition as number;
    if (targetPositionNumber === this._shadeState.TargetPosition) {
      callback(null);
      return;
    }

    //  Begin motion to the target level. We only set the target level and let reported status
    //  set the current position
    this._shadeState.TargetPosition = targetPositionNumber;

    if (this.lutronLevelChangeCallback) {
      this.lutronLevelChangeCallback(this._shadeState.TargetPosition, false, this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getPositionState(callback: CharacteristicGetCallback) {

    this._platform.log.info('[Accessory][%s][getPositionState] -> %i', this._name, this._shadeState.PositionState);

    callback(null, this._shadeState.PositionState); //error,value
  }

  private setPositionState(targetState: CharacteristicValue, callback: CharacteristicSetCallback) {

    this._platform.log.info('WTF [Accessory][%s][setPositionState] -> %i', this.getName(), targetState);

    //  Don't know what to do here.
    callback(null); // null or error
  }

  //*************************************
  //* Accessory Callbacks

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor. (set externally)
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue) {
    this._platform.log.info('[Accessory][%s][updateBrightness] to %i', this._name, targetBrightnessVal);

    const targetPositionNumber = targetBrightnessVal as number;

    //  If there is no change, then there's nothing for us to do
    if (targetPositionNumber === this._shadeState.Position) {
      return;
    }

    if (!this._shadeState.IsInitialized) {
      this._shadeState.TargetPosition = targetPositionNumber;
      this._shadeState.IsInitialized = true;
    }

    this._shadeState.Position = targetPositionNumber;
    this._service.updateCharacteristic(this._platform.Characteristic.CurrentPosition, this._shadeState.Position);

    //  When the current position matches the target position, motion of the shade is stoppped. Note
    //  we do this regardless of whether the device is stopped
    if (this._shadeState.Position === this._shadeState.TargetPosition) {
      this.stopped();
    }
  }

  public stopped(){
    this._platform.log.info('[Accessory][%s][stopped]', this.getName());

    this._shadeState.PositionState = this._platform.Characteristic.PositionState.STOPPED;
    this._service.updateCharacteristic(this._platform.Characteristic.PositionState, this._shadeState.PositionState);
  }
}
