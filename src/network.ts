import { Logger } from 'homebridge';

interface DidReceiveCallback { (engine:NetworkEngine, message: string): void }
interface DidConnectCallback { (engine:NetworkEngine): void }


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
    private crlf = '\r\n';
    private watchdogExpiredFlag = false;
    private pingWatchdogRef;
    
    private didReceiveCallbacks: DidReceiveCallback[] = [];
    private didConnectCallbacks: DidConnectCallback[] = [];

    constructor(
        public readonly log: Logger,
        private host: string,
        private port: number,
        private username: string,
        private password: string,
    ) {
      
      this.log.debug('[Network] Instance Ready');
    }

    connect() {      
      this.socket = new this.net.Socket();
      this.setupBinding();
      this.setupSocketListeners();
      
      this.log.info('[Network] Connecting to:', this.host);
      
      if (this.status === ComState.Boot) {
        this.status = ComState.Connecting;
        this.log.debug('[Network] Connecting to socket...');
        this.socket.connect(this.port, this.host, () => {        
          this.log.debug('[Network] socket Connected');  
          this.status = ComState.Connected;         
        });
      } else {
        this.log.error('[Network] Can`t connect, socket in invalid state');
      }
    }

    send(message:string) {
      if (this.status !== ComState.Ready) {
        this.log.error('[Network] Socket not ready. Request to send ignored.');
        return; 
      }
      this.socket.write(message + this.crlf);      
    }

    // Setup Helpers <<<<<<<<<<<<<<<<<<<<<<<<<<<<
    private setupBinding() {
      this.socket.on('error', (err) => {      
        this.log.debug('[Network] Error: ', err);         
      });

      this.socket.on('close', () => {      
        this.status = ComState.Disconnected;
        this.log.error('[Network] Connection Lost. Reconnect Attempt in 3 Secs.');
        setTimeout(() => {
          this.status = ComState.Boot;
          this.connect();
        }, 3000);
      }); 
       
    }

    private setupSocketListeners() {
      this.socket.on('data', (data) => {      
        const stringData = data.toString(); 
        this.watchdogExpiredFlag = false;
        this.padTheDog();                      
      
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
         
        if (stringData.includes('T>')) { // Prompt (QNET>)
          if (this.status === ComState.Authenticating) {
            this.status = ComState.Establishing;
            // this.log.debug('[Network] Got Prompt');
            this.log.debug('[Network] Requesting Monitoring Query');
            this.socket.write('#MONITORING,5,1' + this.crlf); // Send Monitoring Query             
            setTimeout(() => {   //For some reason, processor sometimes fails to answer on time.      
              if (this.status === ComState.Establishing) {
                this.log.warn('[Network] Requesting Monitoring Query [Second Attempt]');
                this.socket.write('#MONITORING,5,1' + this.crlf); // Send Monitoring Query 
              }
            }, 2500); //So let's retry in 2.5 seconds later if we did not rx aknowledgement.
          } 
          return;
        }

        if (stringData.includes('~MONITORING,5,1')) {  //Processor aknowledges monitoring command.
          if (this.status === ComState.Establishing) { //Lets mark connection stable.
            this.status = ComState.Ready;
            this.log.debug('[Network] Monitoring Query Acknowledged');
            this.fireDidConnectCallbacks(); //Fire Callbacks            
            this.startPingWatchdog(); //Start the verification cycle to see if we should ping on traffic silence
            this.padTheDog(); //Lets wake the watchdog (Falg)
          }
          return;
        }

        this.fireDidReceiveCallbacks(stringData);             
        
      });
    }

    // Watchdog/Ping Helpers <<<<<<<<<<<<<<<<<<<<<<<<<<<<

    // ####
    // # We use this methods to send pings to the processor every N seconds
    // # if we fail to see traffic going on. This will cause the sockets to
    // # Trigger an error and this engine to start a reconnect if the network is down.
    // # basically we reset a flag everytime we get data and set a timeout to set it again in N seconds
    // # If we get data, we reset the flag and the timeout for another N seconds.
    // # We have another cycle checking for flag sets every N seconds and if set. We trigger a PING.
    // # basically a request to the processor with arbitrary data that should trigger a response.
    // # 
    // # Traffic can get light on some times, and we should use conservative timeout values
    // # to keep traffic down.
    // ####
    
    //####
    //# Called once when the connection is stable & Every N seconds.
    private startPingWatchdog() { 
      setTimeout(() => {        
        if (this.status === ComState.Ready && this.watchdogExpiredFlag === true) { // No traffic in period? let's ping the system.
          this.watchdogExpiredFlag = false;          
          this.socket.write('?SYSTEM,6' + this.crlf); // Sonset query appears to be lightweight.
          this.log.debug('[Network][Ping] Sent...');
        } 
        this.startPingWatchdog(); //Reschedule watchdog even if we haven't expired.
      }, 30000); //N = 30 Seconds
    }

    //####
    //# Reset the flag and the timer since we received data and we should not ping.
    private padTheDog() { 
      clearTimeout(this.pingWatchdogRef); //Clear the previous timer (Watchdog)
      this.pingWatchdogRef = setTimeout(() => { //Make a new one for N seconds.
        this.watchdogExpiredFlag = true; 
      }, 50000); //N = 50 seconds.
    }

    // Callback Helpers <<<<<<<<<<<<<<<<<<<<<<<<<<<<

    // ####
    // # We use an array of registered callbacks for events. 
    // # When this engine is instantiate it the parent registers callbacks to
    // # be triggered when events happen.
    // # We assume that the parents will not be deallocated!. If they do we will crash.
    // ####
    
    public registerReceiveCallback(callback:DidReceiveCallback) { //Called when we receive data 
      this.didReceiveCallbacks.push(callback);    
      this.log.debug('[Network] DidReceiveCallback Registered.');  
    }

    public registerDidConnectCallback(callback:DidConnectCallback) { //Called when we connect.
      this.didConnectCallbacks.push(callback);    
      this.log.debug('[Network] DidConnectCallback Registered.');  
    }

    public fireDidReceiveCallbacks(message:string) {       
      for (const callback of this.didReceiveCallbacks) {    //We iterate thru all registered callers.          
        callback(this, message);  //And fire.
      }      
    }
    

    public fireDidConnectCallbacks() {
      for (const callback of this.didConnectCallbacks) {   //We iterate thru all registered callers.           
        callback(this);  //And fire.
      }
    }
}