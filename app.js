const DisplayManager = require("./lib/DisplayManager");
const Logger = require("./lib/Logger");

if (!process.env.EPD_PORT || !process.env.HTTP_PORT) {
    Logger.log('System', 'error', 'Missing required environment variables: EPD_PORT and HTTP_PORT must be set');
    process.exit(1);
}

const manager = new DisplayManager();
manager.listen(process.env.EPD_PORT, process.env.HTTP_PORT);