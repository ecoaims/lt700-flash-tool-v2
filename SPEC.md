# LT700 Firmware Tool 2.0.0 — Product and implementation spec

Status: **plan approved for implementation** (3 November 2026). Hardware behavior still requires the user's functional testing.

## Goal

Remake the current Python/Tkinter LT700 firmware tool as a production desktop app in Electron, with no Python script or Python runtime. Keep all current functions, support Windows 10/11 x64 and macOS 13+ on Apple Silicon, and provide a responsive interface on HD, 2K and 4K displays. The user will conduct functional testing; no tests are to be run during this build.

## Confirmed current behavior from the source

### ESP32-C6

- Discover serial ports, refresh automatically every five seconds, and allow manual rescan.
- Select a port and one of the current baud rates: 115200, 230400, 460800, 921600, 1500000.
- Select three `.bin` images: Bootloader, Partition, Target. Flash at fixed offsets `0x0`, `0x8000`, `0x10000` respectively. The current app uses esptool with `--chip esp32c6`.
- Support optional post-write verification of each image, ESP flash erase with confirmation, chip/flash identification, progress, cancellation, and logs.

### TI MSP430

- Detect USB HID device VID `0x2047`, PID `0x0200`.
- Accept `.hex`, `.txt`, `.titxt`, `.titext`; parse Intel HEX and TI-Text. Do not assume `.bin` or `.out` support based on an older requirements document: current code does not accept them.
- Use the existing BSL5 sequence: wrong password to trigger mass erase; 1-second delay; blank password unlock; upload bundled `RAM_BSL_00.08.08.39.txt`; launch RAM BSL; 3-second delay; reconnect; write user firmware; reset. Windows currently checks RAM BSL version and continues on a mismatch.
- Support independent flash, device check, progress, cancellation, and logs. Current code selects the first matching HID device if more than one is present.

### Shared workflow

- Scan bundled and downloaded firmware folders separately for ESP32 and TI; allow attaching a local file; show firmware metadata and SHA-256.
- Fetch the public SeaDrive folder listing and download supported firmware files into application data. Compare the listed size and any supplied SHA-256 before offering an image. Production selectors show only files synced from the current online folder and files explicitly attached locally; Development retains bundled images and manual downloads.
- Preserve independent ESP and TI operations plus the combined sequence: detect both devices, flash ESP first, wait the saved 10–60 seconds, then flash TI. Abort the sequence if ESP fails or the operator cancels. The default wait is 10 seconds.
- Confirm flashing and destructive erase before starting.
- Persist settings. Save flash logs automatically under the operator's `Documents/LT700` folder on both supported systems; operators should be able to open the log folder from the app.

## User-approved 2.0.0 requirements

- Electron desktop app, without Python scripts or a Python runtime.
- Windows 10/11 x64 and macOS 13+ Apple Silicon packages.
- Preserve all current functions.
- Online firmware from the public SeaDrive/Seafile folder link supplied by the user; local firmware files can also be attached. The link is editable in Settings.
- Production shows separate bootloader, partition, target, and TI image selectors. Online sync supplies the default choices; each image must be explicitly selected. Local files are available through **Choose local**.
- Production has one numeric wait input (10–60 seconds) and a ✓ save button. An empty input saves as 10 seconds. The saved value appears in the sequence and is used for the countdown and flash log.
- Check the online folder at launch and when the operator clicks Fetch/Refresh.
- Automatically install the complete CP210x driver package during Windows setup (user update, 2026-11-05). Bundle Silicon Labs 11.6.0 for offline installation; its minimum is Windows 10 version 1803. MSP430 USB BSL uses the built-in Windows HID driver.
- Automatic flash log files in `Documents/LT700`.
- Responsive layout for HD, 2K and 4K displays.
- Settings for Light, Dark and System themes.
- Display the supplied Ecoaims company logo at the center of the app header and use the supplied LT700 image as the macOS and Windows app icon.
- Assignable app-focused shortcuts for Scan devices, Scan firmware, Flash ESP, Flash TI, Flash both, Cancel, Check ESP, and Open Settings. Flash and erase confirmations still apply when invoked by shortcut.
- No tests run by the developer during this task; user will run functional tests.

## Production UI proposal

Use a fixed-window workstation layout with Production and Development tabs. Development has ESP32-C6 and TI MSP430 device tabs. Keep the active controls and progress bar visible without page scrolling at the supported minimum window size (960 × 760), as well as at HD, 2K, and 4K sizes. Keep the event log on the right; it can expand or close, and its contents scroll inside the panel. Show long firmware details in a dialog. Scale spacing and type with the viewport.

