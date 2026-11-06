import './style.css';
import './layout.css';
import companyLogo from '../assets/images/company_logo.png';
import { EspFlasher } from './esp.js';
import { TiFlasher } from './ti.js';

const $ = (id) => document.getElementById(id);
$('company-logo').src = companyLogo;
const names = { scanDevices: 'Scan devices', scanFirmware: 'Scan firmware', flashEsp: 'Flash ESP32', flashTi: 'Flash TI', flashBoth: 'Flash both', cancel: 'Cancel', checkEsp: 'Check ESP32', settings: 'Open Settings' };
const state = { settings: null, files: { ESP32: [], TI: [] }, productionOnline: { ESP32: [], TI: [] }, productionLocal: { ESP32: [], TI: [] }, syncing: false, online: [], ports: [], port: null, tiDevice: null, busy: null, cancelled: false, flasher: null, logId: null, logPending: Promise.resolve(), onlineTarget: null };
const slotIds = { Bootloader: 'esp-bootloader', Partition: 'esp-partition', Target: 'esp-target' };
const productionSlotIds = { Bootloader: 'prod-bootloader', Partition: 'prod-partition', Target: 'prod-target' };

function stamp() { return new Date().toLocaleTimeString(); }
function log(message, error = false) {
  for (const line of String(message).split(/\r?\n/)) {
    if (!line) continue;
    const row = document.createElement('div'); row.className = `log-line${error ? ' error' : ''}`;
    const time = document.createElement('span'); time.className = 'log-time'; time.textContent = stamp();
    row.append(time, document.createTextNode(line)); $('event-log').append(row);
    if ($('event-log').children.length > 500) $('event-log').firstChild.remove();
    $('event-log').scrollTop = $('event-log').scrollHeight;
    if (state.logId) { const id = state.logId; state.logPending = state.logPending.then(() => window.lt700.logWrite(id, line)).catch(() => {}); }
  }
}
function errorText(error) { return error?.message || String(error); }
function showError(error) { log(`ERROR: ${errorText(error)}`, true); window.alert(errorText(error)); }
function setStatus(target, text, kind = '') {
  const element = $(target === 'ESP32' ? 'esp-status' : 'ti-status');
  element.textContent = text; element.className = `status-badge ${kind}`;
  const pill = $(target === 'ESP32' ? 'esp-pill' : 'ti-pill');
  pill.textContent = `${target === 'ESP32' ? 'ESP32' : 'TI'} · ${text}`;
  pill.className = `top-pill ${kind === 'connected' || kind === 'success' ? 'connected' : ''}`;
  updateProductionSummary();
}
function switchMode(mode) {
  const production = mode === 'production';
  $('production-view').hidden = !production;
  $('development-view').hidden = production;
  $('mode-production').classList.toggle('active', production);
  $('mode-development').classList.toggle('active', !production);
  $('mode-production').setAttribute('aria-selected', String(production));
  $('mode-development').setAttribute('aria-selected', String(!production));
}
function switchDevice(target) {
  const esp = target === 'ESP32';
  $('esp-station').hidden = !esp;
  $('ti-station').hidden = esp;
  $('dev-esp-tab').classList.toggle('active', esp);
  $('dev-ti-tab').classList.toggle('active', !esp);
  $('dev-esp-tab').setAttribute('aria-selected', String(esp));
  $('dev-ti-tab').setAttribute('aria-selected', String(!esp));
}
function updateProductionSummary() {
  if (!state.settings) return;
  $('prod-esp-state').textContent = state.port ? 'Connected' : 'Disconnected';
  $('prod-ti-state').textContent = state.tiDevice ? 'Connected' : 'Disconnected';
}
function waitDraftSeconds() {
  const input = $('sequence-wait-seconds');
  if (!input.value.trim() && !input.validity.badInput) return 10;
  const value = Number(input.value);
  if (!input.checkValidity() || !Number.isSafeInteger(value) || value < 10 || value > 60) throw new Error('Enter a whole-number wait from 10 to 60 seconds, or leave it empty for 10 seconds.');
  return value;
}
function hasPendingWait() {
  if (!state.settings) return false;
  const input = $('sequence-wait-seconds');
  return input.value.trim() === '' || input.validity.badInput || Number(input.value) !== state.settings.productionWaitSeconds;
}
function updateWaitDisplay() {
  const seconds = state.settings.productionWaitSeconds;
  $('sequence-wait-description').textContent = `${seconds}-second wait`;
}
function updateWaitSaveState() {
  const locked = Boolean(state.busy) || state.syncing;
  $('sequence-wait-save').disabled = locked || !hasPendingWait();
  $('flash-both').disabled = locked || hasPendingWait();
}
async function saveProductionWait() {
  if (state.busy || state.syncing) return;
  const seconds = waitDraftSeconds();
  state.settings = await window.lt700.saveSettings({ ...state.settings, productionWaitSeconds: seconds });
  $('sequence-wait-seconds').value = String(seconds);
  updateWaitDisplay(); updateWaitSaveState();
  log(`Production wait saved: ${seconds} seconds.`);
}
function setProgress(target, value) {
  const prefix = target === 'ESP32' ? 'esp' : 'ti';
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  $(`${prefix}-progress`).value = percent;
  $(`${prefix}-progress-text`).textContent = `${percent}%`;
  if (state.busy === 'both') setSequenceProgress(target === 'ESP32' ? percent * 0.6 : 70 + percent * 0.3);
}
function setSequenceProgress(value) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  $('sequence-progress').value = percent;
  $('sequence-progress-text').textContent = `${percent}%`;
}
function setStep(target, text, progress) {
  const prefix = target === 'ESP32' ? 'esp' : 'ti';
  $(`${prefix}-step`).textContent = text;
  if (progress !== undefined) setProgress(target, progress);
  log(`${target}: ${text}`);
}
function setBusy(kind) {
  state.busy = kind;
  const locked = Boolean(kind) || state.syncing;
  for (const id of ['scan-all', 'settings-open', 'prod-esp-connect', 'prod-ti-connect', 'prod-sync', 'prod-esp-attach', 'prod-ti-attach', 'sequence-wait-save', 'esp-connect', 'esp-check', 'esp-scan', 'esp-flash', 'esp-erase', 'esp-attach', 'esp-online', 'esp-firmware-scan', 'ti-connect', 'ti-check', 'ti-scan', 'ti-flash', 'ti-attach', 'ti-online', 'ti-firmware-scan', 'flash-both']) $(id).disabled = locked;
  for (const id of ['esp-port', 'esp-baud', 'esp-bootloader', 'esp-partition', 'esp-target', 'ti-firmware', 'esp-verify', 'sequence-wait-seconds', ...Object.values(productionSlotIds), 'prod-ti-firmware']) $(id).disabled = locked;
  updateWaitSaveState();
  $('esp-cancel').disabled = !kind || !['esp', 'both'].includes(kind);
  $('ti-cancel').disabled = !kind || !['ti', 'both'].includes(kind);
  $('cancel-both').disabled = kind !== 'both';
}
async function operation(kind, details, work) {
  if (state.busy || state.syncing) return;
  setBusy(kind); state.cancelled = false;
  let result = 'Failed';
  try { state.logId = (await window.lt700.logStart(kind, details)).id; await work(); result = 'Successful'; log(`${kind.toUpperCase()} SUCCESSFUL.`); }
  catch (error) { result = state.cancelled ? 'Cancelled' : `Failed: ${errorText(error)}`; log(result, true); if (!state.cancelled) window.alert(errorText(error)); }
  finally {
    await state.logPending;
    if (state.logId) await window.lt700.logFinish(state.logId, result).catch(() => {});
    state.logId = null; state.flasher = null; setBusy(null);
    if (kind === 'both') $('sequence-status').textContent = result;
    if (kind === 'esp') setStatus('ESP32', result === 'Successful' ? 'Successful' : result, result === 'Successful' ? 'success' : 'failed');
    if (kind === 'both' && result !== 'Successful' && $('esp-progress').value < 100) setStatus('ESP32', result, 'failed');
    if (kind === 'ti' || kind === 'both') { await refreshTiDevice(); if (result !== 'Successful' && (kind === 'ti' || $('ti-progress').value > 0)) setStatus('TI', result, 'failed'); }
  }
}
function fileById(target, id) { return state.files[target].find((file) => file.id === id); }
function productionFiles(target) { return [...state.productionOnline[target], ...state.productionLocal[target]]; }
function productionFileById(target, id) { return productionFiles(target).find((file) => file.id === id); }
function selectedProductionEsp() {
  const selected = {};
  for (const [slot, id] of Object.entries(productionSlotIds)) {
    selected[slot] = productionFileById('ESP32', $(id).value);
    if (!selected[slot]) throw new Error(`Choose a production ${slot.toLowerCase()} image from the online sync or a local file.`);
  }
  if (new Set(Object.values(selected).map((file) => file.id)).size !== 3) throw new Error('Choose a different production image for each ESP32 flash address.');
  return selected;
}
function selectedProductionTi() {
  const file = productionFileById('TI', $('prod-ti-firmware').value);
  if (!file) throw new Error('Choose a production TI firmware image from the online sync or a local file.');
  return file;
}
function selectedEsp() {
  const selected = {};
  for (const [slot, id] of Object.entries(slotIds)) {
    selected[slot] = fileById('ESP32', $(id).value);
    if (!selected[slot]) throw new Error(`Select an ESP32 ${slot} image.`);
  }
  return selected;
}
function selectedTi() {
  const item = fileById('TI', $('ti-firmware').value);
  if (!item) throw new Error('Select TI firmware.');
  return item;
}
function fileLine(file) { return `${file.name} · ${file.version === 'Unknown' ? 'version unknown' : 'v' + file.version} · ${file.releaseDate || 'date unknown'} · ${(file.size / 1024).toFixed(1)} KB · SHA-256 ${file.sha256}${file.description ? ' · ' + file.description : ''}`; }
function updateFileDetails() {
  const espLines = Object.entries(slotIds).map(([slot, id]) => { const file = fileById('ESP32', $(id).value); return `${slot}: ${file ? fileLine(file) : 'not selected'}`; });
  $('esp-file-detail').textContent = espLines.join('\n');
  $('esp-file-detail').style.whiteSpace = 'pre-line';
  const ti = fileById('TI', $('ti-firmware').value);
  $('ti-file-detail').textContent = ti ? fileLine(ti) : 'No TI firmware selected.';
  updateProductionSummary();
}
function showFirmwareDetails(target) {
  $('firmware-detail-title').textContent = target === 'ESP32' ? 'ESP32 image details' : 'TI firmware details';
  $('firmware-detail-content').textContent = target === 'ESP32' ? $('esp-file-detail').textContent : $('ti-file-detail').textContent;
  $('firmware-detail-dialog').showModal();
}
function showProductionDetails() {
  $('firmware-detail-title').textContent = 'Production image details';
  const esp = Object.entries(productionSlotIds).map(([slot, id]) => {
    const file = productionFileById('ESP32', $(id).value);
    return `${slot} · ${file ? `${file.source === 'attached' ? 'Local' : 'Online'} · ${fileLine(file)}` : 'not selected'}`;
  });
  const ti = productionFileById('TI', $('prod-ti-firmware').value);
  $('firmware-detail-content').textContent = [...esp, `TI · ${ti ? `${ti.source === 'attached' ? 'Local' : 'Online'} · ${fileLine(ti)}` : 'not selected'}`].join('\n\n');
  $('firmware-detail-dialog').showModal();
}
function option(value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; return item; }
function renderProductionFiles() {
  for (const [slot, id] of Object.entries(productionSlotIds)) {
    const select = $(id); const current = select.value;
    const files = productionFiles('ESP32');
    select.replaceChildren(option('', `Choose ${slot.toLowerCase()}`), ...files.map((file) => option(file.id, `${file.name} · ${file.source === 'attached' ? 'Local' : 'Online'}`)));
    select.value = files.some((file) => file.id === current) ? current : '';
  }
  const tiSelect = $('prod-ti-firmware'); const currentTi = tiSelect.value; const tiFiles = productionFiles('TI');
  tiSelect.replaceChildren(option('', 'Choose TI firmware'), ...tiFiles.map((file) => option(file.id, `${file.name} · ${file.source === 'attached' ? 'Local' : 'Online'}`)));
  tiSelect.value = tiFiles.some((file) => file.id === currentTi) ? currentTi : '';
}
function renderFiles(target) {
  const files = state.files[target];
  if (target === 'ESP32') {
    for (const [slot, id] of Object.entries(slotIds)) {
      const select = $(id); const existing = select.value || state.settings.esp.slots[slot];
      select.replaceChildren(option('', `Select ${slot.toLowerCase()} image`), ...files.map((file) => option(file.id, `${file.name} · ${file.source}`)));
      const bundledName = { Bootloader: 'bootloader.bin', Partition: 'partition-table.bin', Target: 'target_esp.bin' }[slot];
      select.value = files.some((file) => file.id === existing) ? existing : (files.find((file) => file.name === bundledName && file.source === 'bundled')?.id || '');
    }
  } else {
    const select = $('ti-firmware'); const existing = select.value || state.settings.ti.firmware;
    select.replaceChildren(option('', 'Select TI firmware'), ...files.map((file) => option(file.id, `${file.name} · ${file.source}`)));
    select.value = files.some((file) => file.id === existing) ? existing : (files.find((file) => file.name === 'ECO-aims_HIT_MISS_LT700_v2.hex')?.id || '');
  }
  updateFileDetails();
}
async function scanFirmware(target) {
  const files = await window.lt700.listFirmware(target); state.files[target] = files; renderFiles(target);
  log(`${target}: found ${files.length} local firmware file(s).`);
}
function portLabel(port, index) {
  const info = port.getInfo();
  const ids = info.usbVendorId ? `VID ${info.usbVendorId.toString(16).padStart(4, '0')} · PID ${(info.usbProductId || 0).toString(16).padStart(4, '0')}` : 'Serial port';
  return `Device ${index + 1} · ${ids}`;
}
async function refreshPorts() {
  if (!navigator.serial) { setStatus('ESP32', 'Web Serial unavailable', 'failed'); return; }
  const ports = await navigator.serial.getPorts(); state.ports = ports;
  const select = $('esp-port'); const chosen = state.port ? ports.indexOf(state.port) : -1;
  select.replaceChildren(option('', 'Select a device'), ...ports.map((port, index) => option(String(index), portLabel(port, index))));
  if (chosen >= 0) select.value = String(chosen);
  else if (ports.length === 1) { select.value = '0'; state.port = ports[0]; }
  else { select.value = ''; state.port = null; }
  setStatus('ESP32', state.port ? 'Connected' : ports.length ? 'Select device' : 'Disconnected', state.port ? 'connected' : '');
}
async function connectEsp() {
  try { state.port = await navigator.serial.requestPort(); await refreshPorts(); log('ESP32 serial port selected.'); }
  catch (error) { if (error.name !== 'NotFoundError') showError(error); }
}
async function refreshTiDevice() {
  if (!navigator.hid) { setStatus('TI', 'Web HID unavailable', 'failed'); return; }
  const devices = await TiFlasher.devices();
  if (state.tiDevice && !devices.includes(state.tiDevice)) state.tiDevice = null;
  if (!state.tiDevice && devices.length === 1) state.tiDevice = devices[0];
  $('ti-device-text').textContent = state.tiDevice ? `${state.tiDevice.productName || 'TI MSP430'} · VID 2047 · PID 0200` : devices.length > 1 ? 'Multiple TI HID devices found. Choose one.' : 'VID 2047 · PID 0200 · Device not selected';
  setStatus('TI', state.tiDevice ? 'Connected' : 'Disconnected', state.tiDevice ? 'connected' : '');
}
async function connectTi() {
  try { state.tiDevice = await TiFlasher.requestDevice(); await refreshTiDevice(); if (state.tiDevice) log('TI HID device selected.'); }
  catch (error) { if (error.name !== 'NotFoundError') showError(error); }
}
async function checkTi() { await refreshTiDevice(); log(state.tiDevice ? 'TI HID device detected and ready for BSL flashing.' : 'TI HID device not detected.'); }
async function scanDevices() { await refreshPorts(); await refreshTiDevice(); log('Device scan complete.'); }
async function scanAll() { await Promise.all([scanFirmware('ESP32'), scanFirmware('TI'), scanDevices()]); }
function requireEspPort() { if (!state.port) throw new Error('Connect and select an ESP32 serial device.'); return state.port; }
function requireTiDevice() { if (!state.tiDevice) throw new Error('Connect and select a TI HID device.'); return state.tiDevice; }
async function loadEspImages(files) {
  const output = {};
  for (const [slot, file] of Object.entries(files)) output[slot] = { ...file, data: new Uint8Array(await window.lt700.readFirmware(file.id)) };
  return output;
}
async function flashEspStep(selected = selectedEsp()) {
  const port = requireEspPort(); const images = await loadEspImages(selected);
  state.flasher = new EspFlasher({ log: (line) => log(`ESP32: ${line}`), progress: (value) => setProgress('ESP32', value), step: (line, percent) => setStep('ESP32', line, percent) });
  setStatus('ESP32', 'Flashing', 'busy'); setProgress('ESP32', 0);
  await state.flasher.flash(port, state.settings.esp.baud, images, $('esp-verify').checked);
  state.flasher = null;
  setStatus('ESP32', 'Successful', 'success');
}
async function flashTiStep(file = selectedTi()) {
  const device = requireTiDevice();
  const [image, ram] = await Promise.all([window.lt700.readFirmware(file.id), window.lt700.readRamBsl()]);
  state.flasher = new TiFlasher({ log: (line) => log(`TI: ${line}`), progress: (value) => setProgress('TI', value), step: (line, percent) => setStep('TI', line, percent) });
  setStatus('TI', 'Flashing', 'busy'); setProgress('TI', 0);
  await state.flasher.flash(device, new Uint8Array(image), file.name, new Uint8Array(ram), window.lt700.getPlatform() === 'win32');
  state.flasher = null;
  setStatus('TI', 'Successful', 'success');
}
async function flashEsp() {
  try {
    requireEspPort(); const files = selectedEsp();
    const summary = `Flash ESP32-C6?\nBaud: ${state.settings.esp.baud}\n${Object.entries(files).map(([slot, file]) => `${slot}: ${file.name} · SHA-256 ${file.sha256}`).join('\n')}`;
    if (!window.confirm(summary)) return;
    await operation('esp', { baud: state.settings.esp.baud, files: Object.values(files).map((file) => ({ name: file.name, sha256: file.sha256 })) }, flashEspStep);
  } catch (error) { showError(error); }
}
async function flashTi() {
  try {
    requireTiDevice(); const file = selectedTi();
    if (!window.confirm(`Flash TI MSP430?\nDevice: VID 2047 / PID 0200\nFirmware: ${file.name}\nSHA-256: ${file.sha256}\nThis includes a mass erase.`)) return;
    await operation('ti', { firmware: file.name, sha256: file.sha256 }, flashTiStep);
  } catch (error) { showError(error); }
}
async function flashBoth() {
  try {
    if (state.syncing) throw new Error('Wait for the production online sync to finish.');
    if (hasPendingWait()) throw new Error('Save the production wait time with ✓ before starting.');
    const waitSeconds = state.settings.productionWaitSeconds;
    requireEspPort(); requireTiDevice(); const esp = selectedProductionEsp(); const ti = selectedProductionTi();
    const summary = `Flash both devices?\n1. ESP32-C6:\n${Object.entries(esp).map(([slot, file]) => `   ${slot}: ${file.name} (${file.source === 'attached' ? 'Local' : 'Online'}) · SHA-256 ${file.sha256}`).join('\n')}\n2. Wait ${waitSeconds} seconds\n3. TI MSP430: ${ti.name} (${ti.source === 'attached' ? 'Local' : 'Online'}) · SHA-256 ${ti.sha256}\nTI flashing includes mass erase. The sequence stops if ESP32 fails.`;
    if (!window.confirm(summary)) return;
    await operation('both', { esp: Object.values(esp).map((file) => ({ name: file.name, sha256: file.sha256 })), waitSeconds, ti: { name: ti.name, sha256: ti.sha256 } }, async () => {
      setSequenceProgress(0);
      $('sequence-status').textContent = 'Step 1/3: Flashing ESP32'; await flashEspStep(esp);
      state.flasher = null;
      for (let remaining = waitSeconds; remaining > 0; remaining--) {
        if (state.cancelled) throw new Error('Combined flash cancelled.');
        $('sequence-status').textContent = `Step 2/3: Waiting ${remaining}s before TI`;
        setSequenceProgress(60 + ((waitSeconds - remaining) / waitSeconds) * 10);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (state.cancelled) throw new Error('Combined flash cancelled.');
      setSequenceProgress(70);
      $('sequence-status').textContent = 'Step 3/3: Flashing TI'; await flashTiStep(ti);
      setSequenceProgress(100);
    });
  } catch (error) { showError(error); }
}
async function eraseEsp() {
  try {
    requireEspPort();
    if (!window.confirm('Erase the entire ESP32-C6 flash? This removes all current ESP firmware and data.')) return;
    await operation('esp', { action: 'erase', baud: state.settings.esp.baud }, async () => {
      state.flasher = new EspFlasher({ log: (line) => log(`ESP32: ${line}`), progress: (value) => setProgress('ESP32', value), step: (line, percent) => setStep('ESP32', line, percent) });
      await state.flasher.erase(state.port, state.settings.esp.baud);
    });
  } catch (error) { showError(error); }
}
async function checkEsp() {
  try {
    requireEspPort();
    await operation('esp', { action: 'check', baud: state.settings.esp.baud }, async () => {
      state.flasher = new EspFlasher({ log: (line) => log(`ESP32: ${line}`), progress: (value) => setProgress('ESP32', value), step: (line, percent) => setStep('ESP32', line, percent) });
      await state.flasher.check(state.port, state.settings.esp.baud);
    });
  } catch (error) { showError(error); }
}
function cancel() { if (!state.busy) return; state.cancelled = true; state.flasher?.cancel(); $('sequence-status').textContent = 'Cancelling…'; log('Cancel requested by operator.'); }

function chord(event) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return '';
  if (!(event.ctrlKey || event.metaKey || event.altKey) && !/^F\d{1,2}$/.test(key)) return '';
  return [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
}
function fillSettings() {
  $('setting-theme').value = state.settings.theme;
  $('setting-source').value = state.settings.sourceUrl;
  $('setting-online-refresh').value = state.settings.onlineRefresh === 'manual' ? 'manual' : 'both';
  const box = $('shortcut-fields'); box.replaceChildren();
  for (const [action, label] of Object.entries(names)) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.dataset.action = action; input.value = state.settings.shortcuts[action] || ''; input.placeholder = 'Click and press shortcut'; input.readOnly = true;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); input.value = ''; return; }
      const value = chord(event); if (value) { event.preventDefault(); input.value = value; }
    });
    wrapper.append(input); box.append(wrapper);
  }
}
function applyTheme() {
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
async function saveSettings() {
  const shortcuts = Object.fromEntries([...$('shortcut-fields').querySelectorAll('input')].map((input) => [input.dataset.action, input.value]));
  const assigned = Object.values(shortcuts).filter(Boolean);
  if (new Set(assigned).size !== assigned.length) throw new Error('Two actions use the same keyboard shortcut.');
  const sourceUrl = $('setting-source').value.trim();
  if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) throw new Error('SeaDrive folder link must use HTTPS.');
  const sourceChanged = sourceUrl !== state.settings.sourceUrl;
  state.settings = await window.lt700.saveSettings({ ...state.settings, theme: $('setting-theme').value, sourceUrl, onlineRefresh: $('setting-online-refresh').value, shortcuts });
  applyTheme(); $('settings-dialog').close(); log('Settings saved.');
  if (sourceChanged) {
    state.productionOnline = { ESP32: [], TI: [] };
    renderProductionFiles();
    $('prod-sync-status').textContent = 'Online folder changed. Sync to load its firmware.';
    if (sourceUrl && state.settings.onlineRefresh !== 'manual') await syncProductionOnline();
  }
}
async function persistSelections() {
  if (!state.settings) return;
  state.settings.esp.baud = Number($('esp-baud').value);
  state.settings.esp.verify = $('esp-verify').checked;
  state.settings.esp.slots = Object.fromEntries(Object.entries(slotIds).map(([slot, id]) => [slot, $(id).value]));
  state.settings.ti.firmware = $('ti-firmware').value;
  state.settings = await window.lt700.saveSettings(state.settings);
}
async function refreshOnline(showDialog = true) {
  if (showDialog) { $('online-dialog').showModal(); $('online-message').textContent = 'Checking SeaDrive folder…'; }
  try {
    state.online = await window.lt700.listOnline();
    $('online-message').textContent = `${state.online.length} firmware file(s) available.`;
    const container = $('online-items'); container.replaceChildren();
    for (const item of state.online.filter((item) => !state.onlineTarget || item.target === state.onlineTarget)) {
      const row = document.createElement('div'); row.className = 'online-item';
      const details = document.createElement('div'); details.textContent = item.name;
      const meta = document.createElement('small'); meta.textContent = `${item.target} · ${item.size ? (item.size / 1024).toFixed(1) + ' KB' : 'size unknown'}${item.sha256 ? ' · SHA-256 supplied' : ''}`;
      details.append(meta); const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Download';
      button.addEventListener('click', async () => {
        button.disabled = true; button.textContent = 'Downloading…';
        try { const file = await window.lt700.downloadOnline(item.id); await scanFirmware(file.target); log(`Downloaded ${file.name} from SeaDrive · SHA-256 ${file.sha256}`); button.textContent = 'Downloaded'; }
        catch (error) { button.disabled = false; button.textContent = 'Retry'; showError(error); }
      });
      row.append(details, button); container.append(row);
    }
    log(`SeaDrive folder checked: ${state.online.length} firmware file(s).`);
  } catch (error) {
    $('online-message').textContent = `SeaDrive unavailable: ${errorText(error)}`;
    log(`SeaDrive unavailable: ${errorText(error)}`, true);
  }
}
async function syncProductionOnline() {
  if (state.busy || state.syncing) return;
  if (!state.settings.sourceUrl) {
    $('prod-sync-status').textContent = 'Set a SeaDrive folder link in Settings, or choose local files.';
    return;
  }
  state.syncing = true; setBusy(null);
  $('prod-sync-status').textContent = 'Checking online folder…';
  try {
    const items = await window.lt700.listOnline();
    const next = { ESP32: [], TI: [] }; let failed = 0;
    for (const [index, item] of items.entries()) {
      $('prod-sync-status').textContent = `Syncing online firmware ${index + 1}/${items.length}: ${item.name}`;
      try {
        const file = await window.lt700.downloadOnline(item.id);
        next[file.target].push(file);
        log(`Production sync: ${file.name} · SHA-256 ${file.sha256}`);
      } catch (error) { failed++; log(`Production sync failed for ${item.name}: ${errorText(error)}`, true); }
    }
    state.productionOnline = next;
    renderProductionFiles();
    await Promise.all([scanFirmware('ESP32'), scanFirmware('TI')]);
    const count = next.ESP32.length + next.TI.length;
    $('prod-sync-status').textContent = `${count} online file(s) ready${failed ? ` · ${failed} failed` : ''}. Select the images to flash.`;
    log(`Production online sync complete: ${count} ready, ${failed} failed.`);
  } catch (error) {
    $('prod-sync-status').textContent = `Online sync unavailable: ${errorText(error)}. Local files can still be chosen.`;
    log(`Production online sync unavailable: ${errorText(error)}`, true);
  } finally { state.syncing = false; setBusy(null); }
}
async function attachProduction(target) {
  if (state.busy || state.syncing) return;
  const file = await window.lt700.attachFirmware(target);
  if (!file) return;
  state.productionLocal[target] = [...state.productionLocal[target].filter((item) => item.id !== file.id), file];
  renderProductionFiles();
  await scanFirmware(target);
  if (target === 'TI') $('prod-ti-firmware').value = file.id;
  log(`Production local file attached: ${file.name} · SHA-256 ${file.sha256}`);
}

