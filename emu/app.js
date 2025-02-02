const net = require('net');
const EventEmitter = require('events');

class DisplayEmulator extends EventEmitter {
    constructor(width = 960, height = 640, deviceId = null) {
        super();
        this.width = width;
        this.height = height;
        this.deviceId = deviceId || `epd-frame-${Math.random().toString(16).slice(2, 8)}`;
        this.connected = false;
        this.pageHeight = 16;
        this.reconnectTimer = null;
        this.host = null;
        this.port = null;

        // Emulate display buffers
        this.blackBuffer = Buffer.alloc((this.width * this.height) / 8, 0xFF);
        this.colorBuffer = Buffer.alloc((this.width * this.height) / 8, 0xFF);

        // State machine
        this.state = 'WAITING_COMMAND';
        this.currentPageData = Buffer.alloc(0);
        this.expectedDataSize = 0;
        this.receivedDataSize = 0;
    }

    connect(host, port) {
        this.host = host;
        this.port = port;

        if (this.socket) {
            this.socket.destroy();
        }

        this.socket = new net.Socket();

        this.socket.on('connect', () => {
            console.log(`[${this.deviceId}] Connected to server`);
            this.connected = true;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            const hello = `HELLO ${this.deviceId} ${this.width} ${this.height}\n`;
            this.socket.write(hello);
        });

        this.socket.on('data', (data) => {
            this.handleData(data);
        });

        this.socket.on('close', () => {
            console.log(`[${this.deviceId}] Disconnected from server`);
            this.connected = false;
            this.scheduleReconnect();
        });

        this.socket.on('error', (err) => {
            console.error(`[${this.deviceId}] Socket error:`, err);
            this.scheduleReconnect();
        });

        console.log(`[${this.deviceId}] Attempting to connect to ${host}:${port}`);
        this.socket.connect(port, host);
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;

        console.log(`[${this.deviceId}] Scheduling reconnection attempt in 5 seconds...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.connected) {
                console.log(`[${this.deviceId}] Attempting to reconnect...`);
                this.connect(this.host, this.port);
            }
        }, 5000);
    }

    handleData(data) {
        if (this.state === 'WAITING_COMMAND') {
            const commandStr = data.toString();
            if (!commandStr.includes('\n')) return; // Wait for complete command

            const lines = commandStr.split('\n');
            const command = lines[0].trim();

            if (command === 'ACK') {
                console.log(`[${this.deviceId}] Received ACK`);
                this.emit('ack');
                return;
            }

            if (command.startsWith('PAGE')) {
                const [, pageNum, size] = command.split(' ');
                console.log(`[${this.deviceId}] Receiving page ${pageNum}, size ${size}`);

                this.currentPageNum = parseInt(pageNum);
                this.expectedDataSize = parseInt(size);
                this.receivedDataSize = 0;
                this.currentPageData = Buffer.alloc(0);

                this.state = 'RECEIVING_PAGE_DATA';

                // Handle any remaining data as page data
                if (lines.length > 1) {
                    const remainingData = data.slice(data.indexOf('\n') + 1);
                    this.handlePageData(remainingData);
                }
                return;
            }

            if (command === 'REFRESH') {
                console.log(`[${this.deviceId}] Refresh command received`);
                setTimeout(() => {
                    this.socket.write('ACK\n');
                    console.log(`[${this.deviceId}] Display refreshed`);
                }, 1000);
                return;
            }

            console.log(`[${this.deviceId}] Unknown command:`, command);
            return;
        }

        if (this.state === 'RECEIVING_PAGE_DATA') {
            this.handlePageData(data);
        }
    }

    handlePageData(data) {
        this.currentPageData = Buffer.concat([this.currentPageData, data]);
        this.receivedDataSize += data.length;

        if (this.receivedDataSize >= this.expectedDataSize) {
            // Process the complete page
            const blackData = this.currentPageData.slice(0, this.expectedDataSize/2);
            const colorData = this.currentPageData.slice(this.expectedDataSize/2, this.expectedDataSize);

            const pageOffset = this.currentPageNum * (this.width * this.pageHeight / 8);
            blackData.copy(this.blackBuffer, pageOffset);
            colorData.copy(this.colorBuffer, pageOffset);

            console.log(`[${this.deviceId}] Page ${this.currentPageNum} received and processed`);
            this.socket.write('ACK\n');

            // Reset state
            this.state = 'WAITING_COMMAND';
            this.currentPageData = null;
            this.expectedDataSize = 0;
            this.receivedDataSize = 0;

            // Handle any extra data as new command
            if (this.receivedDataSize > this.expectedDataSize) {
                const extraData = this.currentPageData.slice(this.expectedDataSize);
                this.handleData(extraData);
            }
        }
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }
}

// Usage example:
if (require.main === module) {
    if (!process.env.EPD_PORT || !process.env.EPD_HOST) {
        console.error('Missing required environment variables: EPD_PORT and EPD_HOST must be set');
        process.exit(1);
    }

    const emulator = new DisplayEmulator(960, 640, 'epd-frame-EMU');
    emulator.connect(process.env.EPD_HOST, parseInt(process.env.EPD_PORT));

    // Handle process signals gracefully
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT. Disconnecting emulator...');
        emulator.disconnect();
        process.exit();
    });

    process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM. Disconnecting emulator...');
        emulator.disconnect();
        process.exit();
    });
}

module.exports = DisplayEmulator;