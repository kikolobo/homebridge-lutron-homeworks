import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
interface SetLutronBrightnessCallback { (value: number, isDimmable:boolean, Accessory:HomeworksAccessory): void }


//*************************************
/**
 * HomeworksAccessory
 * An instance of this class is created for each accessory your platform registers
 */
export class HomeworksAccessory {
  private service: Service;
  public lutronBrightnessChangeCallback? : SetLutronBrightnessCallback;

  public dimmerState = {
    On: false,
    Brightness: 0,
    PositionState: 2
  }

  private _name;
  private _integrationId;
  private _UUID;
  private _deviceType: string;
  private _dimmable = true;
  
  constructor(
    private readonly platform: HomeworksPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly uuid: string,
    private readonly integrationId: string,
    private readonly deviceType: string,
    private readonly dimmable: boolean,
  ) {
    
    //Assign local variables
    this._name = accessory.context.device.name;
    this._UUID = uuid;
    this._integrationId = integrationId;
    this._deviceType = deviceType || 'light';
    this._dimmable = dimmable;

    //Set Info
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this.platform.Characteristic.Model, 'Homeworks Plugin')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'n/a')
      // .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '0.2');

    if (this._deviceType === 'shade') {
      this.service = this.accessory.getService(this.platform.Service.WindowCovering) || this.accessory.addService(this.platform.Service.WindowCovering);
      this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

      //  Current position of the shade
      this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .on('set', this.setCurrentPosition.bind(this))
        .on('get', this.getCurrentPosition.bind(this));

      //  Target position of the shade
      this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
        .on('set', this.setTargetPosition.bind(this))
        .on('get', this.getTargetPosition.bind(this));

      //  Current status of shade motion
      //  TODO: Is this ever invoked?
      this.service.getCharacteristic(this.platform.Characteristic.PositionState)
        .on('set', this.setPositionState.bind(this))
        .on('get', this.getPositionState.bind(this));

      this.dimmerState.PositionState = this.platform.Characteristic.PositionState.STOPPED;

    } else {
      //Assign HK Service
      this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
      //Set Characteristic Name
      this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

      // register handlers for the On/Off Characteristic (minimum for lightbulb)
      this.service.getCharacteristic(this.platform.Characteristic.On)
        .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
        .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below
      // register handlers for the Brightness Characteristic
      if (dimmable === true) {
        this.service.getCharacteristic(this.platform.Characteristic.Brightness)
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
    return this._UUID;
  }


  /**
   * Handle the "GET" UUID
   * @example
   * getUUID() 
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

    if (targetValue === this.dimmerState.On) {
      callback(null);
      return; 
    } 

    this.dimmerState.On = targetValue as boolean;
    
    if (targetValue === true) {
      this.dimmerState.Brightness = 100;
    } else {
      this.dimmerState.Brightness = 0;
    }

    if (this.getIsDimmable() === false) { //If we are not dimmable. Assume 100% brightness on on state.
      this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.dimmerState.Brightness);
    }
    
    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(this.dimmerState.Brightness, isDimmable, this);
    }

    this.platform.log.debug('[Accessory][setOn] %s [name: %s|dim: %s]', this.dimmerState.On, this._name, this._dimmable);

    callback(null);
  }

  private getOn(callback: CharacteristicGetCallback) {
    const isOn = this.dimmerState.On;

    if (isOn === true) {
      this.platform.log.debug('[Accessory][getOn] %s is ON', this.getName());
    } else {
      this.platform.log.debug('[Accessory][getOn] %s is OFF', this.getName());
    }
    
    callback(null, isOn); //error,value
  }    

  /**
   * Handle the "SET/GET" Brightness requests from HomeKit
   */

  private getBrightness(callback: CharacteristicGetCallback) {    
    const brightness = this.dimmerState.Brightness;

    this.platform.log.debug('[Accessory] Get Characteristic Brightness -> %i %s', brightness, this._name);
    
    callback(null, brightness); //error,value
  }

  private setBrightness(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    if (targetValue === this.dimmerState.Brightness) {
      callback(null);
      return;
    }
    
    this.platform.log.debug('[Accessory] Set Characteristic Brightness -> %i %s', targetValue, this.getName());

    const targetBrightnessVal = targetValue as number;        
    this.dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this); 
    }
        

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getCurrentPosition(callback: CharacteristicGetCallback) {
    const brightness = this.dimmerState.Brightness;

    this.platform.log.info('[Accessory] Get CurrentPosition -> %i %s', brightness, this._name);

    callback(null, brightness); //error,value
  }

  private setCurrentPosition(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    this.platform.log.info('[Accessory] Set CurrentPosition -> %i %s', targetValue, this.getName());

    if (targetValue === this.dimmerState.Brightness) {
      callback(null);
      return;
    }

    const targetBrightnessVal = targetValue as number;
    this.dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getTargetPosition(callback: CharacteristicGetCallback) {
    const brightness = this.dimmerState.Brightness;

    this.platform.log.info('[Accessory] Get TargetPosition -> %i %s', brightness, this._name);

    callback(null, brightness); //error,value
  }

  private setTargetPosition(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    this.platform.log.info('[Accessory] Set TargetPosition -> %i %s', targetValue, this.getName());

    if (targetValue === this.dimmerState.Brightness) {
      callback(null);
      return;
    }

    const targetBrightnessVal = targetValue as number;
    this.dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this);
    }

    callback(null); // null or error
  }

  /**
   * Handle the "SET/GET" CurrentPosition requests from HomeKit
   */

  private getPositionState(callback: CharacteristicGetCallback) {
    this.platform.log.info('[Accessory] Get PositionState -> %i %s', this.dimmerState.PositionState, this._name);

    callback(null, this.dimmerState.PositionState); //error,value
  }

  private setPositionState(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    this.platform.log.info('[Accessory] Set PositionState -> %i %s', targetValue, this.getName());

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
    this.platform.log.info('[Accessory][updateBrightness] to %i for %s', targetBrightnessVal, this._name);

    if (targetBrightnessVal === this.dimmerState.Brightness) { //If the value is the same. Ignore to save network traffic.
      return; 
    }

    if (targetBrightnessVal > 0) {
      this.dimmerState.On = true;
    } else if (targetBrightnessVal <= 0) {
      this.dimmerState.On = false;                   
    }    
    
    this.dimmerState.Brightness = targetBrightnessVal as number;    
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.dimmerState.On);
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, this.dimmerState.Brightness);
  }
}
