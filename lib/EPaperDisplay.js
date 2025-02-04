const EventEmitter = require('events');
const DisplayImageConverter = require("./DisplayImageConverter");
const DisplayPatternGenerator = require("./DisplayPatternGenerator");
const Logger = require("./Logger");
const DisplayTypes = require("./DisplayTypes");
const Mutex = require("./Mutex");

class EPaperDisplay extends EventEmitter {
    constructor(deviceId, width, height, pageHeight, socket, displayType) {
        super();
        this.deviceId = deviceId;
        this.width = width;
        this.height = height;
        this.pageHeight = pageHeight;
        this.socket = socket;
        this.displayType = displayType;
        this.connected = true;
        this.isDrawing = false;
        this.contentToDisplay = null;
        this.queuedContent = null;
        this.imageConverter = new DisplayImageConverter(width, height, displayType);
        this.commandMutex = new Mutex();
        this.pendingAck = null;
        this.pingInterval = null;
        this.lastPongTime = Date.now();
        this.lastRssi = null;
        this.lastUptime = null;
        this.lastFreeHeap = null;

        const bytesPerPage = (this.width * this.pageHeight) / 8;
        Logger.log(this.deviceId, 'info', 'Display initialized:');
        Logger.log(this.deviceId, 'info', `Type: ${displayType}`);
        Logger.log(this.deviceId, 'info', `Resolution: ${width}x${height}`);
        Logger.log(this.deviceId, 'info', `Page size: ${this.pageHeight} rows`);
        Logger.log(this.deviceId, 'info', `Bytes per page: ${bytesPerPage}`);
        Logger.log(this.deviceId, 'info', `Total pages needed: ${Math.ceil(this.height / this.pageHeight)}`);

        this.updateConnection(socket);
    }

    updateConnection(socket) {
        this.socket = socket;
        this.connected = true;
        this.setupSocketHandlers();
        this.startPingInterval();

        Logger.log(this.deviceId, 'info', 'Display connected');
        Logger.log(this.deviceId, 'info', `Resolution: ${this.width}x${this.height}`);
        Logger.log(this.deviceId, 'info', `Page size: ${this.pageHeight} rows`);

        if (this.contentToDisplay) {
            Logger.log(this.deviceId, 'info', 'Restoring previous display content');

            this.displayImage(
                this.contentToDisplay.displayBuffer
            ).catch(err => {
                Logger.log(this.deviceId, 'error', `Failed to restore display content: ${err}`);
            });
        } else {
            this.initializeDisplay();
        }
    }

    setupSocketHandlers() {
        this.socket.on('close', () => {
            Logger.log(this.deviceId, 'info', 'Display disconnected');
            this.connected = false;
            this.stopPingInterval();
        });

        this.socket.on('error', (err) => {
            Logger.log(this.deviceId, 'error', `Socket error: ${err}`);
            this.connected = false;
            this.stopPingInterval();
        });

        let buffer = '';
        this.socket.on('data', (data) => {
            buffer += data.toString();

            if (buffer.includes('\n')) {
                const messages = buffer.split('\n');
                buffer = messages.pop();

                messages.forEach(msg => {
                    const response = msg.trim();
                    if (response.startsWith('PONG:')) {
                        this.handlePong(response.substring(5));
                    } else if (this.pendingAck) {
                        if (response === 'ACK') {
                            this.pendingAck.resolve();
                        } else if (response === 'NACK') {
                            this.pendingAck.reject(new Error('Command failed'));
                        }
                        this.pendingAck = null;
                    }
                });
            }
        });
    }

    startPingInterval() {
        this.stopPingInterval();
        this.pingInterval = setInterval(() => this.sendPing(), 30000);
    }

    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    async sendPing() {
        if (!this.connected) {
            this.stopPingInterval();
            return;
        }

        try {
            await this.commandMutex.withLock(async () => {
                this.socket.write(`PING:${Date.now()}\n`);
            });
        } catch (err) {
            Logger.log(this.deviceId, 'error', `Failed to send ping: ${err}`);
            this.connected = false;
            this.stopPingInterval();
        }
    }

    handlePong(data) {
        this.lastPongTime = Date.now();
        const [rssi, uptime, freeHeap] = data.split(',');
        this.lastRssi = parseInt(rssi);
        this.lastUptime = parseInt(uptime);
        this.lastFreeHeap = parseInt(freeHeap);
        //Logger.log(this.deviceId, 'debug', `PONG received - RSSI: ${rssi}dBm, Uptime: ${uptime}s, Free heap: ${freeHeap}bytes`);
    }

