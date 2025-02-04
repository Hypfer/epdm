#include "GxEPD2_3C.h"
#include <WiFi.h>
#include "config.h"

const char CMD_DELIM = ':';
const char ARG_DELIM = ',';
const uint16_t PAGE_HEIGHT = 48;
const unsigned long PING_TIMEOUT = 90000; // 90 seconds
unsigned long lastPingTime = 0;

void doSomethingUsefulInsteadOfWaiting() {
    yield();
    delay(1);
}

// Display configuration
GxEPD2_3C<GxEPD2_1160c, GxEPD2_1160c::HEIGHT / 2> display(GxEPD2_1160c(
    /*CS=*/15, 
    /*DC=*/27, 
    /*RST=*/26, 
    /*BUSY=*/25,
    &doSomethingUsefulInsteadOfWaiting
));

WiFiClient client;
String deviceId;
int failedConnectCount = 0;

void showConnectionStatus(bool isError) {
    display.firstPage();
    do {
        display.fillScreen(GxEPD_WHITE);
        
        // Device ID
        display.setTextColor(GxEPD_BLACK);
        display.setTextSize(3);
        display.setCursor(50, 50);
        display.print("Device ID: ");
        display.setTextColor(GxEPD_RED);
        display.println(deviceId);
        
        // WiFi Status
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 150);
        display.print("WiFi SSID: ");
        display.setTextColor(GxEPD_RED);
        display.println(WIFI_SSID);
        
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 200);
        display.print("WiFi Connected: ");
        display.setTextColor(WiFi.status() == WL_CONNECTED ? GxEPD_BLACK : GxEPD_RED);
        display.println(WiFi.status() == WL_CONNECTED ? "YES" : "NO");
        
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 250);
        display.print("Signal Strength: ");
        display.setTextColor(GxEPD_RED);
        display.print(WiFi.RSSI());
        display.println(" dBm");
        
        // Server Status
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 300);
        display.print("Server: ");
        display.setTextColor(GxEPD_RED);
        display.println(SERVER_HOST);
        
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 350);
        display.print("Server Connected: ");
        display.setTextColor(client.connected() ? GxEPD_BLACK : GxEPD_RED);
        display.println(client.connected() ? "YES" : "NO");
        
        // Connection Status
        if (isError) {
            display.setTextColor(GxEPD_RED);
            display.setCursor(50, 400);
            display.println("CONNECTION FAILED");
            display.setCursor(50, 450);
            display.printf("Failed attempts: %d", failedConnectCount);
        }
        
        // System Uptime and Last Ping
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 500);
        display.print("Uptime: ");
        display.setTextColor(GxEPD_RED);
        unsigned long uptime = millis() / 1000;
        int hours = uptime / 3600;
        int minutes = (uptime % 3600) / 60;
        int seconds = uptime % 60;
        display.printf("%02d:%02d:%02d", hours, minutes, seconds);

        if (lastPingTime > 0) {
            display.setTextColor(GxEPD_BLACK);
            display.setCursor(50, 550);
            display.print("Last Ping: ");
            display.setTextColor(GxEPD_RED);
            unsigned long pingAge = (millis() - lastPingTime) / 1000;
            display.printf("%ds ago", pingAge);
        }
        
    } while (display.nextPage());
}

String getDeviceId() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char id[32];
    snprintf(id, sizeof(id), "epd-frame-%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(id);
}

bool connectToServer() {
    if (client.connected()) {
        failedConnectCount = 0;  // Reset counter on successful connection
        return true;
    }

    Serial.printf("Connecting to %s:%d\n", SERVER_HOST, SERVER_PORT);

    if (!client.connect(SERVER_HOST, SERVER_PORT)) {
        Serial.println("Connection failed");
        failedConnectCount++;
        
        // Show error message after 10 consecutive failures
        if (failedConnectCount == 10) {
            showConnectionStatus(true);
        } else if(failedConnectCount > 10) {
            failedConnectCount = 11;
        }
        return false;
    }

    failedConnectCount = 0;  // Reset counter on successful connection

    String hello = String("HELLO") + CMD_DELIM + 
                  deviceId + ARG_DELIM + 
                  "BWR" + ARG_DELIM +
                  String(GxEPD2_1160c::WIDTH) + ARG_DELIM + 
                  String(GxEPD2_1160c::HEIGHT) + ARG_DELIM +
                  String(PAGE_HEIGHT) + "\n";
    client.print(hello);
    
    // Wait for ACK
    String response = client.readStringUntil('\n');
    if (response != "ACK") {
        Serial.println("Server didn't acknowledge connection");
        client.stop();
        return false;
    }

    Serial.println("Connected to server");
    lastPingTime = millis(); // Initialize ping timer on successful connection
    return true;
}

