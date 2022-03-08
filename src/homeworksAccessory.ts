import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
interface SetLutronBrightnessCallback { (value: number, isDimmable:boolean, Accessory:HomeworksAccessory): void }


//*************************************
/**
 * HomeworksAccessory
 * An instance of this class is created for each accessory your platform registers
 */

export class HomeworksAccessory {
  private _service: Service;
  public lutronBrightnessChangeCallback? : SetLutronBrightnessCallback;

  public _dimmerState = {
    On: false,
    Brightness: 0,
    PositionState: 2,
  }

  private readonly _name;

  constructor(
    private readonly _platform: HomeworksPlatform,
    private readonly _accessory: PlatformAccessory,
    private readonly _uuid: string,
    private readonly _integrationId: string,
    private readonly _deviceType: string,
    private readonly _dimmable: boolean,
  ) {
    
    //Assign local variables
    this._name = _accessory.context.device.name;
    this._deviceType = this._deviceType || 'light';

    //Set Info
    this._accessory.getService(this._platform.Service.AccessoryInformation)!
      .setCharacteristic(this._platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this._platform.Characteristic.Model, 'Homeworks Plugin')
      .setCharacteristic(this._platform.Characteristic.SerialNumber, 'n/a');
    // .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '0.2');

    if (this._deviceType === 'shade') {
      this._service = this._accessory.getService(this._platform.Service.WindowCovering)
        || this._accessory.addService(this._platform.Service.WindowCovering);
      this._service.setCharacteristic(this._platform.Characteristic.Name, _accessory.context.device.name);

      //  Current position of the shade
      this._service.getCharacteristic(this._platform.Characteristic.CurrentPosition)
        .on('set', this.setCurrentPosition.bind(this))
        .on('get', this.getCurrentPosition.bind(this));

      //  Target position of the shade
      this._service.getCharacteristic(this._platform.Characteristic.TargetPosition)
        .on('set', this.setTargetPosition.bind(this))
        .on('get', this.getTargetPosition.bind(this));

      //  Current status of shade motion
      //  TODO: Is this ever invoked?
      this._service.getCharacteristic(this._platform.Characteristic.PositionState)
        .on('set', this.setPositionState.bind(this))
        .on('get', this.getPositionState.bind(this));

      this._dimmerState.PositionState = this._platform.Characteristic.PositionState.STOPPED;

    } else {
      //Assign HK Service
      this._service = this._accessory.getService(this._platform.Service.Lightbulb)
        || this._accessory.addService(this._platform.Service.Lightbulb);
      //Set Characteristic Name
      this._service.setCharacteristic(this._platform.Characteristic.Name, _accessory.context.device.name);

      // register handlers for the On/Off Characteristic (minimum for lightbulb)
      this._service.getCharacteristic(this._platform.Characteristic.On)
        .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
        .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below
      // register handlers for the Brightness Characteristic
      if (_dimmable) {
        this._service.getCharacteristic(this._platform.Characteristic.Brightness)
          .on('set', this.setBrightness.bind(this))       // SET - bind to the 'setBrightness` method below
          .on('get', this.getBrightness.bind(this));      // GET - bind to the 'getBrightness` method below
      }
    }
  }

  //*************************************
  //* Class Getters
  /**
   * Handle the "GET" integrationId
   * @example
   * getIntegrationId() 
   */
  public getIntegrationId() {
    return this._integrationId;
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
   * Handle the "GET" is dimmable
   * @example
   * getIsDimable()
   */
  public getIsDimmable() {
    return this._dimmable;
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
    
    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(this._dimmerState.Brightness, isDimmable, this);
    }

    this._platform.log.debug('[Accessory][setOn] %s [name: %s|dim: %s]', this._dimmerState.On, this._name, this._dimmable);

    callback(null);
  }

  private getOn(callback: CharacteristicGetCallback) {
    const isOn = this._dimmerState.On;

    if (isOn) {
      this._platform.log.debug('[Accessory][getOn] %s is ON', this.getName());
    } else {
      this._platform.log.debug('[Accessory][getOn] %s is OFF', this.getName());
    }
    
    callback(null, isOn); //error,value
  }    

  /**
   * Handle the "SET/GET" Brightness requests from HomeKit
   */

  private getBrightness(callback: CharacteristicGetCallback) {    
    const brightness = this._dimmerState.Brightness;

    this._platform.log.debug('[Accessory] Get Characteristic Brightness -> %i %s', brightness, this._name);
    
    callback(null, brightness); //error,value
  }

  private setBrightness(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    if (targetValue === this._dimmerState.Brightness) {
      callback(null);
      return;
    }
    
    this._platform.log.debug('[Accessory] Set Characteristic Brightness -> %i %s', targetValue, this.getName());

    const targetBrightnessVal = targetValue as number;        
    this._dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }
        

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getCurrentPosition(callback: CharacteristicGetCallback) {
    const brightness = this._dimmerState.Brightness;

    this._platform.log.info('[Accessory] Get CurrentPosition -> %i %s', brightness, this._name);

    callback(null, brightness); //error,value
  }

  private setCurrentPosition(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    this._platform.log.info('[Accessory] Set CurrentPosition -> %i %s', targetValue, this.getName());

    if (targetValue === this._dimmerState.Brightness) {
      callback(null);
      return;
    }

    const targetBrightnessVal = targetValue as number;
    this._dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getTargetPosition(callback: CharacteristicGetCallback) {
    const brightness = this._dimmerState.Brightness;

    this._platform.log.info('[Accessory] Get TargetPosition -> %i %s', brightness, this._name);

    callback(null, brightness); //error,value
  }

  private setTargetPosition(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    this._platform.log.info('[Accessory] Set TargetPosition -> %i %s', targetValue, this.getName());

    if (targetValue === this._dimmerState.Brightness) {
      callback(null);
      return;
    }

    const targetBrightnessVal = targetValue as number;
    this._dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getPositionState(callback: CharacteristicGetCallback) {
    this._platform.log.info('[Accessory] Get PositionState -> %i %s', this._dimmerState.PositionState, this._name);

    callback(null, this._dimmerState.PositionState); //error,value
  }

  private setPositionState(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    this._platform.log.info('[Accessory] Set PositionState -> %i %s', targetValue, this.getName());

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
    this._platform.log.info('[Accessory][updateBrightness] to %i for %s', targetBrightnessVal, this._name);

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
