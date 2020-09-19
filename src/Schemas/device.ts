/**
 * Represents a load/device from the homeworks processor.
 */
export interface Device {

    /**
     * Gets or sets a unique name for the device that will also be used in the API.
     */
    name: string;

    /**
     * Gets or sets the integration ID of the light/load/dimmer
     */
    integrationID: string;

    /**
     * Gets or sets a value that determines whether is dimmable 
     */
    isDimmable: boolean;    
}