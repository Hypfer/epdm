const Canvas = require("canvas");
const RgbQuant = require("rgbquant");
const {Jimp, rgbaToInt} = require("jimp");
const Logger = require("./Logger");
const DisplayTypes = require("./DisplayTypes");

class DisplayImageConverter {
    constructor(width, height, displayType) {
        this.displayType = displayType;
        this.maxDimensions = {
            x: width,
            y: height
        };
    }

    async transformImage(input) {
        const inputImage = await Jimp.read(input);
        const inputImageAspectRatio = inputImage.bitmap.width / inputImage.bitmap.height;
        let processedImage;

        if (inputImage.bitmap.width > this.maxDimensions.x || inputImage.bitmap.height > this.maxDimensions.y) {
            if (inputImageAspectRatio <= 1.1) { //somewhat squarish or portrait
                inputImage.scaleToFit({w: this.maxDimensions.x, h: this.maxDimensions.y});
                processedImage = await this.frameToFullSize(inputImage);
            } else {
                inputImage.cover({w: this.maxDimensions.x, h: this.maxDimensions.y});
                processedImage = inputImage;
            }
        } else if (inputImage.bitmap.width < this.maxDimensions.x || inputImage.bitmap.height < this.maxDimensions.y) {
            processedImage = await this.frameToFullSize(inputImage);
        } else {
            processedImage = inputImage;
        }

        const outputImageRGBA = await this.convertToEpdColors(
            await processedImage.getBase64("image/png"),
            this.maxDimensions.x,
            this.maxDimensions.y
        );

        return this.packRGBAToDisplayBuffer(outputImageRGBA);
    }

    async frameToFullSize(inputImage) {
        const dominantColour = this.getDominantColor(
            await inputImage.getBase64("image/png"),
            inputImage.bitmap.height,
            inputImage.bitmap.width
        );

        const newImg = await new Jimp({
            width: this.maxDimensions.x,
            height: this.maxDimensions.y,
            color: dominantColour
        });

        newImg.composite(
            inputImage,
            (this.maxDimensions.x / 2) - (inputImage.bitmap.width / 2),
            (this.maxDimensions.y / 2) - (inputImage.bitmap.height / 2),
        )

        return newImg;
    }

    // This returns one large buffer consisting of the bitmaps for all colors after another
    // When sending, the EPaperDisplay class packs the data like the display wants it
    packRGBAToDisplayBuffer(inputRGBA) {
        const displayBuffer = Buffer.alloc(this.maxDimensions.x * this.maxDimensions.y * DisplayTypes[this.displayType].bitsPerPixel, 0xFF);
        
        for (let i = 0; i < inputRGBA.length; i += 4) {
            const r = inputRGBA[i];
            const g = inputRGBA[i + 1];
            const b = inputRGBA[i + 2];

            const pixelIndex = i / 4;
            const byteIndex = Math.floor(pixelIndex / 8);
            const bitIndex = 7 - (pixelIndex % 8);
            
            switch(this.displayType) {
                case "BW": {
                    const whiteish = ((r > 0x80) && (g > 0x80) && (b > 0x80));

                    if (!whiteish) {
                        displayBuffer[byteIndex] &= ~(1 << bitIndex);
                    }
                    break;
                }
                case "BWR": {
                    const whiteish = ((r > 0x80) && (g > 0x80) && (b > 0x80));
                    const colored = (r > 0xF0) || ((g > 0xF0) && (b > 0xF0));

                    if (!whiteish) {
                        if (colored) {
                            displayBuffer[byteIndex + displayBuffer.length/2] &= ~(1 << bitIndex);
                        } else {
                            displayBuffer[byteIndex] &= ~(1 << bitIndex);
                        }
                    }
                    break;
                }
                case "BWY": {
                    const whiteish = ((r > 0x80) && (g > 0x80) && (b > 0x80));
                    const yellowish = (r > 0xF0) && (g > 0xF0) && (b < 0x80);

                    if (!whiteish) {
                        if (yellowish) {
                            displayBuffer[byteIndex + displayBuffer.length/2] &= ~(1 << bitIndex);
                        } else {
                            displayBuffer[byteIndex] &= ~(1 << bitIndex);
                        }
                    }
                    break;
                }
            }
        }

        return displayBuffer;
    }

    convertToEpdColors(base64Img, w, h) {
        const img = new Canvas.Image();
        const can = Canvas.createCanvas(w, h);
        const ctx = can.getContext("2d");
        const q = new RgbQuant({
            colors: DisplayTypes[this.displayType].palette.length,
            palette: DisplayTypes[this.displayType].palette,
            dithKern: "SierraLite",
            dithSerp: true
        });

        img.src = base64Img;
        ctx.drawImage(img, 0, 0, img.width, img.height);

        return q.reduce(can);
    }

    getDominantColor(base64Img, w, h) {
        const img = new Canvas.Image();
        const can = Canvas.createCanvas(w, h);
        const ctx = can.getContext("2d");
        const q = new RgbQuant({colors: 1, method: 1});

        img.src = base64Img;
        ctx.drawImage(img, 0, 0, img.width, img.height);

        q.sample(can);
        const palette = q.palette(true, true);

        if (Array.isArray(palette) && palette.length > 0) {
            return rgbaToInt(palette[0][0], palette[0][1], palette[0][2], 255);
        } else {
            return rgbaToInt(0, 0, 0, 255);
        }
    }
}

module.exports = DisplayImageConverter;