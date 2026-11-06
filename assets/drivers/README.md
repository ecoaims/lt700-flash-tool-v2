# Windows USB drivers

The complete, unmodified Silicon Labs CP210x Universal Windows Driver 11.6.0
package is bundled in `CP210x/`, including the catalog, INF, binaries, vendor
license and release notes. It supports Windows 10 version 1803 or later and
Windows 11. Setup displays the vendor license and installs/stages the driver
automatically using Windows PnPUtil, including when no board is connected.
No network connection is required during setup.

Source: https://www.silabs.com/documents/public/software/CP210x_Universal_Windows_Driver.zip

Downloaded 2026-11-05 from the official Silicon Labs website.
Original ZIP SHA-256:
`6d9259475219c8c6cc19512053e96d435ebbada3d90457fba7d49ee8d524ba98`

Driver installation output is saved as `driver-install.log` in the app's
installation directory. A failure stops setup with retry/cancel; a required
restart is reported by setup. Uninstalling the app leaves the shared driver
in Windows so other CP210x devices continue working.

The TI MSP430 BSL interface used by this app (VID 2047 / PID 0200) uses Windows'
built-in USB HID driver. No separate TI driver or WinUSB replacement is needed.
Reference: https://www.ti.com/lit/an/slaa452b/slaa452b.pdf

The vendor license remains applicable. This build is prepared for Ecoaims'
internal use; external redistribution rights have not been reviewed.
