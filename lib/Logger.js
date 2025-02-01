class Logger {
    static log(deviceId, level, message) {
        const prefix = `[${deviceId}]`;
        switch(level) {
            case 'error':
                console.error(`${prefix} ${message}`);
                break;
            case 'info':
                console.log(`${prefix} ${message}`);
                break;
            case 'debug':
                console.debug(`${prefix} ${message}`);
                break;
            default:
                console.log(`${prefix} ${message}`);
        }
    }
}

module.exports = Logger;