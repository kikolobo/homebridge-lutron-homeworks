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
         
        if (stringData.includes('QNET>')) { // Prompt          
          if (this.status === ComState.Authenticating) {
            this.status = ComState.Establishing;
            // this.log.debug('[Network] Got Prompt');
            this.log.debug('[Network] Requesting Monitoring Query');
            this.socket.write('#MONITORING,5,1' + this.crlf); // Send Monitoring Query             
          } 
          return;
        }

        if (stringData.includes('~MONITORING,5,1')) {          
          if (this.status === ComState.Establishing) {
            this.status = ComState.Ready;
            this.log.debug('[Network] Monitoring Query Acknowledged');
            this.fireDidConnectCallbacks();  
            this.setAutoPing();          
          }
          return;
        }

        this.fireDidReceiveCallbacks(stringData);             
        
      });
    }

    private setAutoPing() {      
      setTimeout(() => {        
        if (this.status === ComState.Ready) {
          this.log.debug('[Network] Ping Sent');
          this.socket.write('?SYSTEM,8' + this.crlf); // Send Ping (OS REV)
        }
        this.setAutoPing();
      }, 59000);
    }


    // Callback Helpers <<<<<<<<<<<<<<<<<<<<<<<<<<<<
    public registerReceiveCallback(callback:DidReceiveCallback) {
      this.didReceiveCallbacks.push(callback);    
      this.log.debug('[Network] DidReceiveCallback Registered.');  
    }

    public registerDidConnectCallback(callback:DidConnectCallback) {
      this.didConnectCallbacks.push(callback);    
      this.log.debug('[Network] DidConnectCallback Registered.');  
    }

    public fireDidReceiveCallbacks(message:string) {            
      for (const callback of this.didReceiveCallbacks) {        
        callback(this, message);
      }      
    }
    

    public fireDidConnectCallbacks() {
      for (const callback of this.didConnectCallbacks) {        
        callback(this);
      }
    }
}