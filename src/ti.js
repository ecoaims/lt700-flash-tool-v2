const VID = 0x2047;
const PID = 0x0200;
const RAM_BSL_START = 0x2504;
const RAM_BSL_VERSION = [0, 8, 8, 0x39];
const CMD = { RX_DATA: 0x10, RX_DATA_FAST: 0x1b, PASSWORD: 0x11, LOAD_PC: 0x17, VERSION: 0x19 };
const ERRORS = ['Operation successful', 'Flash write check failed', 'Flash fail bit set', 'Voltage change during program', 'BSL locked', 'BSL password error', 'Byte write forbidden', 'Unknown command', 'Packet length exceeds buffer size'];
const enc = new TextDecoder();

function threeBytes(address) { return Uint8Array.of(address & 255, (address >>> 8) & 255, (address >>> 16) & 255); }
function join(...parts) { const length = parts.reduce((n, p) => n + p.length, 0); const data = new Uint8Array(length); let at = 0; for (const part of parts) { data.set(part, at); at += part.length; } return data; }
function numberByte(value, line) { if (!/^[\da-f]{1,2}$/i.test(value)) throw new Error(`Invalid TI-Text byte at line ${line}.`); return parseInt(value, 16); }

export function parseTiText(bytes) {
  const segments = [];
  let start = null;
  let data = [];
  for (const [index, raw] of enc.decode(bytes).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line.toLowerCase() === 'q') break;
    if (line.startsWith('@')) {
      if (!/^@[\da-f]+$/i.test(line)) throw new Error(`Invalid TI-Text address at line ${index + 1}.`);
      if (start !== null && data.length) segments.push({ address: start, data: Uint8Array.from(data) });
      start = parseInt(line.slice(1), 16);
      data = [];
    } else {
      if (start === null) throw new Error(`TI-Text data before address at line ${index + 1}.`);
      data.push(...line.split(/\s+/).map((part) => numberByte(part, index + 1)));
    }
  }
  if (start !== null && data.length) segments.push({ address: start, data: Uint8Array.from(data) });
  if (!segments.length) throw new Error('TI-Text file contains no data.');
  return segments.sort((a, b) => a.address - b.address);
}

export function parseIntelHex(bytes) {
  const segments = [];
  let base = 0;
  let current = null;
  let data = [];
  for (const [index, raw] of enc.decode(bytes).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^:[\da-f]+$/i.test(line) || (line.length - 1) % 2) throw new Error(`Invalid Intel HEX record at line ${index + 1}.`);
    const record = Uint8Array.from(line.slice(1).match(/../g).map((part) => parseInt(part, 16)));
    if (record.length < 5 || record[0] !== record.length - 5) throw new Error(`Invalid Intel HEX length at line ${index + 1}.`);
    if (record.reduce((sum, byte) => sum + byte, 0) % 256) throw new Error(`Intel HEX checksum failed at line ${index + 1}.`);
    const kind = record[3];
    const offset = (record[1] << 8) | record[2];
    const payload = record.slice(4, -1);
    if (kind === 0) {
      const address = base + offset;
      if (current === null || current.address + data.length !== address) {
        if (current && data.length) segments.push({ address: current.address, data: Uint8Array.from(data) });
        current = { address };
        data = [];
      }
      data.push(...payload);
    } else if (kind === 1) break;
    else if (kind === 2 || kind === 4) {
      if (payload.length !== 2) throw new Error(`Invalid Intel HEX address record at line ${index + 1}.`);
      base = ((payload[0] << 8) | payload[1]) << (kind === 2 ? 4 : 16);
      if (current && data.length) segments.push({ address: current.address, data: Uint8Array.from(data) });
      current = null;
      data = [];
    } else if (kind !== 3 && kind !== 5) throw new Error(`Unsupported Intel HEX record type ${kind}.`);
  }
  if (current && data.length) segments.push({ address: current.address, data: Uint8Array.from(data) });
  if (!segments.length) throw new Error('Intel HEX file contains no data.');
  return segments.sort((a, b) => a.address - b.address);
}

export function parseTiImage(bytes, name) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'hex') return parseIntelHex(bytes);
  if (['txt', 'titxt', 'titext'].includes(ext)) return parseTiText(bytes);
  throw new Error('Unsupported TI firmware format.');
}

