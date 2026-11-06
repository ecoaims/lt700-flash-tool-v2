# LT700 Firmware Tool 2.0.0

Electron remake of the LT700 ESP32-C6 and TI MSP430 production flasher. It uses JavaScript for the UI and both flashing paths; no Python runtime or script is included.

## Supported systems

- Windows 10 (version 1803 or newer) / Windows 11 x64
- macOS 13 or newer on Apple Silicon

The Windows installer automatically installs/stages the complete Silicon Labs CP210x 11.6.0 serial driver for the ESP32 connection, with administrator elevation. The driver is included for offline setup. TI MSP430 USB BSL uses Windows' built-in HID driver; no separate TI driver is required. Driver installation failures stop setup with retry/cancel, and restart requirements are reported. Installation output is saved as `driver-install.log` inside the installation directory. The shared driver is retained when uninstalling the app.

## Build

Requires Node.js/npm on the build machine. Operators using a packaged app do not need Node.js.

```bash
npm install
npm run build:ui
npm start
```

Package the required platform (Windows can also be cross-built from macOS with electron-builder's packaging tools):

```bash
npm run package:win
npm run package:mac
```

Output goes to `release/`. Distribution signing/notarization credentials have not been configured.

The Windows installer is `release/LT700-Firmware-Tool-2.0.0-Windows-x64.exe`. It includes Electron, the JavaScript flashing engines, TI RAM BSL image, CP210x driver, and the local HTML operator guide; operators do not need Python, Node.js, or separate driver downloads. Setup displays the bundled Silicon Labs driver license. This unsigned build is for internal functional acceptance; Windows installation and LT700 hardware operation remain to be checked by the user.

The Ecoaims logo appears in the center of the app header. The supplied LT700 icon is used for the macOS app/Dock and Windows app/installer. Source images are in `assets/images`; platform icon files are in `build/`.

**Guide** beside Settings opens the offline HTML operator guide in a separate app window. It includes marked screenshots for Production, Development, firmware sources, Settings, and logs. The matching printable operator guide is `output/pdf/LT700_Firmware_Tool_Operator_Guide_2.0.0.pdf`. Neither guide includes installation steps; setup instructions remain in this README and the installer.

## Operator workflow

1. Connect the LT700 ESP32 serial interface and TI HID interface. Press **SW3 + SW2** to enter TI MSP430 bootloader mode, then click **Connect serial device** and **Connect HID device**. Without bootloader mode, the TI device will not be detected.
2. On **Production flash**, the public SeaDrive folder syncs on launch by default; **Sync online folder** refreshes it on demand. Select the bootloader, partition, target, and TI image from the synced files. **Choose local** attaches an alternative file to the relevant Production selector. Production does not select bundled images automatically. Review names and SHA-256 values before flashing.
3. On **Production flash**, enter a wait from 10 to 60 seconds and click **✓** to save it; an empty field saves as 10 seconds. Then use **Start production flash** for the ESP32 → saved wait → TI sequence. Switch to **Development · Individual devices**, then the **ESP32-C6** or **TI MSP430** tab, for individual controls. Development can also use bundled images and manual online downloads.
4. Watch the production progress bar and right-side event log. The event log can expand or close. Every flash/check/erase operation writes a timestamped log automatically in `Documents/LT700`; **Open Documents/LT700** opens that folder.
5. Use Settings to choose Light, Dark, or System theme and assign app-focused key combinations. Backspace/Delete clears a shortcut. The SeaDrive folder link is editable there.

The ESP flash addresses are fixed at `0x0` (bootloader), `0x8000` (partition), and `0x10000` (target). TI uses USB VID `2047`, PID `0200`, the bundled RAM BSL image, and the existing erase/unlock/program/reset sequence.

## Functional acceptance by Ecoaims

Functional tests were deliberately not run during implementation. Before production use, verify Windows and macOS installation, USB discovery, ESP check/erase/flash/verify/cancel, TI HID flashing and reconnect, the combined sequence, SeaDrive listing/download, and log creation on the actual LT700 hardware.
