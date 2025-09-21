import { Logger } from 'homebridge';

interface DidReceiveCallback { (engine: NetworkEngine, message: string): void }
interface DidConnectCallback { (engine: NetworkEngine): void }
interface DeviceUpdateCallback { (engine: NetworkEngine, deviceUpdate: DeviceUpdate): void }

interface DeviceUpdate {
  integrationId: number;
  action: number;
  value: number;
  rawMessage: string;
}

interface MonitorDevice {
  integrationID: string;
  name: string;
}

enum ComState {
  Boot,
  Connecting,
  Authenticating,
  Connected,
  Establishing,
  Ready,
  Disconnected
}

export class NetworkEngine {
  private readonly net = require('net');
  private socket = new this.net.Socket();
  private status: ComState = ComState.Boot;
  private readonly crlf = '\r\n';
  private watchdogExpiredFlag = false;
  private pingWatchdogRef: NodeJS.Timeout | null = null;

  private didReceiveCallbacks: DidReceiveCallback[] = [];
  private didConnectCallbacks: DidConnectCallback[] = [];
  private deviceUpdateCallbacks: DeviceUpdateCallback[] = [];
  
  // Device monitoring
  private devicesToMonitor: MonitorDevice[] = [];
  private integrationId = 5; // Default integration ID for telnet connection

  constructor(
    public readonly log: Logger,
    private host: string,
    private port: number,
    private username: string,
    private password: string,
  ) {
    this.log.debug('[Network] Instance Ready');
  }

  // Public API
  public connect(): void {
    this.socket = new this.net.Socket();
    this.setupBinding();
    this.setupSocketListeners();

    this.log.info('[Network] Connecting to:', this.host);

    if (this.status === ComState.Boot) {
      this.status = ComState.Connecting;
      this.log.debug('[Network] Connecting to socket...');
      this.socket.connect(this.port, this.host, () => {
        this.log.debug('[Network] Socket Connected');
        this.status = ComState.Connected;
      });
    } else {
      this.log.error('[Network] Cannot connect, socket in invalid state');
    }
  }

  public send(message: string): void {
    if (this.status !== ComState.Ready) {
      this.log.warn('[Network] Socket not ready. Will attempt sending anyway.');
    }
    this.socket.write(message + this.crlf);
  }

  public addDevicesFromConfig(configDevices: any[]): void {
    this.log.info(`[Network] Processing ${configDevices.length} devices from config`);
    
    configDevices.forEach((device, index) => {
      if (device.integrationID && device.name) {
        this.devicesToMonitor.push({
          integrationID: device.integrationID,
          name: device.name
        });
        this.log.debug(`[Network] Added device: ${device.name} (ID: ${device.integrationID})`);
      } else {
        this.log.warn(`[Network] Invalid device configuration at index ${index}: ${JSON.stringify(device)}`);
      }
    });
    
    this.log.info(`[Network] Total devices configured: ${this.devicesToMonitor.length}`);
  }

  public setIntegrationId(id: number): void {
    this.integrationId = id;
    this.log.debug(`[Network] Integration ID set to ${id}`);
  }

  // Device control methods
  public setDeviceLevel(integrationID: string, level: number): void {
    if (this.status !== ComState.Ready) {
      this.log.warn('[Network] Cannot set device level - not ready');
      return;
    }

    const command = `#OUTPUT,${integrationID},1,${level}`;
    this.log.debug(`[Network] Setting device ${integrationID} to ${level}%: ${command}`);
    this.send(command);
  }

  public queryDeviceLevel(integrationID: string): void {
    if (this.status !== ComState.Ready) {
      this.log.warn('[Network] Cannot query device level - not ready');
      return;
    }

    const command = `?OUTPUT,${integrationID}`;
    this.log.debug(`[Network] Querying device ${integrationID}: ${command}`);
    this.send(command);
  }