```text
LT700 Firmware Tool                         Devices: ESP ●  TI ●    Settings
───────────────────────────────────────────────────────────────────────────
[Production flash] [Development]          Event log [Expand] [Close]
ESP → saved 10–60 s countdown → TI        Timestamped activity
[Start production flash] [Cancel]         [Open log folder]
Combined progress and current step
ESP/TI readiness and image selectors
[Sync online folder] [Choose local] [Review checksums]

Development tab: [ESP32-C6] [TI MSP430]
Active device controls and progress
```

Design rules:

- Show explicit connected / disconnected / busy / success / failure states using text and color; never rely on color alone.
- Keep the selected firmware names, hashes, target, port, and active step visible before confirming a flash.
- Disable conflicting controls while a device or combined sequence is active; provide one obvious Cancel action.
- Show a clear result status after each operation. Keep full technical output accessible in the event log.
- In Settings, let the operator capture a key combination for each approved action; detect collisions and disallow bare keys that would interfere with text fields.

## Implementation architecture

- Electron main process: settings, file dialogs, filesystem access, logs, online download, packaging integration, and a narrow IPC API.
- Renderer: production UI, theme, responsive layout, confirmations, and hotkey editor. Use context isolation and no Node integration in web content.
- ESP engine: Espressif's JavaScript esptool implementation over Web Serial, provided it supports the current required write, verify, erase, and identify behavior with the LT700 hardware. Preserve fixed offsets and fail closed on a chip mismatch.
- TI engine: port the current BSL5 protocol and HEX/TI-Text parsers to JavaScript, use HID access with explicit VID/PID filtering, and package the RAM BSL image.
- Firmware catalog: bundled files plus operator-attached files plus downloaded SeaDrive files. Distinguish origin, target, checksum and version. Never infer an ESP slot from an ambiguous filename when preparing a production flash.
- Persistence: user data settings, with log files in `Documents/LT700`; no firmware content or logs sent to a cloud service by default. Online downloads are inbound only.
- Packaging: signed/notarized distribution is not yet specified. The Windows installer automatically stages/installs the bundled CP210x driver with PnPUtil, logs errors, stops on failure, and reports required restarts. Show the vendor license in setup and retain all vendor files unchanged.

## Build plan

1. Create the Electron shell, isolated IPC contracts, Settings page, responsive workstation UI, themes, and configurable app-focused hotkeys.
2. Add local firmware catalog, file metadata/checksum validation, attach/scan controls, and automatic log storage in `Documents/LT700`.
3. Port the ESP32-C6 serial operations and the TI HID/BSL flow, including cancellation, progress, and pre-flash confirmation.
4. Add SeaDrive public share listing and download. Keep the combined sequence and expose its 10–60 second wait with a saved default of 10 seconds.
5. Prepare Windows x64 and macOS Apple Silicon packaging and concise operator instructions. Hand over for user functional testing without running tests here.

## Distribution decisions still needed

1. Package signing: whether Ecoaims has a Windows code-signing certificate and Apple Developer signing/notarization credentials. Packaging can be authored without them, but distributable signed builds require the credentials.
2. `Documents/LT700` is specified for logs. Downloaded firmware and settings will stay in the application data folder unless the user requests a different location.

## Implementation state

- Electron shell, renderer layout, local firmware catalog, settings, app-focused hotkeys, and both JavaScript flashing paths are implemented in this project folder.
- The Windows installer includes mandatory CP210x setup; macOS packaging targets arm64. TI USB HID requires no separate Windows driver.
- The public SeaDrive share link is configurable in Settings. The app checks its folder at launch and on demand, and downloads selected firmware files over HTTPS.
- The renderer bundle compiled. No functional tests or hardware operations have been run, as requested.
- Version 2.0.0 adds a Guide button beside Settings, opening a bundled offline HTML operator guide with marked screenshots and no installation section. The app, installer, logs, documentation, and printable guide use 2.0.0 as the product version.

## Source of truth / discrepancies to resolve

- The current README says Windows/macOS/Linux, but this release supports Windows and macOS only.
- The current `Docs/requirements.md` mentions TI `.out` and `.bin` as recommendations; the actual parser accepts only Intel HEX and TI-Text extensions.
- The older ESP brief mentions MD5 and a single three-file auto-fill scheme; the current tool's catalog uses SHA-256, supports external files, and has separate bundled/downloaded folders.
- The legacy Windows installer only offered CP210x optionally; this release bundles the full driver package and installs it automatically.
