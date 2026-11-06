import { ESPLoader, Transport } from 'esptool-js';
import SparkMD5 from 'spark-md5';

const OFFSETS = { Bootloader: 0x0, Partition: 0x8000, Target: 0x10000 };
const ORDER = ['Bootloader', 'Partition', 'Target'];
function md5(bytes) { return SparkMD5.ArrayBuffer.hash(bytes.slice().buffer); }
function padded(bytes) { if (bytes.length % 4 === 0) return bytes; const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(0xff); out.set(bytes); return out; }

export class EspFlasher {
  constructor({ log, progress, step }) { this.log = log; this.progress = progress; this.step = step; this.transport = null; this.cancelled = false; }
  cancel() { this.cancelled = true; this.transport?.disconnect().catch(() => {}); }
  checkCancelled() { if (this.cancelled) throw new Error('ESP32 operation cancelled.'); }
  async withLoader(port, baud, work) {
    this.cancelled = false;
    this.transport = new Transport(port, false);
    const terminal = { clean: () => {}, write: (text) => this.log(text), writeLine: (text) => this.log(text) };
    const loader = new ESPLoader({ transport: this.transport, baudrate: Number(baud), terminal });
    try {
      this.step('Connecting to ESP32-C6', 2);
      const description = await loader.main();
      this.checkCancelled();
      if (loader.chip?.CHIP_NAME !== 'ESP32-C6') throw new Error(`Connected chip is ${description}; expected ESP32-C6.`);
      this.log(`Connected chip: ${description}`);
      const result = await work(loader);
      this.checkCancelled();
      await loader.after('hard_reset');
      return result;
    } finally { await this.transport?.disconnect().catch(() => {}); this.transport = null; }
  }
  async check(port, baud) {
    return this.withLoader(port, baud, async (loader) => { this.step('Reading flash ID', 65); await loader.flashId(); this.progress(100); return true; });
  }
  async erase(port, baud) {
    return this.withLoader(port, baud, async (loader) => { this.step('Erasing entire ESP32 flash', 10); await loader.eraseFlash(); this.progress(100); this.log('ESP32 FLASH ERASED.'); return true; });
  }
  async flash(port, baud, images, verify) {
    for (const slot of ORDER) if (!(images[slot]?.data instanceof Uint8Array) || !images[slot].data.length) throw new Error(`Select a valid ${slot} image.`);
    return this.withLoader(port, baud, async (loader) => {
      this.step('Programming ESP32 images', 5);
      const files = ORDER.map((slot) => ({ address: OFFSETS[slot], data: images[slot].data }));
      await loader.writeFlash({
        fileArray: files, flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
        eraseAll: false, compress: true, calculateMD5Hash: md5,
        reportProgress: (index, written, total) => { this.checkCancelled(); this.progress(Math.min(90, 5 + Math.round((index + written / Math.max(1, total)) * 85 / files.length))); },
      });
      this.checkCancelled();
      if (verify) {
        this.step('Verifying ESP32 images', 92);
        for (const slot of ORDER) {
          this.checkCancelled();
          const bytes = padded(images[slot].data);
          const expected = md5(bytes).toLowerCase();
          const actual = String(await loader.flashMd5sum(OFFSETS[slot], bytes.length)).toLowerCase();
          if (actual !== expected) throw new Error(`${slot} verification failed: flash checksum mismatch.`);
          this.log(`${slot} verified at 0x${OFFSETS[slot].toString(16)}.`);
        }
      }
      this.progress(100); this.log('ESP32 FLASH SUCCESSFUL.'); return true;
    });
  }
}
