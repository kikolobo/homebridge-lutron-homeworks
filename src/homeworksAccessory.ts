import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
interface SetLutronBrightnessCallback { (value: number, isDimmable:boolean, accesory:HomeworksAccesory): void }


//*************************************
/**
 * HomeworksAccesory
 * An instance of this class is created for each accessory your platform registers
 */
export class HomeworksAccesory {
  private service: Service;
  public lutronBrightnessChangeCallback? : SetLutronBrightnessCallback;

  public dimmerState = {
    On: false,
    Brightness: 0,
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

    this.platform.log.debug('[Accesory][setOn] %s [name: %s|dim: %s]', this.dimmerState.On, this._name, this._dimmable);

    callback(null);
  }



  private getOn(callback: CharacteristicGetCallback) {
    const isOn = this.dimmerState.On;

    if (isOn === true) {
      this.platform.log.debug('[Accesory][getOn] %s is ON', this.getName());
    } else {
      this.platform.log.debug('[Accesory][getOn] %s is OFF', this.getName());
    }
    
    callback(null, isOn); //error,value
  }    

  /**
   * Handle the "SET/GET" Brightness requests from HomeKit
   */

  private getBrightness(callback: CharacteristicGetCallback) {    
    const brightness = this.dimmerState.Brightness;

    this.platform.log.debug('[Accesory] Get Characteristic Brightness -> %i %s', brightness, this._name);
    
    callback(null, brightness); //error,value
  }


  private setBrightness(targetValue: CharacteristicValue, callback: CharacteristicSetCallback) {

    if (targetValue === this.dimmerState.Brightness) {
      callback(null);
      return;
    }
    
    this.platform.log.debug('[Accesory] Set Characteristic Brightness -> %i %s', targetValue, this.getName());

    const targetBrightnessVal = targetValue as number;        
    this.dimmerState.Brightness = targetBrightnessVal;

    if (this.lutronBrightnessChangeCallback) {
      this.lutronBrightnessChangeCallback(targetBrightnessVal, this.getIsDimmable(), this); 
    }
        

    callback(null); // null or error
  }

  //*************************************
  //* Accesory Callbacks

  /**
   * Called from processor when we need to update Homekit
   * With new values from processor. (set externally)
   */
  public updateBrightness(targetBrightnessVal: CharacteristicValue) { 
    if (targetBrightnessVal === this.dimmerState.Brightness) { //If the value is the same. Ignore to save network traffic.
      return; 
    }

    this.platform.log.debug('[Accesory][updateBrightness] to %i for %s', targetBrightnessVal, this._name);

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
