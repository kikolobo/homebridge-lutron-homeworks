import { ConfigDevice } from './device';

/**
 * Represents the homebridge configuration for the plugin.
 */
export interface Configuration {

    /**
     * Gets or sets the devices that should be exposed to HomeKit/via API.
     */
    devices: Array<ConfigDevice>;
   
    
    /**
     * Gets or sets the port at which the API should be available.
     */
    apiPort: number;
    
    /**
     * Gets or sets the secret token that is used to authenticate against the API.
     */
    host: string;
    
    /**
     * Gets or sets the username for the Homeworks processor.
     */
    username: string;

    /**
     * Gets or sets the password for the Homeworks processor.
     */
    password: string;
        
}