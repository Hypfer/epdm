class DisplayStorage {
    constructor() {
        this.lastImages = new Map();
    }

    async saveImage(deviceId, imageData) {
        this.lastImages.set(deviceId, imageData);
    }

    async getLastImage(deviceId) {
        return this.lastImages.get(deviceId);
    }
}

module.exports = DisplayStorage;