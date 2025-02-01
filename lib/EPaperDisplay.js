const EventEmitter = require('events');
const DisplayImageConverter = require("./DisplayImageConverter");
const Logger = require("./logger");

class EPaperDisplay extends EventEmitter {
    constructor(deviceId, width, height, pageHeight, socket) {
        super();
        this.deviceId = deviceId;
        this.width = width;
        this.height = height;
        this.pageHeight = pageHeight;
        this.socket = socket;
        this.connected = true;
        this.isDrawing = false;
        this.pendingImage = null;
        this.imageConverter = new DisplayImageConverter(width, height);

        const bytesPerPage = (this.width * this.pageHeight) / 8;
        Logger.log(this.deviceId, 'info', 'Display initialized:');
        Logger.log(this.deviceId, 'info', `Resolution: ${width}x${height}`);
        Logger.log(this.deviceId, 'info', `Page size: ${this.pageHeight} rows`);
        Logger.log(this.deviceId, 'info', `Bytes per page: ${bytesPerPage}`);
        Logger.log(this.deviceId, 'info', `Total pages needed: ${Math.ceil(this.height / this.pageHeight)}`);

        this.setupSocketHandlers();
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
            //this.emit('error', err);
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

    async drawNextImage() {
        if (this.pendingImage && !this.isDrawing) {
            try {
                this.isDrawing = true;
                await this.displayImageFile(this.pendingImage);
                this.pendingImage = null;
            } catch (error) {
                Logger.log(this.deviceId, 'error', `Error drawing pending image: ${error}`);
            } finally {
                this.isDrawing = false;
                // Check if there's another pending image
                if (this.pendingImage) {
                    this.drawNextImage();
                }
            }
        }
    }

    async queueImage(imageData) {
        this.pendingImage = imageData;
        await this.drawNextImage();
    }

    async sendPage(pageNumber, blackBuffer, colorBuffer, timeout = 10000) {
        if (!this.connected) {
            throw new Error('Display not connected');
        }

        const expectedPageSize = (this.width * this.pageHeight) / 8;

        const fullBlackBuffer = Buffer.alloc(expectedPageSize, 0xFF);
        const fullColorBuffer = Buffer.alloc(expectedPageSize, 0xFF);

        blackBuffer.copy(fullBlackBuffer);
        colorBuffer.copy(fullColorBuffer);

        const totalSize = expectedPageSize * 2;
        const command = `PAGE ${pageNumber} ${totalSize}\n`;

        Logger.log(this.deviceId, 'debug', `Sending page ${pageNumber}:`);
        Logger.log(this.deviceId, 'debug', `Expected size per buffer: ${expectedPageSize} bytes`);
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
            this.socket.write(Buffer.concat([fullBlackBuffer, fullColorBuffer]));
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
            this.socket.write('REFRESH\n');
        });
    }

    async displayImage(blackBuffer, colorBuffer) {
        const pageCount = Math.ceil(this.height / this.pageHeight);
        const bytesPerPage = (this.width * this.pageHeight) / 8;

        for (let page = 0; page < pageCount; page++) {
            const start = page * bytesPerPage;
            const end = start + bytesPerPage;

            const pageBlackBuffer = blackBuffer.slice(start, end);
            const pageColorBuffer = colorBuffer.slice(start, end);

            try {
                await this.sendPage(page, pageBlackBuffer, pageColorBuffer);
                Logger.log(this.deviceId, 'info', `Page ${page}/${pageCount-1} sent successfully`);
            } catch (err) {
                Logger.log(this.deviceId, 'error', `Failed to send page ${page}: ${err}`);
                throw err;
            }
        }

        try {
            Logger.log(this.deviceId, 'info', 'Starting refresh...');
            await this.refresh();
            Logger.log(this.deviceId, 'info', 'Display refreshed successfully');
        } catch (err) {
            Logger.log(this.deviceId, 'error', `Failed to refresh display: ${err}`);
            throw err;
        }
    }

    async displayImageFile(imageData) {
        try {
            const { blackBuffer, colorBuffer } = await this.imageConverter.transformImage(imageData);
            await this.displayImage(blackBuffer, colorBuffer);

            Logger.log(this.deviceId, 'info', 'Image displayed successfully');
        } catch (err) {
            Logger.log(this.deviceId, 'error', `Failed to display image: ${err}`);
            throw err;
        }
    }
}

module.exports = EPaperDisplay;