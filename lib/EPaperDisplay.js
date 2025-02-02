const EventEmitter = require('events');
const DisplayImageConverter = require("./DisplayImageConverter");
const DisplayPatternGenerator = require("./DisplayPatternGenerator");
const Logger = require("./Logger");
const DisplayTypes = require("./DisplayTypes");

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

        const bytesPerPage = (this.width * this.pageHeight) / 8;
        Logger.log(this.deviceId, 'info', 'Display initialized:');
        Logger.log(this.deviceId, 'info', `Type: ${displayType}`);
        Logger.log(this.deviceId, 'info', `Resolution: ${width}x${height}`);
        Logger.log(this.deviceId, 'info', `Page size: ${this.pageHeight} rows`);
        Logger.log(this.deviceId, 'info', `Bytes per page: ${bytesPerPage}`);
        Logger.log(this.deviceId, 'info', `Total pages needed: ${Math.ceil(this.height / this.pageHeight)}`);

        this.updateConnection(socket, this.pageHeight);
    }

    updateConnection(socket) {
        this.socket = socket;
        this.connected = true;
        this.setupSocketHandlers();

        Logger.log(this.deviceId, 'info', 'Display connected');
        Logger.log(this.deviceId, 'info', `Resolution: ${this.width}x${this.height}`);
        Logger.log(this.deviceId, 'info', `Page size: ${this.pageHeight} rows`);

        // If we have content, resend it, otherwise initialize
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
            this.emit('disconnected');
        });

        this.socket.on('error', (err) => {
            Logger.log(this.deviceId, 'error', `Socket error: ${err}`);
            this.connected = false;
        });

        let buffer = '';
        this.socket.on('data', (data) => {
            buffer += data.toString();

            if (buffer.includes('\n')) {
                const messages = buffer.split('\n');
                buffer = messages.pop();

                messages.forEach(msg => {
                    const response = msg.trim();
                    this.emit('response', response);
                });
            }
        });
    }

    async initializeDisplay() {
        const { displayBuffer, patternIndex } = DisplayPatternGenerator.generatePattern(this.width, this.height);

        // Set the state immediately
        this.contentToDisplay = {
            displayBuffer: displayBuffer,
            timestamp: Date.now()
        };

        Logger.log(this.deviceId, 'info', `Initialized content with test pattern ${patternIndex}`);

        // Then try to make the physical display match
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
                // If currently drawing, store the new content
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

    async sendPage(pageNumber, displayBufferSlice, timeout = 10000) {
        if (!this.connected) {
            throw new Error('Display not connected');
        }

        const expectedPageSize = (this.width * this.pageHeight) / 8;
        const totalSize = expectedPageSize * DisplayTypes[this.displayType].bitsPerPixel;
        const command = `PAGE:${pageNumber},${totalSize}\n`;

        Logger.log(this.deviceId, 'debug', `Sending page ${pageNumber}:`);
        Logger.log(this.deviceId, 'debug', `Total size: ${totalSize} bytes`);

        return new Promise((resolve, reject) => {
            const responseHandler = (response) => {
                Logger.log(this.deviceId, 'debug', `Received response: ${response}`);
                clearTimeout(timeoutId);

                if (response === 'ACK') {
                    this.removeListener('response', responseHandler);
                    resolve();
                } else if (response === 'NACK') {
                    this.removeListener('response', responseHandler);
                    reject(new Error('Page send failed'));
                }
            };

            const timeoutId = setTimeout(() => {
                this.removeListener('response', responseHandler);
                reject(new Error(`Timeout waiting for page ${pageNumber} acknowledgment`));
            }, timeout);

            this.on('response', responseHandler);

            this.socket.write(command);
            this.socket.write('DATA_START\n');
            this.socket.write(displayBufferSlice);
            this.socket.write('DATA_END\n');
        });
    }

    async refresh(timeout = 30000) {
        if (!this.connected) {
            throw new Error('Display not connected');
        }

        return new Promise((resolve, reject) => {
            Logger.log(this.deviceId, 'debug', 'Sending REFRESH command');

            const responseHandler = (response) => {
                Logger.log(this.deviceId, 'debug', `Received response: ${response}`);
                clearTimeout(timeoutId);

                if (response === 'ACK') {
                    this.removeListener('response', responseHandler);
                    resolve();
                } else if (response === 'NACK') {
                    this.removeListener('response', responseHandler);
                    reject(new Error('Refresh failed'));
                }
            };

            const timeoutId = setTimeout(() => {
                this.removeListener('response', responseHandler);
                reject(new Error('Timeout waiting for refresh acknowledgment'));
            }, timeout);

            this.on('response', responseHandler);
            this.socket.write('REFRESH:\n');
        });
    }

    async displayImage(displayBuffer) {
        this.isDrawing = true;
        try {
            const pageCount = Math.ceil(this.height / this.pageHeight);
            const bytesPerPage = (this.width * this.pageHeight) / 8;  // Base page size

            for (let page = 0; page < pageCount; page++) {
                let pageBuffer;

                switch(this.displayType) {
                    case "BW":
                        pageBuffer = displayBuffer.slice(
                            page * bytesPerPage,
                            (page + 1) * bytesPerPage
                        );
                        break;

                    case "BWR":
                    case "BWY":
                        const blackStart = page * bytesPerPage;
                        const blackEnd = blackStart + bytesPerPage;
                        const colorStart = blackStart + (displayBuffer.length / 2);
                        const colorEnd = colorStart + bytesPerPage;

                        pageBuffer = Buffer.concat([
                            displayBuffer.slice(blackStart, blackEnd),
                            displayBuffer.slice(colorStart, colorEnd)
                        ]);
                        break;
                }
                // 4-color and 7 color expect different formats

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
}

module.exports = EPaperDisplay;