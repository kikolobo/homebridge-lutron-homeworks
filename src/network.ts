import { Logger } from 'homebridge';

enum ComState {
    Boot,
    Connecting,
    Establishing,
    Connected,
    Disconnected
}

// enum NetEvent {
//     DidConnect,
//     DidDisconnect,
//     DidReceive,
//     DeviceUpdate,    
// }

interface DidConnectCallback { (engine:NetworkEngine): void }
interface DidReceiveCallback { (engine:NetworkEngine, message: string): void }


export class NetworkEngine {
    private readonly net = require('net');
    private readonly socket = new this.net.Socket();
    private status: ComState = ComState.Boot;
    private crlf = '\r\n';
    private didReceiveCallback? : DidReceiveCallback;
    private didConnectCallback? : DidConnectCallback;
    
    constructor(
        public readonly log: Logger,
        private host: string,
        private port: number,
        private username: string,
        private password: string,
    ) {
      this.setupBinding();
      this.setupSocketListeners();
      this.log.debug('[Network] Instance Ready');
    }

    connect() {
      this.log.info('[Network] Connecting to:', this.host);
      if (this.status === ComState.Boot) {
        this.status = ComState.Connecting;
        this.log.debug('[Network] Connecting to socket...');
        this.socket.connect(this.port, this.host, () => {        
          this.log.debug('[Network] socket Connected'); 
          this.status = ComState.Establishing;                
        });
      } else {
        this.log.error('[Network] Cant connect, socket in invalid state');
      }
    }

    send(message:string) {
      if (this.status !== ComState.Connected) {
        this.log.debug('[Network] Socket not ready. Request to send ignored.');
        return; 
      }

      this.socket.write(message + this.crlf);
    }
    
    
    // CALLBACKS <<<<<<<<<<<<<<<<<<<<<<<<<<<<
    private didConnect() {
      this.log.error('[CB] DidConnect');
      if (this.didConnectCallback) {
        this.didConnectCallback(this); 
      }
      // this.socket.write('#MONITORING,5,1' + this.crlf); // Send Monitoring Query        
    }

    private didReceiveMessage(message:string) {
      this.log.error('[CB] DidRX:', message);
      if (this.didReceiveCallback) {
        this.didReceiveCallback(this, message); 
      }
      // if (stringData.includes('~MONITORING,5,1')) {                
      //   this.log.debug('[Network] Monitoring Zones Aknowledged by Server');
      //   this.log.info('Connected to HW socket [' + this.host + ']');          
      //    return;
      //   //   for (const accesory of this.homeworksAccesories) {
      //   //     this.log.debug('[Network] Requesting updates for:', accesory.name);
      //   //     const command = `?OUTPUT,${accesory._integrationId},1`;
      //   //     this.socket.write(command + this.crlf);
      //   //   }

          
      //   return;
      // }
    }




    // Setup Helpers <<<<<<<<<<<<<<<<<<<<<<<<<<<<
    private setupBinding() {
      this.socket.on('error', (err) => {      
        this.log.debug('[Network] Error: ', err);      
      });

      this.socket.on('close', () => {      
        this.status = ComState.Disconnected;
        this.log.error('[Network] Connection Lost');
      }); 
      
      this.socket.on('end', () => {      
        this.status = ComState.Disconnected;
        this.log.error('[Network] Connection Ended');
      });  
       
    }

    private setupSocketListeners() {
      this.socket.on('data', (data) => {      
        const stringData = data.toString();        

      
        if (stringData.includes('login:')) {
          this.log.debug('[Network] Establishing Session...');
          this.socket.write(this.username + this.crlf);
          return;
        }

        if (stringData.includes('password:')) {
          this.log.debug('[Network] Authenticating...');
          this.socket.write(this.password + this.crlf);
          return;
        }
         
        if (stringData.includes('QNET>')) { // Prompt
          if (this.status !== ComState.Connected) {
            this.status = ComState.Connected;
            this.didConnect();                
          }
          return;
        }

        

        this.didReceiveMessage(stringData);       
      });
    }
}