export class TiFlasher {
  constructor({ log, progress, step }) { this.log = log; this.progress = progress; this.step = step; this.cancelled = false; this.device = null; this.pending = null; this.onReport = this.onReport.bind(this); }
  static async devices() { return (await navigator.hid.getDevices()).filter((device) => device.vendorId === VID && device.productId === PID); }
  static async requestDevice() { return (await navigator.hid.requestDevice({ filters: [{ vendorId: VID, productId: PID }] }))[0] || null; }
  cancel() { this.cancelled = true; if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('TI flash cancelled.')); } this.pending = null; this.device?.close().catch(() => {}); }
  checkCancelled() { if (this.cancelled) throw new Error('TI flash cancelled.'); }
  async sleep(ms) { const end = Date.now() + ms; while (Date.now() < end) { this.checkCancelled(); await new Promise((resolve) => setTimeout(resolve, Math.min(100, end - Date.now()))); } }
  async open(device) { this.checkCancelled(); this.device = device; if (!device.opened) await device.open(); device.addEventListener('inputreport', this.onReport); }
  async close() { if (!this.device) return; this.device.removeEventListener('inputreport', this.onReport); if (this.device.opened) await this.device.close(); this.device = null; }
  async reconnect(previous) {
    await this.close();
    const deadline = Date.now() + 5000;
    let lastError;
    while (Date.now() < deadline) {
      this.checkCancelled();
      const devices = await TiFlasher.devices();
      const match = previous.serialNumber ? devices.find((device) => device.serialNumber === previous.serialNumber) : (devices.length === 1 ? devices[0] : null);
      if (match) {
        try { await this.open(match); return; } catch (error) { lastError = error; }
      }
      await this.sleep(250);
    }
    throw new Error(`TI RAM BSL device did not reconnect${lastError ? ': ' + lastError.message : '.'}`);
  }
  onReport(event) {
    if (event.reportId !== 0x3f || !this.pending) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
    pending.resolve(bytes.slice(1, 1 + bytes[0]));
  }
  async command(code, payload = new Uint8Array(), response = true) {
    this.checkCancelled();
    if (payload.length + 3 > 64) throw new Error('TI HID payload exceeds 64-byte report.');
    const report = new Uint8Array(63).fill(0xac);
    report[0] = payload.length + 1;
    report[1] = code;
    report.set(payload, 2);
    const answer = response ? new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; reject(new Error('TI HID response timed out.')); }, 10000);
      this.pending = { resolve, reject, timer };
    }) : null;
    try { await this.device.sendReport(0x3f, report); }
    catch (error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; } throw error; }
    if (!response) return new Uint8Array();
    const packet = await answer;
    if (!packet.length) throw new Error('Empty TI HID response.');
    if (packet[0] === 0x3b) {
      const status = packet[1] ?? 255;
      if (status) throw new Error(ERRORS[status] || `TI BSL status ${status}.`);
      return new Uint8Array();
    }
    if (packet[0] !== 0x3a) throw new Error(`Unknown TI BSL response 0x${packet[0].toString(16)}.`);
    return packet.slice(1);
  }
  async password(bytes) { await this.command(CMD.PASSWORD, bytes); }
  async loadPc(address) { await this.command(CMD.LOAD_PC, threeBytes(address), false); }
  async writeBlock(address, bytes, fast = true) {
    await this.command(fast ? CMD.RX_DATA_FAST : CMD.RX_DATA, join(threeBytes(address), bytes), !fast);
  }
  async writeImage(segments, start, end, quiet = false) {
    const total = segments.reduce((n, item) => n + item.data.length, 0);
    let written = 0;
    for (const segment of segments) {
      this.checkCancelled();
      if (!quiet) this.log(`Write TI segment 0x${segment.address.toString(16)} (${segment.data.length} bytes)`);
      let data = segment.data;
      if (data.length % 2) data = join(data, Uint8Array.of(0xff));
      for (let offset = 0; offset < data.length; offset += 48) {
        this.checkCancelled();
        const block = data.slice(offset, offset + 48);
        await this.writeBlock(segment.address + offset, block);
        written += Math.min(block.length, segment.data.length - offset);
        this.progress(start + Math.round((end - start) * written / Math.max(1, total)));
      }
    }
  }
  async flash(device, imageBytes, name, ramBytes, checkVersion) {
    const image = parseTiImage(imageBytes, name);
    const ram = parseTiText(ramBytes);
    this.cancelled = false;
    try {
      this.step('Opening TI HID device', 5); await this.open(device);
      this.step('Triggering mass erase', 12);
      try { await this.password(join(new Uint8Array(30).fill(0xff), Uint8Array.of(0, 0))); } catch (error) { this.checkCancelled(); this.log(`Expected erase response: ${error.message}`); }
      await this.sleep(1000);
      this.step('Unlocking blank password', 20); await this.password(new Uint8Array(32).fill(0xff));
      this.step('Uploading RAM BSL', 28); await this.writeImage(ram, 28, 48, true);
      await this.loadPc(RAM_BSL_START);
      this.step('Waiting for RAM BSL', 52); await this.sleep(3000);
      await this.reconnect(device);
      if (checkVersion) {
        const version = await this.command(CMD.VERSION);
        this.log(`RAM BSL version: ${Array.from(version).map((byte) => byte.toString(16).padStart(2, '0')).join('.')}`);
        if (version.length !== 4 || version.some((byte, index) => byte !== RAM_BSL_VERSION[index])) this.log('WARNING: RAM BSL version mismatch; continuing.');
      }
      this.step('Programming TI firmware', 60); await this.writeImage(image, 60, 95);
      this.step('Resetting TI device', 98);
      try { await this.writeBlock(0x0120, Uint8Array.of(0xa5, 0x06)); await this.loadPc(RAM_BSL_START); }
      catch (error) { this.log(`Reset response: ${error.message}`); }
      this.progress(100); this.log('TI FLASH SUCCESSFUL.');
      return true;
    } finally { await this.close().catch(() => {}); }
  }
}