void processServerCommands() {
    while (client.connected() && client.available()) {
        String cmdLine = client.readStringUntil('\n');
        cmdLine.trim();
        Serial.print("Received command: "); Serial.println(cmdLine);
        
        int cmdDelimPos = cmdLine.indexOf(CMD_DELIM);
        if (cmdDelimPos == -1) continue;
        
        String cmd = cmdLine.substring(0, cmdDelimPos);
        String args = cmdLine.substring(cmdDelimPos + 1);
        
        if (cmd == "PING") {
            lastPingTime = millis();
            String response = String("PONG") + CMD_DELIM +
                            String(WiFi.RSSI()) + ARG_DELIM +
                            String(millis() / 1000) + ARG_DELIM +
                            String(ESP.getFreeHeap()) + "\n";
            client.print(response);
        }
        else if (cmd == "PAGE") {
            int firstDelim = args.indexOf(ARG_DELIM);
            if (firstDelim == -1) continue;
            
            uint16_t pageNum = args.substring(0, firstDelim).toInt();
            uint32_t size = args.substring(firstDelim + 1).toInt();
            
            // Calculate remaining rows for this page
            uint16_t remainingRows = min(
                PAGE_HEIGHT,
                static_cast<uint16_t>(GxEPD2_1160c::HEIGHT - (pageNum * PAGE_HEIGHT))
            );
            uint32_t bytesPerPage = (GxEPD2_1160c::WIDTH * remainingRows) / 8;
            uint32_t totalSize = bytesPerPage * 2;  // For black and color

            Serial.printf("Page %d, received size %d, expected size %d (bytesPerPage: %d, rows: %d)\n", 
                pageNum, size, totalSize, bytesPerPage, remainingRows);
            
            if (size != totalSize) {
                Serial.println("Size mismatch!");
                client.println("NACK");
                return;
            }

            // Wait for DATA_START
            String marker = client.readStringUntil('\n');
            if (marker != "DATA_START") {
                Serial.println("Missing DATA_START marker!");
                client.println("NACK");
                return;
            }
            
            uint8_t* black_buffer = new uint8_t[bytesPerPage];
            uint8_t* color_buffer = new uint8_t[bytesPerPage];

            memset(black_buffer, 0xFF, bytesPerPage);
            memset(color_buffer, 0xFF, bytesPerPage);
            
            uint32_t bytesRead = 0;
            uint32_t startTime = millis();
            
            while (bytesRead < totalSize && client.connected()) {
                if (client.available()) {
                    if (bytesRead < bytesPerPage) {
                        black_buffer[bytesRead] = client.read();
                    } else {
                        color_buffer[bytesRead - bytesPerPage] = client.read();
                    }
                    bytesRead++;
                }
                yield();

                if (millis() - startTime > 5000) {
                    Serial.printf("Timeout waiting for data after %dms. Bytes read: %d/%d (%.1f%%). Last available: %d\n",
                        millis() - startTime,
                        bytesRead,
                        totalSize,
                        (bytesRead * 100.0) / totalSize,
                        client.available()
                    );
                    
                    Serial.printf("Network status - Connected: %d, WiFi Status: %d, RSSI: %d dBm\n",
                        client.connected(),
                        WiFi.status(),
                        WiFi.RSSI()
                    );
                    
                    delete[] black_buffer;
                    delete[] color_buffer;
                    client.println("NACK");
                    return;
                }
            }

            // Wait for DATA_END
            marker = client.readStringUntil('\n');
            if (marker != "DATA_END") {
                Serial.println("Missing DATA_END marker!");
                delete[] black_buffer;
                delete[] color_buffer;
                client.println("NACK");
                return;
            }

            if (bytesRead == totalSize) {
                uint16_t y = pageNum * PAGE_HEIGHT;
                Serial.printf("Writing image at y=%d (rows: %d)\n", y, remainingRows);
                
                display.writeImage(black_buffer, color_buffer, 0, y, 
                                 GxEPD2_1160c::WIDTH, remainingRows);
                                      
                Serial.println("Sending ACK");
                client.println("ACK");
            } else {
                Serial.printf("Data size mismatch. Expected %d, got %d\n", totalSize, bytesRead);
                client.println("NACK");
            }

            delete[] black_buffer;
            delete[] color_buffer;
        }
        else if (cmd == "REFRESH") {
            Serial.println("Received REFRESH command");
            display.refresh();
            Serial.println("Refresh complete, sending ACK");
            client.println("ACK");
        }
        else if (cmd == "REBOOT") {
            Serial.println("Received REBOOT command");
            client.println("ACK");
            delay(100);
            ESP.restart();
        }
    }
}

void setup() {
    Serial.begin(115200);
    Serial.println("Starting EPD Picture Frame");

    display.init(115200);
    SPI.end();
    SPI.begin(13, 12, 14, 15);
    
    deviceId = getDeviceId();
    WiFi.setHostname(deviceId.c_str());

    //showConnectionStatus(false);
    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("\nWiFi connected");
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi disconnected. Reconnecting...");
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        delay(5000);
        return;
    }

    // Check if we haven't received a ping in too long
    if (client.connected() && lastPingTime > 0 && 
        (millis() - lastPingTime) > PING_TIMEOUT) {
        Serial.println("Ping timeout - disconnecting");
        client.stop();
        lastPingTime = 0;
        showConnectionStatus(true);
        return;
    }

    if (!connectToServer()) {
        delay(5000);
        return;
    }

    processServerCommands();
}
