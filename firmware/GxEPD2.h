// Display Library for SPI e-paper panels from Dalian Good Display and boards from Waveshare.
// Requires HW SPI and Adafruit_GFX. Caution: these e-papers require 3.3V supply AND data lines!
//
// based on Demo Example from Good Display: http://www.e-paper-display.com/download_list/downloadcategoryid=34&isMode=false.html
//
// Author: Jean-Marc Zingg
//
// Version: see library.properties
//
// Library: https://github.com/ZinggJM/GxEPD2

#ifndef _GxEPD2_H_
#define _GxEPD2_H_

#include <Arduino.h>
#include <SPI.h>

// color definitions for GxEPD and GxEPD2, values correspond to RGB565 values for TFTs
#define GxEPD_BLACK     0x0000
#define GxEPD_WHITE     0xFFFF
#define GxEPD_RED       0xF800 // 255,   0,   0
#define GxEPD_YELLOW    0xFFE0 // 255, 255,   0
#define GxEPD_COLORED   GxEPD_RED

class GxEPD2
{
  public:
    enum Panel
    {
      SOLUM1160
    };
};

#endif
