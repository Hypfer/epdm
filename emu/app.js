const net = require('net');
const EventEmitter = require('events');
const DisplayTypes = require("../lib/DisplayTypes");

class DisplayEmulator extends EventEmitter {
    constructor(width = 960, height = 640, deviceId = null, displayType = 'BWR') {
        super();
        this.width = width;
        this.height = height;
        this.deviceId = deviceId || `epd-frame-${Math.random().toString(16).slice(2, 8)}`;
        this.displayType = displayType;
        this.connected = false;
        this.pageHeight = 16;
        this.reconnectTimer = null;
        this.host = null;
        this.port = null;

        // Calculate buffer size based on display type
        const totalPixels = (this.width * this.height);
        this.displayBuffer = Buffer.alloc(totalPixels / (8 / DisplayTypes[this.displayType].bitsPerPixel), 0xFF);

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

            const hello = `HELLO:${this.deviceId},${this.displayType},${this.width},${this.height},${this.pageHeight}\n`;
            console.log(`[${this.deviceId}] Sending: ${hello.trim()}`);
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
        if (this.state === 'RECEIVING_PAGE_DATA') {
            // Check if this chunk contains DATA_END
            const dataEndIndex = data.indexOf('DATA_END\n');
            if (dataEndIndex !== -1) {
                // Split the data at DATA_END
                const binaryPart = data.slice(0, dataEndIndex);
                this.handlePageData(binaryPart);
                this.processPageData();

                // Process any remaining data after DATA_END as new commands
                const remainingData = data.slice(dataEndIndex + 9); // 9 is length of "DATA_END\n"
                if (remainingData.length > 0) {
                    this.handleData(remainingData);
                }
            } else {
                // Just binary data
                this.handlePageData(data);
            }
            return;
        }

        // Handle text commands
        const dataStr = data.toString();
        const lines = dataStr.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            console.log(`[${this.deviceId}] Processing line: "${line}"`);

            if (this.state === 'WAITING_COMMAND') {
                if (line === 'ACK') {
                    console.log(`[${this.deviceId}] Received ACK`);
                    this.emit('ack');
                    continue;
                }

                const [cmd, args] = line.split(':');
                console.log(`[${this.deviceId}] Command: ${cmd}, Args: ${args}`);

                if (cmd === 'PAGE') {
                    const [pageNum, size] = args.split(',');
                    console.log(`[${this.deviceId}] Receiving page ${pageNum}, size ${size}`);

                    this.currentPageNum = parseInt(pageNum);
                    this.expectedDataSize = parseInt(size);
                    this.receivedDataSize = 0;
                    this.currentPageData = Buffer.alloc(0);
                    this.state = 'WAITING_DATA_START';
                }
                else if (cmd === 'REFRESH') {
                    console.log(`[${this.deviceId}] Refresh command received`);
                    setTimeout(() => {
                        this.socket.write('ACK\n');
                        console.log(`[${this.deviceId}] Display refreshed`);
                    }, 1000);
                }
                else if (cmd === 'REBOOT') {
                    console.log(`[${this.deviceId}] Reboot command received`);
                    this.socket.write('ACK\n');
                    process.exit(0);
                }
            }
            else if (this.state === 'WAITING_DATA_START' && line === 'DATA_START') {
                console.log(`[${this.deviceId}] Received DATA_START`);
                this.state = 'RECEIVING_PAGE_DATA';

                // Process any remaining data as binary
                const remainingData = data.slice(data.indexOf(line) + line.length + 1);
                if (remainingData.length > 0) {
                    this.handleData(remainingData);
                }
                break;
            }
        }
    }

    handlePageData(data) {
        this.currentPageData = Buffer.concat([this.currentPageData, data]);
        this.receivedDataSize += data.length;
        console.log(`[${this.deviceId}] Total received: ${this.receivedDataSize}/${this.expectedDataSize} bytes`);
    }

    processPageData() {
        console.log(`[${this.deviceId}] Processing page data: ${this.receivedDataSize}/${this.expectedDataSize} bytes`);

        if (this.receivedDataSize !== this.expectedDataSize) {
            console.log(`[${this.deviceId}] Data size mismatch. Expected: ${this.expectedDataSize}, Got: ${this.receivedDataSize}`);
            this.socket.write('NACK\n');
        } else {
            const pageOffset = this.currentPageNum * (this.width * this.pageHeight * DisplayTypes[this.displayType].bitsPerPixel / 8);

            switch(this.displayType) {
                case 'BW':
                    this.currentPageData.copy(this.displayBuffer, pageOffset);
                    break;
                case 'BWR':
                case 'BWY':
                    this.currentPageData.copy(this.displayBuffer, pageOffset);
                    break;
            }

            console.log(`[${this.deviceId}] Page ${this.currentPageNum} processed successfully`);
            this.socket.write('ACK\n');
        }

        // Reset state
        this.state = 'WAITING_COMMAND';
        this.currentPageData = Buffer.alloc(0);
        this.expectedDataSize = 0;
        this.receivedDataSize = 0;
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

    const emulator = new DisplayEmulator(960, 640, 'epd-frame-EMU', "BW");
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