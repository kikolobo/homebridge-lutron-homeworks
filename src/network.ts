import { Socket } from 'net';

import { Logger } from 'homebridge';

interface DidReceiveCallback {
  (engine: NetworkEngine, message: string): void;
}

interface DidConnectCallback {
  (engine: NetworkEngine): void;
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
  Disconnected,
}

/**
 * Prompt printed by the processor once it is ready for a command
 * (QNET> on HomeWorks QS, GNET> on other Lutron processors). It can arrive on
 * its own or glued to the front of the next line of output.
 */
const PROMPT_REGEX = /^(?:\s*[A-Z]NET>\s*)+/;

export class NetworkEngine {
  // How long we may take to go from TCP connect to monitoring acknowledged.
  // HomeWorks processors are slow to answer (a reply can take a couple of
  // seconds), so every timeout below is generous rather than tight.
  private static readonly ESTABLISH_TIMEOUT_MS = 30000;
  // How often #MONITORING is re-sent while waiting for its acknowledgement.
  private static readonly MONITORING_RETRY_MS = 5000;
  // Average time between re-sending #MONITORING on an established session, in
  // case the processor quietly stopped reporting to it. The command is
  // idempotent. Each refresh lands at a random point between 25 and 35
  // minutes so child bridges do not send it together.
  private static readonly MONITORING_REFRESH_MS = 30 * 60 * 1000;
  // Average time between liveness checks. Each check is scheduled at a random
  // point between half and one and a half times this, so child bridges
  // started together drift apart and do not ping the processor in lockstep.
  private static readonly HEARTBEAT_INTERVAL_MS = 5000;
  // Ping once nothing has been received for this long. With the check spacing
  // above, the first ping goes out 15-22.5s into a silence, keeping the
  // session well inside the ~30s of idle the processor is known to tolerate.
  private static readonly PING_AFTER_IDLE_MS = 15000;
  // Minimum time between pings, so a slow reply is not met with another ping.
  private static readonly PING_RETRY_MS = 10000;
  // Consider the connection dead once nothing has been received for this long
  // (two to three unanswered pings).
  private static readonly DEAD_AFTER_IDLE_MS = 45000;
  // Reconnect backoff bounds.
  private static readonly RECONNECT_MIN_MS = 5000;
  private static readonly RECONNECT_MAX_MS = 60000;
  // How long the processor gets to close the session after we log out
  // before we close the socket ourselves.
  private static readonly LOGOUT_GRACE_MS = 3000;

  private socket: Socket | null = null;
  private status: ComState = ComState.Boot;
  private readonly crlf = '\r\n';
  private isShuttingDown = false;

  // Bytes received that do not yet form a complete line.
  private receiveBuffer = '';
  private lastReceivedAt = 0;
  private lastPingAt = 0;
  private reconnectDelayMs = NetworkEngine.RECONNECT_MIN_MS;

  // Telnet sessions this bridge has opened since Homebridge started, and why
  // the current one ended. Each child bridge keeps its own count.
  private sessionCount = 0;
  private sessionOpenedAt = 0;
  private sessionCloseReason: string | null = null;
  private sessionLastError: string | null = null;

  // Timers scoped to the current connection; all cleared in teardownConnection().
  private establishTimeoutRef: NodeJS.Timeout | null = null;
  private monitoringRetryRef: NodeJS.Timeout | null = null;
  private heartbeatRef: NodeJS.Timeout | null = null;
  private monitoringRefreshRef: NodeJS.Timeout | null = null;
  // Pending reconnect; outlives the connection that scheduled it.
  private reconnectRef: NodeJS.Timeout | null = null;

  private didReceiveCallbacks: DidReceiveCallback[] = [];
  private didConnectCallbacks: DidConnectCallback[] = [];

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
    if (this.status !== ComState.Boot) {
      this.log.error('[Network] Cannot connect, socket in invalid state');
      return;
    }

    this.sessionCount++;
    this.sessionOpenedAt = Date.now();
    this.sessionCloseReason = null;
    this.sessionLastError = null;
    this.log.info(`[Network] Session #${this.sessionCount}: connecting to ${this.host}:${this.port}`);

