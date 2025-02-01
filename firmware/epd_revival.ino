#include "GxEPD2_3C.h"
#include <WiFi.h>
#include "config.h"

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
        
        // System Uptime
        display.setTextColor(GxEPD_BLACK);
        display.setCursor(50, 500);
        display.print("Uptime: ");
        display.setTextColor(GxEPD_RED);
        unsigned long uptime = millis() / 1000;
        int hours = uptime / 3600;
        int minutes = (uptime % 3600) / 60;
        int seconds = uptime % 60;
        display.printf("%02d:%02d:%02d", hours, minutes, seconds);
        
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

    // Send hello message with device info
    String hello = "HELLO " + deviceId + " " + 
                  String(GxEPD2_1160c::WIDTH) + " " + String(GxEPD2_1160c::HEIGHT) + "\n";
    client.print(hello);
    
    // Wait for ACK
    String response = client.readStringUntil('\n');
    if (response != "ACK") {
        Serial.println("Server didn't acknowledge connection");
        client.stop();
        return false;
    }

    Serial.println("Connected to server");
    return true;
}

void processServerCommands() {
    while (client.connected() && client.available()) {
        String cmd = client.readStringUntil('\n');
        cmd.trim();
        Serial.print("Received command: "); Serial.println(cmd);
        
        if (cmd.startsWith("PAGE")) {
            int firstSpace = cmd.indexOf(' ');
            int secondSpace = cmd.indexOf(' ', firstSpace + 1);
            
            uint16_t pageNum = cmd.substring(firstSpace + 1, secondSpace).toInt();
            uint32_t size = cmd.substring(secondSpace + 1).toInt();
            
            const uint16_t PAGE_HEIGHT = 16;
            uint32_t bytesPerPage = (GxEPD2_1160c::WIDTH * PAGE_HEIGHT) / 8;
            uint32_t totalSize = bytesPerPage * 2;

            Serial.printf("Page %d, received size %d, expected size %d (bytesPerPage: %d)\n", 
                pageNum, size, totalSize, bytesPerPage);
            
            if (size != totalSize) {
                Serial.println("Size mismatch!");
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
                    Serial.println("Timeout waiting for data");
                    delete[] black_buffer;
                    delete[] color_buffer;
                    client.println("NACK");
                    return;
                }
            }

            if (bytesRead == totalSize) {
                uint16_t y = pageNum * PAGE_HEIGHT;
                Serial.printf("Writing image at y=%d\n", y);
                
                display.writeImage(black_buffer, color_buffer, 0, y, 
                                 GxEPD2_1160c::WIDTH, PAGE_HEIGHT);
                                      
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

    showConnectionStatus(false);
    
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

    if (!connectToServer()) {
        delay(5000);
        return;
    }

    processServerCommands();
}
