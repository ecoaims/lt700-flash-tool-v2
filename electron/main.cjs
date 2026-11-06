const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const allowed = { ESP32: new Set(['.bin']), TI: new Set(['.hex', '.txt', '.titxt', '.titext']) };
const catalog = new Map();
const onlineCatalog = new Map();
const attached = { ESP32: new Set(), TI: new Set() };
const logHandles = new Map();
let guideWindow = null;
const defaultSettings = {
  theme: 'system',
  sourceUrl: 'https://seafile.biathlontargets.com/d/08d3a679b0/',
  onlineRefresh: 'both',
  productionWaitSeconds: 10,
  esp: { baud: 460800, verify: true, slots: { Bootloader: '', Partition: '', Target: '' } },
  ti: { firmware: '' },
  shortcuts: {},
};

function assetRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '..', 'assets');
}
function downloadRoot() { return path.join(app.getPath('userData'), 'Firmware'); }
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function logRoot() { return path.join(app.getPath('documents'), 'LT700'); }
function assertTarget(target) {
  if (target !== 'ESP32' && target !== 'TI') throw new Error('Invalid firmware target.');
}
function fileType(pathname, target) {
  return allowed[target].has(path.extname(pathname).toLowerCase());
}
function safeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const shortcuts = value.shortcuts && typeof value.shortcuts === 'object' ? value.shortcuts : {};
  return {
    theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : 'system',
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl.slice(0, 2048) : defaultSettings.sourceUrl,
    onlineRefresh: ['manual', 'launch', 'both'].includes(value.onlineRefresh) ? value.onlineRefresh : 'both',
    productionWaitSeconds: value.productionWaitSeconds != null && Number.isSafeInteger(Number(value.productionWaitSeconds)) && Number(value.productionWaitSeconds) >= 10 && Number(value.productionWaitSeconds) <= 60 ? Number(value.productionWaitSeconds) : 10,
    esp: {
      baud: [115200, 230400, 460800, 921600, 1500000].includes(Number(value.esp?.baud)) ? Number(value.esp.baud) : 460800,
      verify: value.esp?.verify !== false,
      slots: Object.fromEntries(['Bootloader', 'Partition', 'Target'].map((key) => [key, String(value.esp?.slots?.[key] || '')])),
    },
    ti: { firmware: String(value.ti?.firmware || '') },
    shortcuts: Object.fromEntries(Object.entries(shortcuts).filter(([key, shortcut]) => /^[a-z]+$/.test(key) && typeof shortcut === 'string' && shortcut.length < 80)),
  };
}
async function loadSettings() {
  try { return safeSettings(JSON.parse(await fsp.readFile(settingsPath(), 'utf8'))); }
  catch { return structuredClone(defaultSettings); }
}
async function saveSettings(value) {
  const clean = safeSettings(value);
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  const temporary = `${settingsPath()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(clean, null, 2), { mode: 0o600 });
  await fsp.rename(temporary, settingsPath());
  return clean;
}
function inferredVersion(name) { return name.match(/(?:^|[_\-\s])v?(\d+(?:\.\d+){1,3})(?:[_\-\s.]|$)/i)?.[1] || 'Unknown'; }
async function describeFirmware(file, target, source, meta = {}) {
  const bytes = await fsp.readFile(file);
  const stat = await fsp.stat(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const expected = String(meta.sha256 || meta.checksum || '').toLowerCase();
  if (/^[a-f0-9]{64}$/.test(expected) && expected !== sha256) throw new Error(`${path.basename(file)} failed the manifest SHA-256 check.`);
  const id = crypto.createHash('sha256').update(file).digest('hex');
  catalog.set(id, { file, target, sha256 });
  return { id, name: path.basename(file), target, source, size: stat.size, modified: stat.mtime.toISOString(), sha256,
    version: String(meta.version || inferredVersion(path.parse(file).name)), releaseDate: String(meta.release_date || meta.date || stat.mtime.toISOString().slice(0, 10)), description: String(meta.description || '') };
}
async function readManifest(folder) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(folder, 'manifest.json'), 'utf8'));
    if (Array.isArray(data)) return Object.fromEntries(data.filter((item) => item && (item.filename || item.name)).map((item) => [path.basename(item.filename || item.name), item]));
    if (Array.isArray(data?.firmware)) return Object.fromEntries(data.firmware.filter((item) => item && (item.filename || item.name)).map((item) => [path.basename(item.filename || item.name), item]));
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
async function listFirmware(target) {
  assertTarget(target);
  const folders = [
    [path.join(assetRoot(), 'Firmware', target), 'bundled'],
    [path.join(downloadRoot(), target), 'downloaded'],
  ];
  const found = [];
  for (const [folder, source] of folders) {
    let names = [];
    try { names = await fsp.readdir(folder); } catch { /* folder may not exist */ }
    const manifest = await readManifest(folder);
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const file = path.join(folder, name);
      if (!fileType(file, target)) continue;
      try { if ((await fsp.stat(file)).isFile()) found.push(await describeFirmware(file, target, source, manifest[name] || {})); }
      catch { /* a file was removed while scanning */ }
    }
  }
  for (const file of attached[target]) {
    try { found.push(await describeFirmware(file, target, 'attached')); }
    catch { attached[target].delete(file); }
  }
  return found;
}
async function attachFirmware(target) {
  assertTarget(target);
  const filters = target === 'ESP32' ? [{ name: 'ESP32 binary', extensions: ['bin'] }] : [{ name: 'TI firmware', extensions: ['hex', 'txt', 'titxt', 'titext'] }];
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  if (!fileType(file, target)) throw new Error(`Unsupported ${target} firmware file type.`);
  attached[target].add(file);
  return describeFirmware(file, target, 'attached');
}
function shareInfo(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS SeaDrive public folder link without credentials or query parameters.');
  const match = url.pathname.match(/^\/d\/([a-zA-Z0-9]+)\/?$/);
  if (!match) throw new Error('Expected a SeaDrive folder share link ending in /d/<share-token>/.');
  return { origin: url.origin, token: match[1] };
}
async function fetchShareJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`SeaDrive folder request failed (HTTP ${response.status}).`);
  if (new URL(response.url).origin !== new URL(url).origin) throw new Error('SeaDrive redirected to another server.');
  return response.json();
}
function entriesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['dirents', 'entries', 'files', 'data']) if (Array.isArray(payload?.[key])) return payload[key];
  throw new Error('SeaDrive returned an unrecognized folder listing.');
}
async function listOnline() {
  const { sourceUrl } = await loadSettings();
  const { origin, token } = shareInfo(sourceUrl);
  let payload;
  try { payload = await fetchShareJson(`${origin}/api/v2.1/share-links/${token}/dirents/?path=%2F`); }
  catch (firstError) {
    try { payload = await fetchShareJson(`${origin}/api2/d/${token}/dir/?p=%2F`); }
    catch { throw firstError; }
  }
  onlineCatalog.clear();
  const result = [];
  for (const item of entriesFromPayload(payload)) {
    const name = String(item.name || item.filename || '');
    const kind = String(item.type || item.obj_type || item.kind || '').toLowerCase();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || kind === 'dir' || kind === 'folder') continue;
    const extension = path.extname(name).toLowerCase();
    const target = allowed.ESP32.has(extension) ? 'ESP32' : allowed.TI.has(extension) ? 'TI' : null;
    if (!target) continue;
    const id = crypto.createHash('sha256').update(`${origin}/${token}/${name}`).digest('hex');
    const details = { id, name, target, size: Number(item.size || 0), sha256: String(item.sha256 || item.checksum || '').toLowerCase(), origin, token };
    onlineCatalog.set(id, details);
    result.push({ id, name, target, size: details.size, sha256: details.sha256 });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
async function downloadOnline(id) {
  const item = onlineCatalog.get(id);
  if (!item) throw new Error('Online item is no longer in the folder listing. Refresh the folder.');
  const current = shareInfo((await loadSettings()).sourceUrl);
  if (current.origin !== item.origin || current.token !== item.token) throw new Error('Online folder changed. Refresh the listing.');
  const remote = `${item.origin}/d/${item.token}/files/?p=${encodeURIComponent('/' + item.name)}&dl=1`;
  const response = await fetch(remote, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`SeaDrive download failed (HTTP ${response.status}).`);
  if (new URL(response.url).origin !== item.origin) throw new Error('SeaDrive download redirected to another server.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.length) throw new Error('SeaDrive returned an empty firmware file.');
  if (item.size && data.length !== item.size) throw new Error('Downloaded firmware size does not match the online listing.');
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  if (item.sha256 && item.sha256 !== sha256) throw new Error('Downloaded firmware SHA-256 does not match the online listing.');
  const folder = path.join(downloadRoot(), item.target);
  await fsp.mkdir(folder, { recursive: true });
  const file = path.join(folder, item.name);
  const temporary = `${file}.${crypto.randomBytes(4).toString('hex')}.download`;
  try { await fsp.writeFile(temporary, data, { mode: 0o600 }); await fsp.rename(temporary, file); }
  catch (error) { await fsp.unlink(temporary).catch(() => {}); throw error; }
  return describeFirmware(file, item.target, 'downloaded');
}
function configureDeviceAccess() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => Boolean(webContents?.getURL().startsWith('file://')) && ['serial', 'hid'].includes(permission));
  session.defaultSession.setDevicePermissionHandler((details) => details.origin.startsWith('file://') && ['serial', 'hid'].includes(details.deviceType));
  session.defaultSession.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    const options = portList.map((port) => ({ label: `${port.portName || port.displayName || 'Serial device'}  ${port.displayName || ''}`, value: port.portId }));
    dialog.showMessageBox(BrowserWindow.fromWebContents(webContents), {
      type: 'question', title: 'Select ESP32 serial port', message: 'Choose the LT700 ESP32 serial port',
      buttons: [...options.map((option) => option.label), 'Cancel'], cancelId: options.length,
    }).then(({ response }) => callback(options[response]?.value || '')).catch(() => callback(''));
  });
  session.defaultSession.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const devices = details.deviceList.filter((item) => item.vendorId === 0x2047 && item.productId === 0x0200);
    if (devices.length === 1) { callback(devices[0].deviceId); return; }
    if (!devices.length) { callback(''); return; }
    dialog.showMessageBox({
      type: 'question', title: 'Select TI HID device', message: 'Choose the TI board to flash',
      buttons: [...devices.map((item, index) => `${index + 1}. ${item.productName || 'TI MSP430'} ${item.serialNumber || ''}`), 'Cancel'], cancelId: devices.length,
    }).then(({ response }) => callback(devices[response]?.deviceId || '')).catch(() => callback(''));
  });
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 760, title: `LT700 Firmware Tool ${app.getVersion()}`, icon: path.join(assetRoot(), 'images', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
function openGuide() {
  if (guideWindow && !guideWindow.isDestroyed()) {
    if (guideWindow.isMinimized()) guideWindow.restore();
    guideWindow.focus();
    return;
  }
  const guidePath = path.join(assetRoot(), 'guide', 'index.html');
  const guideUrl = pathToFileURL(guidePath).href;
  guideWindow = new BrowserWindow({
    width: 1120, height: 850, minWidth: 720, minHeight: 600,
    title: `LT700 Firmware Tool ${app.getVersion()} - Guide`,
    icon: path.join(assetRoot(), 'images', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  guideWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  guideWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== guideUrl) event.preventDefault();
  });
  guideWindow.on('closed', () => { guideWindow = null; });
  guideWindow.loadFile(guidePath);
}
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.setIcon(path.join(assetRoot(), 'images', 'icon.png'));
  configureDeviceAccess();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('settings:load', loadSettings);
ipcMain.handle('settings:save', (_event, value) => saveSettings(value));
ipcMain.handle('firmware:list', (_event, target) => listFirmware(target));
ipcMain.handle('firmware:attach', (_event, target) => attachFirmware(target));
ipcMain.handle('firmware:read', async (_event, id) => {
  const item = catalog.get(id);
  if (!item || !fileType(item.file, item.target)) throw new Error('Firmware selection expired. Rescan firmware.');
  const bytes = new Uint8Array(await fsp.readFile(item.file));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Firmware file changed after scan. Rescan before flashing.');
  return bytes;
});
ipcMain.handle('firmware:ram-bsl', async () => new Uint8Array(await fsp.readFile(path.join(assetRoot(), 'TI', 'RAM_BSL_00.08.08.39.txt'))));
ipcMain.handle('online:list', listOnline);
ipcMain.handle('online:download', (_event, id) => downloadOnline(id));
ipcMain.handle('log:start', async (_event, operation, details) => {
  await fsp.mkdir(logRoot(), { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const safeName = String(operation).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  const file = path.join(logRoot(), `${timestamp}-${safeName}-${crypto.randomBytes(3).toString('hex')}.log`);
  const id = crypto.randomUUID();
  const stream = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  logHandles.set(id, stream);
  stream.write(`LT700 Firmware Tool ${app.getVersion()}\nStarted: ${new Date().toISOString()}\nOperation: ${safeName}\nDetails: ${JSON.stringify(details || {})}\n\n`);
  return { id, file };
});
ipcMain.handle('log:write', (_event, id, line) => {
  const stream = logHandles.get(id);
  if (!stream) return false;
  stream.write(`${new Date().toISOString()} ${String(line).slice(0, 10000)}\n`);
  return true;
});
ipcMain.handle('log:finish', (_event, id, result) => {
  const stream = logHandles.get(id);
  if (!stream) return false;
  stream.end(`\nFinished: ${new Date().toISOString()}\nResult: ${String(result).slice(0, 200)}\n`);
  logHandles.delete(id);
  return true;
});
ipcMain.handle('log:open-folder', async () => {
  await fsp.mkdir(logRoot(), { recursive: true });
  return shell.openPath(logRoot());
});
ipcMain.handle('guide:open', () => openGuide());
