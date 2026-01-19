const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    loadConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (payload) => ipcRenderer.invoke('save-config', payload),
    loadPrompt: () => ipcRenderer.invoke('get-prompt'),
    loadDefaultPrompt: () => ipcRenderer.invoke('get-default-prompt'),
    savePrompt: (text) => ipcRenderer.invoke('save-prompt', text),
    listModels: (host) => ipcRenderer.invoke('list-models', host),
    checkProxy: (host, port) => ipcRenderer.invoke('check-proxy', host, port)
});
