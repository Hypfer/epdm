const DisplayStorage = require("./DisplayStorage");
const EPaperDisplay = require("./EPaperDisplay");
const net = require('net');
const path = require('path');

const express = require('express');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


class DisplayManager {
    constructor() {
        this.displays = new Map();
        this.storage = new DisplayStorage();
        this.server = net.createServer(this.handleConnection.bind(this));

        this.app = express();
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '..', 'public')));
        this.setupHttpRoutes();
    }

    setupHttpRoutes() {
        this.app.get('/displays', (req, res) => {
            const displays = this.getAllDisplays().map(display => ({
                deviceId: display.deviceId,
                width: display.width,
                height: display.height,
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
                width: display.width,
                height: display.height,
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
            });
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

        this.app.post('/displays/:deviceId/image', upload.single('image'), async (req, res) => {
            try {
                const display = this.getDisplay(req.params.deviceId);
                if (!display) {
                    return res.status(404).json({ error: 'Display not found' });
                }

                if (!display.connected) {
                    return res.status(400).json({ error: 'Display not connected' });
                }

                if (!req.file) {
                    return res.status(400).json({ error: 'No image file provided' });
                }

                // Save the image immediately
                await this.storage.saveImage(display.deviceId, req.file.buffer);

                // Queue the image for display
                display.queueImage(req.file.buffer);

                // Respond immediately
                res.json({
                    message: 'Image accepted and queued for display',
                    status: display.isDrawing ? 'queued' : 'drawing'
                });

            } catch (error) {
                console.error('Error handling image:', error);
                res.status(500).json({ error: 'Failed to process image' });
            }
        });

        this.app.get('/displays/:deviceId/drawing-status', (req, res) => {
            const display = this.getDisplay(req.params.deviceId);
            if (!display) {
                return res.status(404).json({ error: 'Display not found' });
            }

            res.json({
                isDrawing: display.isDrawing,
                hasPendingImage: !!display.pendingImage
            });
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
        const parts = message.trim().split(' ');

        if (parts[0] === 'HELLO') {
            const deviceId = parts[1];
            const width = parseInt(parts[2]);
            const height = parseInt(parts[3]);
            const pageHeight = 16;

            const display = new EPaperDisplay(deviceId, width, height, pageHeight, socket);
            this.displays.set(deviceId, display);

            socket.write('ACK\n');

            const lastImage = await this.storage.getLastImage(deviceId);
            if (lastImage) {
                try {
                    console.log(`[${deviceId}] Displaying last known image`);
                    await display.displayImageFile(lastImage);
                } catch (err) {
                    console.error(`[${deviceId}] Failed to display last image:`, err);
                    await this.drawTestPattern(display);
                }
            } else {
                console.log(`[${deviceId}] No previous image found, displaying test pattern`);
                await this.drawTestPattern(display);
            }
        }
    }

    findDeviceIdBySocket(socket) {
        for (const [deviceId, display] of this.displays.entries()) {
            if (display.socket === socket) {
                return deviceId;
            }
        }
        return null;
    }

    async drawTestPattern(display) {
        const { width, height } = display;
        const blackBuffer = Buffer.alloc((width * height) / 8, 0xFF);
        const colorBuffer = Buffer.alloc((width * height) / 8, 0xFF);

        const patterns = [
            // 0: Vertical stripes
            () => {
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        if (x < width/3) {
                            blackBuffer[bytePos] &= ~(1 << bitPos);
                        } else if (x < 2*width/3) {
                            colorBuffer[bytePos] &= ~(1 << bitPos);
                        }
                    }
                }
            },

            // 1: Horizontal stripes
            () => {
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        if (y < height/3) {
                            blackBuffer[bytePos] &= ~(1 << bitPos);
                        } else if (y < 2*height/3) {
                            colorBuffer[bytePos] &= ~(1 << bitPos);
                        }
                    }
                }
            },

            // 2: Diagonal stripes
            () => {
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        const pos = (x + y) % (width/2);
                        if (pos < width/6) {
                            blackBuffer[bytePos] &= ~(1 << bitPos);
                        } else if (pos < width/3) {
                            colorBuffer[bytePos] &= ~(1 << bitPos);
                        }
                    }
                }
            },

            // 3: Checkerboard
            () => {
                const squareSize = 64;
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        const squareX = Math.floor(x / squareSize);
                        const squareY = Math.floor(y / squareSize);
                        if ((squareX + squareY) % 3 === 0) {
                            blackBuffer[bytePos] &= ~(1 << bitPos);
                        } else if ((squareX + squareY) % 3 === 1) {
                            colorBuffer[bytePos] &= ~(1 << bitPos);
                        }
                    }
                }
            },

            // 4: Concentric circles
            () => {
                const centerX = width / 2;
                const centerY = height / 2;
                const maxRadius = Math.min(width, height) / 2;

                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        const distance = Math.sqrt((x - centerX)**2 + (y - centerY)**2);
                        const ring = Math.floor(distance / (maxRadius/6));

                        if (ring % 3 === 0) {
                            blackBuffer[bytePos] &= ~(1 << bitPos);
                        } else if (ring % 3 === 1) {
                            colorBuffer[bytePos] &= ~(1 << bitPos);
                        }
                    }
                }
            }
        ];

        const patternIndex = Math.floor(Math.random() * patterns.length);
        console.log(`[${display.deviceId}] Drawing pattern ${patternIndex}`);
        patterns[patternIndex]();

        try {
            await display.displayImage(blackBuffer, colorBuffer);
            console.log(`[${display.deviceId}] Test pattern ${patternIndex} displayed successfully`);
        } catch (err) {
            console.error(`[${display.deviceId}] Failed to display test pattern:`, err);
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
}

module.exports = DisplayManager