    async initializeDisplay() {
        const { displayBuffer, patternIndex } = DisplayPatternGenerator.generatePattern(this.width, this.height);

        this.contentToDisplay = {
            displayBuffer: displayBuffer,
            timestamp: Date.now()
        };

        Logger.log(this.deviceId, 'info', `Initialized content with test pattern ${patternIndex}`);

        try {
            await this.displayImage(displayBuffer);
        } catch (err) {
            Logger.log(this.deviceId, 'error', `Failed to initialize display with test pattern: ${err}`);
        }
    }

    async queueImage(imageData) {
        try {
            const displayBuffer = await this.imageConverter.transformImage(imageData);
            const newContent = {
                displayBuffer: displayBuffer,
                timestamp: Date.now()
            };

            if (this.isDrawing) {
                this.queuedContent = newContent;
                Logger.log(this.deviceId, 'info', 'Image queued while display is busy');
            } else {
                this.contentToDisplay = newContent;

                this.displayImage(displayBuffer).catch(err => {
                    Logger.log(this.deviceId, 'error', `Display process failed: ${err}`);
                });
            }

            return displayBuffer;
        } catch (error) {
            Logger.log(this.deviceId, 'error', `Error processing image: ${error}`);
            throw error;
        }
    }

    async waitForAck(timeout = 10000) {
        if (this.pendingAck) {
            throw new Error('Already waiting for ACK');
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (this.pendingAck) {
                    this.pendingAck = null;
                    reject(new Error('Timeout waiting for acknowledgment'));
                }
            }, timeout);

            this.pendingAck = {
                resolve: () => {
                    clearTimeout(timeoutId);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            };
        });
    }

    async sendPage(pageNumber, displayBufferSlice, timeout = 10000) {
        if (!this.connected) {
            throw new Error('Display not connected');
        }

        const remainingRows = Math.min(
            this.pageHeight,
            this.height - (pageNumber * this.pageHeight)
        );
        const actualPageSize = (this.width * remainingRows) / 8;
        const totalSize = actualPageSize * DisplayTypes[this.displayType].bitsPerPixel;

        Logger.log(this.deviceId, 'debug', `Sending page ${pageNumber}:`);
        Logger.log(this.deviceId, 'debug', `Total size: ${totalSize} bytes`);

        await this.commandMutex.withLock(async () => {
            this.socket.write(`PAGE:${pageNumber},${totalSize}\n`);
            this.socket.write('DATA_START\n');
            this.socket.write(displayBufferSlice);
            this.socket.write('DATA_END\n');
            await this.waitForAck(timeout);
        });
    }

    async refresh(timeout = 30000) {
        if (!this.connected) {
            throw new Error('Display not connected');
        }

        Logger.log(this.deviceId, 'debug', 'Sending REFRESH command');
        await this.commandMutex.withLock(async () => {
            this.socket.write('REFRESH:\n');
            await this.waitForAck(timeout);
        });
    }

    async displayImage(displayBuffer) {
        this.isDrawing = true;
        try {
            const pageCount = Math.ceil(this.height / this.pageHeight);
            const bytesPerPage = (this.width * this.pageHeight) / 8;

            for (let page = 0; page < pageCount; page++) {
                const remainingRows = Math.min(
                    this.pageHeight,
                    this.height - (page * this.pageHeight)
                );
                const actualPageSize = (this.width * remainingRows) / 8;

                let pageBuffer;
                switch(this.displayType) {
                    case "BW":
                        pageBuffer = displayBuffer.slice(
                            page * bytesPerPage,
                            page * bytesPerPage + actualPageSize
                        );
                        break;

                    case "BWR":
                    case "BWY":
                        const blackStart = page * bytesPerPage;
                        const blackEnd = blackStart + actualPageSize;
                        const colorStart = blackStart + (displayBuffer.length / 2);
                        const colorEnd = colorStart + actualPageSize;

                        pageBuffer = Buffer.concat([
                            displayBuffer.slice(blackStart, blackEnd),
                            displayBuffer.slice(colorStart, colorEnd)
                        ]);
                        break;
                }

                try {
                    await this.sendPage(page, pageBuffer);
                    Logger.log(this.deviceId, 'info', `Page ${page}/${pageCount-1} sent successfully`);
                } catch (err) {
                    Logger.log(this.deviceId, 'error', `Failed to send page ${page}: ${err}`);
                    throw err;
                }
            }

            Logger.log(this.deviceId, 'info', 'Starting refresh...');
            await this.refresh();
            Logger.log(this.deviceId, 'info', 'Display refreshed successfully');

            if (this.queuedContent) {
                const nextContent = this.queuedContent;
                this.queuedContent = null;
                this.contentToDisplay = nextContent;
                await this.displayImage(nextContent.displayBuffer);
            }
        } catch (err) {
            Logger.log(this.deviceId, 'error', `Display operation failed: ${err}`);
            throw err;
        } finally {
            this.isDrawing = false;
        }
    }

    cleanup() {
        this.stopPingInterval();
    }
}

module.exports = EPaperDisplay;