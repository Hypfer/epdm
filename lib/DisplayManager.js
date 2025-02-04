const net = require('net');
const path = require('path');
const express = require('express');
const multer = require('multer');
const EPaperDisplay = require("./EPaperDisplay");
const {createCanvas} = require("canvas");

class DisplayManager {
    constructor() {
        this.displays = new Map();
        this.server = net.createServer(this.handleConnection.bind(this));

        this.app = express();
        this.setupExpressMiddleware();
        this.setupHttpRoutes();
    }

    setupExpressMiddleware() {
        const storage = multer.memoryStorage();
        const upload = multer({ storage: storage });
        
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '..', 'public')));
        this.upload = upload;
    }

    setupHttpRoutes() {
        this.app.get('/displays', (req, res) => {
            const displays = this.getAllDisplays().map(display => ({
                deviceId: display.deviceId,
                displayType: display.displayType,
                width: display.width,
                height: display.height,
                pageHeight: display.pageHeight,
                connected: display.connected,
            }));
            res.json(displays);
        });

        this.app.get('/displays/:deviceId', (req, res) => {
            const display = this.getDisplay(req.params.deviceId);
            if (!display) {
                return res.status(404).json({ error: 'Display not found' });
            }
            res.json({
                deviceId: display.deviceId,
                displayType: display.displayType,
                width: display.width,
                height: display.height,
                pageHeight: display.pageHeight,
                connected: display.connected,
            });
        });

        this.app.get('/displays/:deviceId/status', (req, res) => {
            const display = this.getDisplay(req.params.deviceId);
            if (!display) {
                return res.status(404).json({ error: 'Display not found' });
            }
            res.json({
                deviceId: display.deviceId,
                connected: display.connected,
                isDrawing: display.isDrawing
            });
        });

        this.app.get('/displays/:deviceId/image', (req, res) => {
            const display = this.getDisplay(req.params.deviceId);
            if (!display) {
                return res.status(404).json({ error: 'Display not found' });
            }

            if (!display.contentToDisplay) {
                return res.status(404).json({ error: 'No image available' });
            }

            res.json({
                displayBuffer: display.contentToDisplay.displayBuffer.toString('base64'),
                width: display.width,
                height: display.height,
                timestamp: display.contentToDisplay.timestamp
            });
        });

        this.app.post('/displays/:deviceId/image', this.upload.single('image'), async (req, res) => {
            try {
                const display = this.getDisplay(req.params.deviceId);
                if (!display) {
                    return res.status(404).json({ error: 'Display not found' });
                }

                if (!req.file) {
                    return res.status(400).json({ error: 'No image file provided' });
                }
                
                const generatePreview = req.query.preview === 'true';
                
                const convertedBuffer = await display.queueImage(req.file.buffer);

                const response = {
                    message: 'Image accepted and queued for display',
                    status: display.isDrawing ? 'queued' : 'drawing'
                };

                if (generatePreview) {
                    const previewImage = await this.generatePreview(
                        convertedBuffer,
                        display.width,
                        display.height,
                        display.displayType
                    );
                    response.preview = previewImage.toString('base64');
                }

                res.json(response);

            } catch (error) {
                console.error('Error handling image:', error);
                res.status(500).json({ error: 'Failed to process image' });
            }
        });

        this.app.get('/displays/:deviceId/view', async (req, res) => {
            try {
                const display = this.getDisplay(req.params.deviceId);
                if (!display) {
                    return res.status(404).json({ error: 'Display not found' });
                }

                if (!display.contentToDisplay) {
                    return res.status(404).json({ error: 'No image available' });
                }

                const previewImage = await this.generatePreview(
                    display.contentToDisplay.displayBuffer,
                    display.width,
                    display.height,
                    display.displayType
                );

                res.type('image/png').send(previewImage);
            } catch (error) {
                console.error('Error generating preview:', error);
                res.status(500).json({ error: 'Failed to generate preview' });
            }
        });

        this.app.post('/displays/:deviceId/command', (req, res) => {
            const display = this.getDisplay(req.params.deviceId);
            if (!display) {
                return res.status(404).json({ error: 'Display not found' });
            }

            if (!display.connected) {
                return res.status(400).json({ error: 'Display not connected' });
            }

            if (!req.body || !req.body.command) {
                return res.status(400).json({ error: 'No command provided' });
            }

            const command = req.body.command.toUpperCase();

            try {
                display.socket.write(`${command}\n`);
                res.json({ message: 'Command sent successfully' });
            } catch (error) {
                res.status(500).json({ error: 'Failed to send command' });
            }
        });
    }

    handleConnection(socket) {
        console.log('New connection from', socket.remoteAddress);

        let buffer = '';

        socket.on('data', (data) => {
            buffer += data.toString();

            if (buffer.includes('\n')) {
                const messages = buffer.split('\n');
                buffer = messages.pop();

                messages.forEach(msg => this.handleMessage(msg, socket));
            }
        });
    }

    async handleMessage(message, socket) {
        const trimmedMessage = message.trim();
        const [command, args] = trimmedMessage.split(':');

        if (command === 'HELLO') {
            const [deviceId, displayType, width, height, pageHeight] = args.split(',');

            console.log('New device connection:', {
                deviceId,
                displayType,
                width: parseInt(width),
                height: parseInt(height),
                pageHeight: parseInt(pageHeight)
            });

            socket.write('ACK\n');
            
            let display = this.displays.get(deviceId);
            if (display) {
                display.updateConnection(socket);
            } else {
                display = new EPaperDisplay(
                    deviceId,
                    parseInt(width),
                    parseInt(height),
                    parseInt(pageHeight),
                    socket,
                    displayType
                );
                this.displays.set(deviceId, display);
            }
        }
    }

    listen(tcpPort, httpPort) {
        this.server.listen(tcpPort, () => {
            console.log(`Display TCP server listening on port ${tcpPort}`);
        });

        this.app.listen(httpPort, () => {
            console.log(`Display HTTP server listening on port ${httpPort}`);
        });
    }

    getDisplay(deviceId) {
        return this.displays.get(deviceId);
    }

    getAllDisplays() {
        return Array.from(this.displays.values());
    }

    async generatePreview(displayBuffer, width, height, displayType) {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        const displayArray = Buffer.from(displayBuffer, 'base64');
        const bufferHalfLength = displayArray.length / 2;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const bytePos = Math.floor((y * width + x) / 8);
                const bitPos = 7 - (x % 8);

                let r = 255, g = 255, b = 255;

                switch(displayType) {
                    case 'BW': {
                        const isBlack = !(displayArray[bytePos] & (1 << bitPos));
                        if (isBlack) {
                            r = g = b = 0;
                        }
                        break;
                    }
                    case 'BWR':
                    case 'BWY': {
                        const isBlack = !(displayArray[bytePos] & (1 << bitPos));
                        const isColor = !(displayArray[bytePos + bufferHalfLength] & (1 << bitPos));

                        if (isBlack) {
                            r = g = b = 0;
                        } else if (isColor) {
                            if (displayType === 'BWR') {
                                r = 255; g = 0; b = 0;
                            } else {
                                r = 255; g = 255; b = 0;
                            }
                        }
                        break;
                    }
                }

                imageData.data[i] = r;
                imageData.data[i+1] = g;
                imageData.data[i+2] = b;
                imageData.data[i+3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas.toBuffer('image/png');
    }
}

module.exports = DisplayManager;