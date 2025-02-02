const net = require('net');
const path = require('path');
const express = require('express');
const multer = require('multer');
const EPaperDisplay = require("./EPaperDisplay");

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
                blackBuffer: display.contentToDisplay.blackBuffer.toString('base64'),
                colorBuffer: display.contentToDisplay.colorBuffer.toString('base64'),
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

                if (!display.connected) {
                    return res.status(400).json({ error: 'Display not connected' });
                }

                if (!req.file) {
                    return res.status(400).json({ error: 'No image file provided' });
                }

                await display.queueImage(req.file.buffer);

                res.json({
                    message: 'Image accepted and queued for display',
                    status: display.isDrawing ? 'queued' : 'drawing'
                });

            } catch (error) {
                console.error('Error handling image:', error);
                res.status(500).json({ error: 'Failed to process image' });
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
        const parts = message.trim().split(' ');

        if (parts[0] === 'HELLO') {
            const deviceId = parts[1];
            const width = parseInt(parts[2]);
            const height = parseInt(parts[3]);
            const pageHeight = 16;

            let display = this.displays.get(deviceId);
            if (display) {
                display.updateConnection(socket);
            } else {
                display = new EPaperDisplay(deviceId, width, height, pageHeight, socket);
                this.displays.set(deviceId, display);
            }
            
            this.displays.set(deviceId, display);

            socket.write('ACK\n');
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

module.exports = DisplayManager;