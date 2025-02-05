const DisplayManager = require("./lib/DisplayManager");
const Logger = require("./lib/Logger");

if (!process.env.EPD_PORT || !process.env.HTTP_PORT) {
    Logger.log('System', 'error', 'Missing required environment variables: EPD_PORT and HTTP_PORT must be set');
    process.exit(1);
}

// Log storage path information
if (process.env.STORAGE_PATH) {
    Logger.log('System', 'info', `Using storage path: ${process.env.STORAGE_PATH}`);
} else {
    Logger.log('System', 'info', 'Using default storage path');
}


const manager = new DisplayManager();
manager.listen(process.env.EPD_PORT, process.env.HTTP_PORT);