    this.status = ComState.Connecting;
    this.receiveBuffer = '';
    this.lastReceivedAt = Date.now();

    const socket = new Socket();
    this.socket = socket;
    this.setupSocketListeners(socket);

    // Detect a peer that vanished without closing the connection (power loss,
    // network drop). The application-level heartbeat below backs this up.
    socket.setKeepAlive(true, 10000);
    socket.setNoDelay(true);

    // Whatever happens next, we must reach Ready within this window or start over.
    this.establishTimeoutRef = setTimeout(() => {
      this.establishTimeoutRef = null;
      if (this.status !== ComState.Ready) {
        this.dropConnection(`not established within ${NetworkEngine.ESTABLISH_TIMEOUT_MS / 1000}s (stuck at ${ComState[this.status]})`);
      }
    }, NetworkEngine.ESTABLISH_TIMEOUT_MS);

    this.log.debug('[Network] Connecting to socket...');
    socket.connect(this.port, this.host, () => {
      this.log.debug('[Network] Socket Connected');
      if (this.socket === socket) {
        this.status = ComState.Connected;
      }
    });
  }

  /**
   * Send a command to the processor. Commands are dropped rather than queued
   * when the connection is not ready: written to a socket that is still
   * logging in they would be read as the username or password.
   *
   * @returns true if the command was written.
   */
  public send(message: string): boolean {
    if (this.status !== ComState.Ready) {
      this.log.warn(`[Network] Not connected. Dropping command: ${message}`);
      return false;
    }
    return this.write(message);
  }

  public addDevicesFromConfig(configDevices: unknown[]): void {
    this.log.info(`[Network] Processing ${configDevices.length} devices from config`);

    configDevices.forEach((device, index) => {
      if (this.isValidDeviceConfig(device)) {
        this.devicesToMonitor.push({
          integrationID: device.integrationID,
          name: device.name,
        });
        this.log.debug(`[Network] Added device: ${device.name} (ID: ${device.integrationID})`);
      } else {
        this.log.warn(`[Network] Invalid device configuration at index ${index}: ${JSON.stringify(device)}`);
      }
    });

    this.log.info(`[Network] Total devices configured: ${this.devicesToMonitor.length}`);
  }

  private isValidDeviceConfig(device: unknown): device is { integrationID: string; name: string } {
    return typeof device === 'object' &&
           device !== null &&
           'integrationID' in device &&
           'name' in device &&
           typeof (device as { integrationID: unknown }).integrationID === 'string' &&
           typeof (device as { name: unknown }).name === 'string';
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
  private write(message: string): boolean {
    if (!this.socket || this.socket.destroyed || !this.socket.writable) {
      this.log.warn(`[Network] Socket not writable. Dropping: ${message}`);
      return false;
    }
    this.socket.write(message + this.crlf);
    return true;
  }

  private setupSocketListeners(socket: Socket): void {
    // Every handler ignores events from a socket that has since been replaced.

    socket.on('error', (err: Error) => {
      if (socket !== this.socket) {
        return;
      }
      this.sessionLastError = err.message;
      this.log.error(`[Network] Session #${this.sessionCount} error:`, err.message);
    });

    socket.on('close', () => {
      if (socket !== this.socket) {
        return;
      }

      this.teardownConnection();
      this.status = ComState.Disconnected;

      const reason = this.sessionCloseReason
        ?? (this.sessionLastError ? `error: ${this.sessionLastError}` : 'closed by processor or network');
      const durationS = Math.round((Date.now() - this.sessionOpenedAt) / 1000);
      const message = `[Network] Session #${this.sessionCount} closed after ${durationS}s: ${reason}. `
        + `Sessions opened by this bridge: ${this.sessionCount}`;

      // Homebridge is shutting us down. Do not schedule another reconnect.
      if (this.isShuttingDown) {
        this.log.info(message);
        return;
      }

      this.log.warn(message);

      this.scheduleReconnect();
    });

    socket.on('data', (data: Buffer) => {
      if (socket !== this.socket) {
        return;
      }

      this.lastReceivedAt = Date.now();
      this.receiveBuffer += data.toString();

      this.log.debug(`[Network] Received: ${JSON.stringify(data.toString())}`);

      // TCP does not preserve message boundaries: handle complete lines only
      // and keep any trailing partial line for the next chunk.
      const lines = this.receiveBuffer.split(/\r?\n/);
      this.receiveBuffer = lines.pop() ?? '';

      for (const line of lines) {
        this.handleLine(line);
      }

      // The login prompts and the command prompt are not newline terminated,
      // so they sit in the buffer as a partial line.
      this.handlePartialLine();

      // Guard against an unterminated stream growing without bound.
      if (this.receiveBuffer.length > 4096) {
        this.log.warn('[Network] Discarding oversized partial line');
        this.receiveBuffer = '';
      }
    });
  }

  private handlePartialLine(): void {
    const partial = this.receiveBuffer;

    if (/login:\s*$/i.test(partial)) {
      this.receiveBuffer = '';
      this.status = ComState.Authenticating;
      this.log.debug('[Network] Authenticating Step 1...');
      this.write(this.username);
      return;
    }

    if (/password:\s*$/i.test(partial)) {
      this.receiveBuffer = '';
      this.status = ComState.Authenticating;
      this.log.debug('[Network] Authenticating Step 2...');
      this.write(this.password);
      return;
    }

    if (PROMPT_REGEX.test(partial) && partial.replace(PROMPT_REGEX, '').length === 0) {
      this.receiveBuffer = '';
      this.handlePrompt();
    }
  }

  private handleLine(rawLine: string): void {
    const promptMatch = rawLine.match(PROMPT_REGEX);
    const line = rawLine.replace(PROMPT_REGEX, '').trim();

    if (promptMatch) {
      this.handlePrompt();
    }

    if (line.length === 0) {
      return;
    }

    // A successful login is followed directly by the prompt; a failed one by
    // another login prompt, which handlePartialLine() answers.
    if (/^login incorrect|^bad login/i.test(line)) {
      this.log.error('[Network] Login rejected by processor. Check username and password');
      return;
    }

    if (line.startsWith(`~MONITORING,${this.integrationId},1`)) {
      if (this.status === ComState.Establishing) {
        this.onMonitoringAcknowledged();
      }
      return;
    }

    this.fireDidReceiveCallbacks(line);
  }

  private handlePrompt(): void {
    if (this.status === ComState.Authenticating || this.status === ComState.Connected) {
      this.requestMonitoring();
    }
  }

  private requestMonitoring(): void {
    this.status = ComState.Establishing;
    this.log.debug('[Network] Requesting Monitoring Query');
    this.write(`#MONITORING,${this.integrationId},1`);

    // Keep asking until it is acknowledged; the establish timeout bounds this.
    if (this.monitoringRetryRef) {
      clearInterval(this.monitoringRetryRef);
    }
    this.monitoringRetryRef = setInterval(() => {
      if (this.status === ComState.Establishing) {
        this.log.warn('[Network] Monitoring not acknowledged. Requesting again');
        this.write(`#MONITORING,${this.integrationId},1`);
      }
    }, NetworkEngine.MONITORING_RETRY_MS);
  }

  private onMonitoringAcknowledged(): void {
    this.status = ComState.Ready;
    this.reconnectDelayMs = NetworkEngine.RECONNECT_MIN_MS;
    this.log.info(`[Network] Session #${this.sessionCount}: ready (monitoring acknowledged)`);

    if (this.monitoringRetryRef) {
      clearInterval(this.monitoringRetryRef);
      this.monitoringRetryRef = null;
    }
    if (this.establishTimeoutRef) {
      clearTimeout(this.establishTimeoutRef);
      this.establishTimeoutRef = null;
    }

    this.startHeartbeat();
    this.scheduleMonitoringRefresh();
    this.fireDidConnectCallbacks();
  }

  /**
   * Any traffic from the processor counts as proof of life. After a quiet
   * spell we ping it; if it still says nothing, the connection is dead even
   * though TCP has not noticed, so drop it and reconnect.
   */
  private startHeartbeat(): void {
    const jitteredIntervalMs = NetworkEngine.HEARTBEAT_INTERVAL_MS * (0.5 + Math.random());

    this.heartbeatRef = setTimeout(() => {
      this.heartbeatRef = null;
      if (this.checkHeartbeat()) {
        this.startHeartbeat();
      }
    }, jitteredIntervalMs);
  }

  private scheduleMonitoringRefresh(): void {
    const jitteredMs = NetworkEngine.MONITORING_REFRESH_MS * (5 / 6 + Math.random() / 3);

    this.monitoringRefreshRef = setTimeout(() => {
      this.monitoringRefreshRef = null;
      if (this.status !== ComState.Ready) {
        return;
      }
      this.log.debug(`[Network] Session #${this.sessionCount}: refreshing monitoring`);
      this.write(`#MONITORING,${this.integrationId},1`);
      this.scheduleMonitoringRefresh();
    }, jitteredMs);
  }

  /**
   * @returns false if the connection was found dead and is being dropped.
   */
  private checkHeartbeat(): boolean {
    const now = Date.now();
    const sinceReceivedMs = now - this.lastReceivedAt;

    // Only what we receive proves the processor is alive; having sent
    // something proves nothing, so sending never postpones the ping.
    if (sinceReceivedMs >= NetworkEngine.DEAD_AFTER_IDLE_MS) {
      this.dropConnection(`no response from processor in ${Math.round(sinceReceivedMs / 1000)}s`);
      return false;
    }

    if (sinceReceivedMs >= NetworkEngine.PING_AFTER_IDLE_MS && now - this.lastPingAt >= NetworkEngine.PING_RETRY_MS) {
      this.lastPingAt = now;
      this.log.debug('[Network][Ping] Sent');
      this.write('?SYSTEM,6');
    }

    return true;
  }

  private scheduleReconnect(): void {
    const delayMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, NetworkEngine.RECONNECT_MAX_MS);

    this.log.warn(`[Network] Reconnecting in ${delayMs / 1000}s as session #${this.sessionCount + 1}`);

    if (this.reconnectRef) {
      clearTimeout(this.reconnectRef);
    }
    this.reconnectRef = setTimeout(() => {
      this.reconnectRef = null;
      this.status = ComState.Boot;
      this.connect();
    }, delayMs);
  }

  /**
   * Close the current session on purpose, recording why for the close log.
   * The 'close' handler then cleans up and schedules the reconnect.
   */
  private dropConnection(reason: string): void {
    this.log.error(`[Network] Session #${this.sessionCount}: dropping connection, ${reason}`);
    this.sessionCloseReason = reason;
    this.closeSocket();
  }

  /**
   * Close the current socket, logging out first if we are logged in so the
   * processor frees the session immediately rather than whenever it notices
   * the TCP close. A processor that never answers cannot hold us up: the
   * socket is destroyed after a short grace period regardless.
   */
  private closeSocket(): void {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return;
    }

    // Before login completes, 'logout' would be read as a username or password.
    const loggedIn = this.status === ComState.Establishing || this.status === ComState.Ready;

    if (!loggedIn || !socket.writable) {
      socket.destroy();
      return;
    }

    this.log.debug(`[Network] Session #${this.sessionCount}: logging out`);
    socket.end('logout' + this.crlf);

    // Never hold Homebridge open on our account.
    setTimeout(() => socket.destroy(), NetworkEngine.LOGOUT_GRACE_MS).unref();
  }

  private teardownConnection(): void {
    for (const ref of [this.establishTimeoutRef, this.monitoringRetryRef, this.heartbeatRef, this.monitoringRefreshRef]) {
      if (ref) {
        clearTimeout(ref);
      }
    }
    this.establishTimeoutRef = null;
    this.monitoringRetryRef = null;
    this.heartbeatRef = null;
    this.monitoringRefreshRef = null;
    this.receiveBuffer = '';
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

  // Cleanup
  public disconnect(): void {
    this.log.info('[Network] Disconnecting...');

    this.isShuttingDown = true;
    this.teardownConnection();

    if (this.reconnectRef) {
      clearTimeout(this.reconnectRef);
      this.reconnectRef = null;
    }

    if (this.socket) {
      this.sessionCloseReason = 'Homebridge shutdown';
      this.closeSocket();
    }

    this.status = ComState.Disconnected;
  }
}
