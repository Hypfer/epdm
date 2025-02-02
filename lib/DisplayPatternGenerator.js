class DisplayPatternGenerator {
    static generatePattern(width, height, patternIndex = null) {
        const blackBuffer = Buffer.alloc((width * height) / 8, 0xFF);
        const colorBuffer = Buffer.alloc((width * height) / 8, 0xFF);

        const patterns = [
            // Diagonal stripes
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

            // Checkerboard
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

                        if (ring % 3 === 0) {
                            blackBuffer[bytePos] &= ~(1 << bitPos);
                        } else if (ring % 3 === 1) {
                            colorBuffer[bytePos] &= ~(1 << bitPos);
                        }
                    }
                }
            }
        ];

        const selectedPattern = patternIndex !== null ?
            patternIndex : Math.floor(Math.random() * patterns.length);

        patterns[selectedPattern]();

        return {
            blackBuffer,
            colorBuffer,
            patternIndex: selectedPattern
        };
    }
}

module.exports = DisplayPatternGenerator;