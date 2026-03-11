const path = require('path');
const { existsSync } = require('fs');
const { readFile } = require('fs/promises');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

let mainWindow = null;

const isValidEpub = (filePath = '') => /\.epub$/i.test(filePath);

function serializeBook(filePath, buffer) {
  return {
    filePath,
    fileName: path.basename(filePath),
    data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };
}

async function readEpubPayload(filePath) {
  if (!filePath) {
    return null;
  }
  if (!isValidEpub(filePath)) {
    throw new Error('请选择 .epub 文件');
  }

  const buffer = await readFile(filePath);
  return serializeBook(filePath, buffer);
}

async function openEpubDialog(win) {
  const result = await dialog.showOpenDialog(win, {
    title: '打开 EPUB 文件',
    filters: [{ name: 'EPUB 文件', extensions: ['epub'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return readEpubPayload(result.filePaths[0]);
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#f7f6f3',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const builtHtml = path.join(__dirname, 'dist', 'index.html');
  if (existsSync(builtHtml)) {
    win.loadFile(builtHtml);
  } else {
    win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        '<h1>Renderer build missing</h1><p>Run pnpm start or pnpm build first.</p>'
      )}`
    );
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '打开 EPUB',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu-open-epub');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]);

  Menu.setApplicationMenu(menu);
  return win;
}

ipcMain.handle('open-epub-dialog', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return openEpubDialog(win);
});

ipcMain.handle('read-epub-file', (_event, filePath) => {
  return readEpubPayload(filePath);
});

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
