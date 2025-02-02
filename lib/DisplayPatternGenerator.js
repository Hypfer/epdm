const DisplayTypes = require("./DisplayTypes");

class DisplayPatternGenerator {
    static generatePattern(width, height, displayType = 'BWR', patternIndex = null) {
        const bitsPerPixel = DisplayTypes[displayType].bitsPerPixel;
        const displayBuffer = Buffer.alloc(width * height * bitsPerPixel / 8, 0xFF);

        const patterns = [
            // Diagonal stripes
            () => {
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        const pos = (x + y) % (width/2);

                        switch(displayType) {
                            case 'BW': {
                                if (pos < width/6) {
                                    displayBuffer[bytePos] &= ~(1 << bitPos);
                                }
                                break;
                            }
                            case 'BWR':
                            case 'BWY': {
                                if (pos < width/6) {
                                    displayBuffer[bytePos] &= ~(1 << bitPos);
                                } else if (pos < width/3) {
                                    displayBuffer[bytePos + displayBuffer.length/2] &= ~(1 << bitPos);
                                }
                                break;
                            }
                        }
                    }
                }
            },

            // Checkerboard
            () => {
                const squareSize = 64;
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bytePos = Math.floor((y * width + x) / 8);
                        const bitPos = 7 - (x % 8);
                        const squareX = Math.floor(x / squareSize);
                        const squareY = Math.floor(y / squareSize);

                        switch(displayType) {
                            case 'BW': {
                                if ((squareX + squareY) % 2 === 0) {
                                    displayBuffer[bytePos] &= ~(1 << bitPos);
                                }
                                break;
                            }
                            case 'BWR':
                            case 'BWY': {
                                if ((squareX + squareY) % 3 === 0) {
                                    displayBuffer[bytePos] &= ~(1 << bitPos);
                                } else if ((squareX + squareY) % 3 === 1) {
                                    displayBuffer[bytePos + displayBuffer.length/2] &= ~(1 << bitPos);
                                }
                                break;
                            }
                        }
                    }
                }
            },

            // Concentric circles
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

                        switch(displayType) {
                            case 'BW': {
                                if (ring % 2 === 0) {
                                    displayBuffer[bytePos] &= ~(1 << bitPos);
                                }
                                break;
                            }
                            case 'BWR':
                            case 'BWY': {
                                if (ring % 3 === 0) {
                                    displayBuffer[bytePos] &= ~(1 << bitPos);
                                } else if (ring % 3 === 1) {
                                    displayBuffer[bytePos + displayBuffer.length/2] &= ~(1 << bitPos);
                                }
                                break;
                            }
                        }
                    }
                }
            }
        ];

        const selectedPattern = patternIndex !== null ?
            patternIndex : Math.floor(Math.random() * patterns.length);

        patterns[selectedPattern]();

        return {
            displayBuffer,
            patternIndex: selectedPattern
        };
    }
}

module.exports = DisplayPatternGenerator;