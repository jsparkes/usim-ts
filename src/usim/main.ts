import { BrowserWindow } from 'electron';

export default class Main {
    static mainWindow: Electron.BrowserWindow | null;
    static application: Electron.App;
    static BrowserWindow: any;
    private static onWindowAllClosed() {
        if (process.platform !== 'darwin') {
            Main.application.quit();
        }
    }

    private static onClose() {
        // Dereference the window object. 
        Main.mainWindow = null;
    }

    private static onReady() {
        if (!Main.mainWindow) {
            Main.mainWindow = new Main.BrowserWindow({
                width: 800, height: 600, icon: ('./icon.bmp'),
                webPreferences: {
                    nodeIntegration: true
                }
            });
        }
        if (Main.mainWindow) {
            Main.mainWindow.loadURL('file://' + __dirname + '/index.html');
            Main.mainWindow.on('closed', Main.onClose);
        }
    }

    static main(app: Electron.App, browserWindow: typeof BrowserWindow) {
        
        // we pass the Electron.App object and the  
        // Electron.BrowserWindow into this function 
        // so this class has no dependencies. This 
        // makes the code easier to write tests for 
        Main.BrowserWindow = browserWindow;
        Main.application = app;
        Main.application.on('window-all-closed', Main.onWindowAllClosed);
        Main.application.on('ready', Main.onReady);
        Main.application.on('activate', () => {
            // On macOS it's common to re-create a window in the app when the
            // dock icon is clicked and there are no other windows open.
            if (Main.mainWindow === null) {
                this.onReady();
            }
        });
    }
}