function bind() {
  $('sequence-wait-seconds').addEventListener('input', updateWaitSaveState);
  $('sequence-wait-save').addEventListener('click', () => saveProductionWait().catch(showError));
  $('esp-detail-open').addEventListener('click', () => showFirmwareDetails('ESP32'));
  $('ti-detail-open').addEventListener('click', () => showFirmwareDetails('TI'));
  $('prod-details').addEventListener('click', showProductionDetails);
  $('firmware-detail-close').addEventListener('click', () => $('firmware-detail-dialog').close());
  $('firmware-detail-done').addEventListener('click', () => $('firmware-detail-dialog').close());
  $('mode-production').addEventListener('click', () => switchMode('production'));
  $('mode-development').addEventListener('click', () => switchMode('development'));
  $('dev-esp-tab').addEventListener('click', () => switchDevice('ESP32'));
  $('dev-ti-tab').addEventListener('click', () => switchDevice('TI'));
  $('prod-esp-connect').addEventListener('click', connectEsp);
  $('prod-ti-connect').addEventListener('click', connectTi);
  $('prod-sync').addEventListener('click', () => syncProductionOnline().catch(showError));
  $('prod-esp-attach').addEventListener('click', () => attachProduction('ESP32').catch(showError));
  $('prod-ti-attach').addEventListener('click', () => attachProduction('TI').catch(showError));
  $('log-expand').addEventListener('click', () => {
    const expanded = $('app').querySelector('main').classList.toggle('log-expanded');
    $('log-expand').textContent = expanded ? 'Compact' : 'Expand';
    $('log-expand').title = expanded ? 'Compact event log' : 'Expand event log';
  });
  $('log-close').addEventListener('click', () => { $('app').querySelector('main').classList.add('log-closed'); $('log-reopen').hidden = false; });
  $('log-reopen').addEventListener('click', () => { $('app').querySelector('main').classList.remove('log-closed'); $('log-reopen').hidden = true; });
  $('guide-open').addEventListener('click', () => window.lt700.openGuide().catch(showError));
  $('settings-open').addEventListener('click', () => { fillSettings(); $('settings-dialog').showModal(); });
  $('settings-save').addEventListener('click', async (event) => { event.preventDefault(); try { await saveSettings(); } catch (error) { showError(error); } });
  $('scan-all').addEventListener('click', () => scanAll().catch(showError));
  $('esp-connect').addEventListener('click', connectEsp); $('esp-scan').addEventListener('click', () => refreshPorts().catch(showError));
  $('ti-connect').addEventListener('click', connectTi); $('ti-check').addEventListener('click', () => checkTi().catch(showError)); $('ti-scan').addEventListener('click', () => refreshTiDevice().catch(showError));
  $('esp-firmware-scan').addEventListener('click', () => scanFirmware('ESP32').catch(showError));
  $('ti-firmware-scan').addEventListener('click', () => scanFirmware('TI').catch(showError));
  $('esp-attach').addEventListener('click', async () => { try { if (await window.lt700.attachFirmware('ESP32')) await scanFirmware('ESP32'); } catch (error) { showError(error); } });
  $('ti-attach').addEventListener('click', async () => { try { if (await window.lt700.attachFirmware('TI')) await scanFirmware('TI'); } catch (error) { showError(error); } });
  for (const [id, target] of [['esp-online', 'ESP32'], ['ti-online', 'TI']]) $(id).addEventListener('click', () => { state.onlineTarget = target; refreshOnline().catch(showError); });
  $('online-refresh').addEventListener('click', () => refreshOnline(false).catch(showError));
  $('online-close').addEventListener('click', () => $('online-dialog').close()); $('online-done').addEventListener('click', () => $('online-dialog').close());
  $('esp-flash').addEventListener('click', flashEsp); $('ti-flash').addEventListener('click', flashTi); $('flash-both').addEventListener('click', flashBoth);
  $('esp-erase').addEventListener('click', eraseEsp); $('esp-check').addEventListener('click', checkEsp);
  for (const id of ['esp-cancel', 'ti-cancel', 'cancel-both']) $(id).addEventListener('click', cancel);
  $('open-logs').addEventListener('click', () => window.lt700.openLogFolder().catch(showError));
  for (const id of [...Object.values(slotIds), 'ti-firmware', 'esp-baud', 'esp-verify']) $(id).addEventListener('change', () => { updateFileDetails(); persistSelections().catch(showError); });
  $('esp-port').addEventListener('change', (event) => { state.port = state.ports[Number(event.target.value)] || null; setStatus('ESP32', state.port ? 'Connected' : 'Disconnected', state.port ? 'connected' : ''); });
  document.addEventListener('keydown', (event) => {
    if (!state.settings || $('settings-dialog').open || $('online-dialog').open || $('firmware-detail-dialog').open) return;
    if (event.target.closest('input,select,textarea,[contenteditable]')) return;
    const value = chord(event);
    const action = Object.keys(names).find((name) => state.settings.shortcuts[name] === value && value);
    if (!action) return; event.preventDefault();
    const actions = { scanDevices, scanFirmware: () => Promise.all([scanFirmware('ESP32'), scanFirmware('TI')]), flashEsp, flashTi, flashBoth, cancel, checkEsp, settings: () => $('settings-open').click() };
    Promise.resolve(actions[action]()).catch(showError);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('beforeunload', () => { if (state.busy) state.flasher?.cancel(); });
}
async function init() {
  state.settings = await window.lt700.loadSettings();
  applyTheme(); bind(); $('esp-baud').value = String(state.settings.esp.baud); $('esp-verify').checked = state.settings.esp.verify;
  $('sequence-wait-seconds').value = String(state.settings.productionWaitSeconds);
  updateWaitDisplay(); updateWaitSaveState();
  await scanAll().catch(showError);
  if (state.settings.onlineRefresh !== 'manual' && state.settings.sourceUrl) await syncProductionOnline();
  setInterval(() => { if (!state.busy) Promise.all([refreshPorts(), refreshTiDevice()]).catch((error) => log(errorText(error), true)); }, 5000);
}
init().catch(showError);
