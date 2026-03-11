const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('readerApi', {
  openEpubDialog: () => ipcRenderer.invoke('open-epub-dialog'),
  readEpubFile: (filePath) => ipcRenderer.invoke('read-epub-file', filePath),
  onMenuOpenEpub: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu-open-epub', listener);
    return () => {
      ipcRenderer.removeListener('menu-open-epub', listener);
    };
  }
});