  // Callback registration
  public registerReceiveCallback(callback: DidReceiveCallback): void {
    this.log.debug('[Network] DidReceiveCallback Registered');
    this.didReceiveCallbacks.push(callback);
  }

  public registerDidConnectCallback(callback: DidConnectCallback): void {
    this.log.debug('[Network] DidConnectCallback Registered');
    this.didConnectCallbacks.push(callback);
  }

  public registerDeviceUpdateCallback(callback: DeviceUpdateCallback): void {
    this.log.debug('[Network] DeviceUpdateCallback Registered');
    this.deviceUpdateCallbacks.push(callback);
  }

  // Status getters
  public getStatus(): ComState {
    return this.status;
  }

  public isReady(): boolean {
    return this.status === ComState.Ready;
  }

  public getMonitoredDevices(): MonitorDevice[] {
    return [...this.devicesToMonitor];
  }

  // Private implementation
  private setupBinding(): void {
    this.socket.on('error', (err: Error) => {
      this.log.error('[Network] Error:', err.message);
    });

    this.socket.on('close', () => {
      this.status = ComState.Disconnected;
      this.log.error('[Network] Connection Lost. Reconnect attempt in 5 seconds');
      
      // Clean up watchdog
      if (this.pingWatchdogRef) {
        clearTimeout(this.pingWatchdogRef);
        this.pingWatchdogRef = null;
      }
      
      setTimeout(() => {
        this.status = ComState.Boot;
        this.connect();
      }, 5000);
    });
  }

  private setupSocketListeners(): void {
    this.socket.on('data', (data: Buffer) => {
      const stringData = data.toString();
      this.watchdogExpiredFlag = false;
      this.padTheDog();

      this.log.debug(`[Network] Received: ${stringData.trim()}`);

      // Handle authentication sequence
      if (stringData.includes('login:')) {
        this.status = ComState.Authenticating;
        this.log.debug('[Network] Authenticating Step 1...');
        this.socket.write(this.username + this.crlf);
        return;
      }

      if (stringData.includes('password:')) {
        this.status = ComState.Authenticating;
        this.log.debug('[Network] Authenticating Step 2...');
        this.socket.write(this.password + this.crlf);
        return;
      }

      // Handle command prompt
      if (stringData.includes('T>')) { // Prompt (QNET>)
        if (this.status === ComState.Authenticating) {
          this.status = ComState.Establishing;
          this.log.debug('[Network] Requesting Monitoring Query');
          this.socket.write(`#MONITORING,5,1` + this.crlf);
          
          // Retry monitoring setup if no acknowledgment
          setTimeout(() => {
            if (this.status === ComState.Establishing) {
              this.log.warn('[Network] Requesting Monitoring Query [Second Attempt]');
              this.socket.write(`#MONITORING,5,1` + this.crlf);
            }
          }, 2500);
        }
        return;
      }

      // Handle monitoring acknowledgment
      if (stringData.includes(`~MONITORING,${this.integrationId},1`)) {
        if (this.status === ComState.Establishing) {
          this.status = ComState.Ready;
          this.log.info('[Network] Connected & Monitoring Query Acknowledged');
          
          
          this.fireDidConnectCallbacks();
          this.startPingWatchdog();
          this.padTheDog();
        }
        return;
      }

      // Parse device updates
      this.parseDeviceUpdates(stringData);
      
      // Fire general receive callbacks
      this.fireDidReceiveCallbacks(stringData);
    });
  }

