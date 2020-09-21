import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { HomeworksPlatform } from './platform';
interface SendBrightnessCommand { (value: number, accesory:HomeworksAccesory): void }

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomeworksAccesory {
  private service: Service;
  public homekitBrightnessUpdate? : SendBrightnessCommand;

  public dimmerState = {
    On: false,
    Brightness: 0,
  }

  public name;
  public _integrationId;
  public UUID;
  

  

  constructor(
    private readonly platform: HomeworksPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly uuid: string,
    private readonly integrationId: string,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    this.name = accessory.context.device.name;
    this.UUID = uuid;
    this._integrationId = integrationId;

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // register handlers for the Brightness Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .on('set', this.setBrightness.bind(this))       // SET - bind to the 'setBrightness` method below
      .on('get', this.getBrightness.bind(this));       // GET - bind to the 'getBrightness` method below
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  private setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to turn your device on/off
    this.dimmerState.On = value as boolean;
    
    if (value) {
      this.dimmerState.Brightness = 100; 
      if (this.homekitBrightnessUpdate) {
        this.homekitBrightnessUpdate(100, this);
      }
    } else {
      this.dimmerState.Brightness = 0; 
      if (this.homekitBrightnessUpdate) {
        this.homekitBrightnessUpdate(0, this);
      }
    }
  

    this.platform.log.debug('Set Characteristic isOn -> %b %s', this.dimmerState.On, this.name);

    // you must call the callback function
    callback(null);
  }


  public updateBrightness(brightnessVal) {
    this.platform.log.debug('Update Characteristic Brightness -> %i %s', brightnessVal, this.name);
    this.dimmerState.Brightness = brightnessVal;    
    if (brightnessVal > 0) {
      this.dimmerState.On = true; 
    } else {
      this.dimmerState.On = false;       
    }

    
    if (this.dimmerState.On === true) {
      this.service.updateCharacteristic(this.platform.Characteristic.On, true);
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }
    this.service.updateCharacteristic(this.platform.Characteristic.Brightness, brightnessVal);
  
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  private getOn(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const isOn = this.dimmerState.On;

    if (isOn) {
      this.platform.log.debug('Get Characteristic isOn -> ON %s', this.name);      
    } else {
      this.platform.log.debug('Get Characteristic isOn -> OFF %s', this.name);      
    }

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOn);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  private setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const brightnessVal = value as number;
    this.platform.log.debug('Set Characteristic Brightness -> %i %s', value, this.name);
    // implement your own code to set the brightness
    this.dimmerState.Brightness = brightnessVal;
    if (brightnessVal > 0) {
      this.dimmerState.On = true; 
    } else {
      this.dimmerState.On = false; 
    }    

    if (this.homekitBrightnessUpdate) {
      this.homekitBrightnessUpdate(brightnessVal, this);
    }
    
    // you must call the callback function
    callback(null);
  }

  private getBrightness(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const brightness = this.dimmerState.Brightness;

    this.platform.log.debug('Get Characteristic Brightness -> %i %s', brightness, this.name);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, brightness);
  }

}