  private parseDeviceUpdates(message: string): void {
    try {
      const messages = message.split('\r\n').filter(msg => msg.trim().length > 0);
      
      messages.forEach(msg => {
        // Handle ~OUTPUT format (integration ID based)
        if (msg.includes('~OUTPUT')) {
          const parts = msg.trim().split(',');
          if (parts.length >= 4 && parts[0] === '~OUTPUT') {
            const deviceUpdate: DeviceUpdate = {
              integrationId: parseInt(parts[1]),
              action: parseInt(parts[2]),
              value: parseFloat(parts[3]),
              rawMessage: msg.trim()
            };

            const device = this.devicesToMonitor.find(d => 
              parseInt(d.integrationID) === deviceUpdate.integrationId
            );

            if (device) {
              if (deviceUpdate.action === 1) { // Light level
                this.log.info(`[Network] ${device.name} brightness: ${deviceUpdate.value}%`);
              } else {
                this.log.debug(`[Network] ${device.name} action ${deviceUpdate.action}: ${deviceUpdate.value}`);
              }
              this.fireDeviceUpdateCallbacks(deviceUpdate);
            } else {
              this.log.debug(`[Network] Unknown integration ID ${deviceUpdate.integrationId}: ${msg.trim()}`);
            }
          }
        }
        
        // Handle ~DEVICE format (system device ID based)
        else if (msg.includes('~DEVICE')) {
          const parts = msg.trim().split(',');
          if (parts.length >= 4 && parts[0] === '~DEVICE') {
            const deviceUpdate: DeviceUpdate = {
              integrationId: parseInt(parts[1]),
              action: parseInt(parts[2]),
              value: parseFloat(parts[3]),
              rawMessage: msg.trim()
            };

            this.log.debug(`[Network] System device ${deviceUpdate.integrationId} action ${deviceUpdate.action}: ${deviceUpdate.value}`);
            this.fireDeviceUpdateCallbacks(deviceUpdate);
          }
        }
        
        // Log other interesting messages
        else if (msg.includes('~ADDRESS')) {
          this.log.debug(`[Network] ${msg.trim()}`);
        }
      });
    } catch (error) {
      this.log.error('[Network] Error parsing device update:', error);
      this.log.debug('[Network] Raw message:', message);
    }
  }

  // Watchdog implementation
  private startPingWatchdog(): void {
    const pingInterval = 20000; // 20 seconds
    
    const pingCheck = () => {
      if (this.status === ComState.Ready && this.watchdogExpiredFlag === true) {
        this.watchdogExpiredFlag = false;
        this.socket.write('?SYSTEM,6' + this.crlf);
        this.log.debug('[Network][Ping] Sent');
      }
      this.pingWatchdogRef = setTimeout(pingCheck, pingInterval);
    };

    this.pingWatchdogRef = setTimeout(pingCheck, pingInterval);
  }

  private padTheDog(): void {
    if (this.pingWatchdogRef) {
      clearTimeout(this.pingWatchdogRef);
    }
    
    this.pingWatchdogRef = setTimeout(() => {
      this.watchdogExpiredFlag = true;
    }, 30000); // 30 seconds
  }

  // Callback firing
  private fireDidReceiveCallbacks(message: string): void {
    for (const callback of this.didReceiveCallbacks) {
      try {
        callback(this, message);
      } catch (error) {
        this.log.error('[Network] Error in receive callback:', error);
      }
    }
  }

  private fireDidConnectCallbacks(): void {
    this.log.debug('[Network] fireDidConnectCallbacks');
    for (const callback of this.didConnectCallbacks) {
      try {
        callback(this);
      } catch (error) {
        this.log.error('[Network] Error in connect callback:', error);
      }
    }
  }

  private fireDeviceUpdateCallbacks(deviceUpdate: DeviceUpdate): void {
    for (const callback of this.deviceUpdateCallbacks) {
      try {
        callback(this, deviceUpdate);
      } catch (error) {
        this.log.error('[Network] Error in device update callback:', error);
      }
    }
  }

  // Cleanup
  public disconnect(): void {
    this.log.info('[Network] Disconnecting...');
    
    if (this.pingWatchdogRef) {
      clearTimeout(this.pingWatchdogRef);
      this.pingWatchdogRef = null;
    }
    
    this.status = ComState.Disconnected;
    
    if (this.socket) {
      this.socket.destroy();
    }
  }
}