import { app, BrowserWindow, shell, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Store from "electron-store";
import {
  generateSalt,
  deriveKey,
  encrypt,
  decrypt,
  hashPasswordForStorage,
  hashNoteId,
} from "./crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

const store = new Store<WindowBounds>({
  defaults: {
    width: 800,
    height: 600,
  },
});

interface PasswordStore {
  passwordHash?: string;
}

const passwordStore = new Store<PasswordStore>({
  name: "typehere-password",
  defaults: {},
});

const TYPEHERE_DIR = path.join(os.homedir(), ".typehere");
const NOTES_DIR = path.join(TYPEHERE_DIR, "notes");
const SALT_FILE = path.join(TYPEHERE_DIR, ".salt");
const METADATA_FILE = path.join(TYPEHERE_DIR, ".metadata.enc");
const ID_MAP_FILE = path.join(TYPEHERE_DIR, ".id-map.enc");

let fileWatcher: fs.FSWatcher | null = null;

function ensureTypehereDir() {
  if (!fs.existsSync(TYPEHERE_DIR)) {
    fs.mkdirSync(TYPEHERE_DIR, { recursive: true });
  }
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
  }
}

async function createWindow() {
  // @ts-expect-error some sort of electron typing bug?
  const { width, height, x, y } = store.get("windowBounds", {
    width: 800,
    height: 600,
  });

  win = new BrowserWindow({
    title: "Main window",
    icon: path.join(process.env.VITE_PUBLIC ?? "", "favicon.ico"),
    x,
    y,
    width,
    height,
    frame: false, // make the window frameless
    titleBarStyle: "hidden", // This hides the native title bar but keeps the traffic lights
    trafficLightPosition: { x: 10, y: 8 }, // Adjust the position of traffic lights
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(VITE_DEV_SERVER_URL);
    // Open devTool if the app is not packaged
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("close", () => {
    if (win) {
      store.set("windowBounds", win.getBounds());
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});

// New window example arg: new windows url
ipcMain.handle("open-win", (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});

ipcMain.handle("fs:init", async () => {
  ensureTypehereDir();

  if (!fs.existsSync(SALT_FILE)) {
    const salt = generateSalt();
    fs.writeFileSync(SALT_FILE, salt, "utf8");
  }

  const salt = fs.readFileSync(SALT_FILE, "utf8");
  const hasPasswordSet = passwordStore.get("passwordHash") !== undefined;

  return { salt, hasPasswordSet };
});

ipcMain.handle("fs:set-password", async (_, password: string) => {
  const passwordHash = hashPasswordForStorage(password);
  passwordStore.set("passwordHash", passwordHash);
  return true;
});

ipcMain.handle("fs:verify-password", async (_, password: string) => {
  const storedHash = passwordStore.get("passwordHash");
  if (!storedHash) {
    return false;
  }
  const passwordHash = hashPasswordForStorage(password);
  return passwordHash === storedHash;
});

ipcMain.handle("fs:read-notes", async (_, encryptionKey: string) => {
  ensureTypehereDir();

  try {
    if (!fs.existsSync(ID_MAP_FILE)) {
      return { notes: {}, metadata: {} };
    }

    const encryptedIdMap = fs.readFileSync(ID_MAP_FILE, "utf8");
    const idMapJson = decrypt(encryptedIdMap, encryptionKey);
    const idMap: Record<string, string> = JSON.parse(idMapJson);

    let metadata: Record<string, unknown> = {};
    if (fs.existsSync(METADATA_FILE)) {
      const encryptedMetadata = fs.readFileSync(METADATA_FILE, "utf8");
      const metadataJson = decrypt(encryptedMetadata, encryptionKey);
      metadata = JSON.parse(metadataJson);
    }

    const notes: Record<string, string> = {};
    for (const [noteId, hashedFilename] of Object.entries(idMap)) {
      const notePath = path.join(NOTES_DIR, `${hashedFilename}.enc`);
      if (fs.existsSync(notePath)) {
        const encryptedContent = fs.readFileSync(notePath, "utf8");
        const content = decrypt(encryptedContent, encryptionKey);
        notes[noteId] = content;
      }
    }

    return { notes, metadata };
  } catch (error) {
    console.error("Error reading notes:", error);
    return { notes: {}, metadata: {} };
  }
});

ipcMain.handle(
  "fs:write-note",
  async (_, noteId: string, content: string, encryptionKey: string) => {
    ensureTypehereDir();

    try {
      let idMap: Record<string, string> = {};
      if (fs.existsSync(ID_MAP_FILE)) {
        const encryptedIdMap = fs.readFileSync(ID_MAP_FILE, "utf8");
        const idMapJson = decrypt(encryptedIdMap, encryptionKey);
        idMap = JSON.parse(idMapJson);
      }

      let hashedFilename = idMap[noteId];
      if (!hashedFilename) {
        hashedFilename = hashNoteId(noteId);
        idMap[noteId] = hashedFilename;
        const idMapJson = JSON.stringify(idMap);
        const encryptedIdMap = encrypt(idMapJson, encryptionKey);
        fs.writeFileSync(ID_MAP_FILE, encryptedIdMap, "utf8");
      }

      const notePath = path.join(NOTES_DIR, `${hashedFilename}.enc`);
      const encryptedContent = encrypt(content, encryptionKey);
      fs.writeFileSync(notePath, encryptedContent, "utf8");

      return true;
    } catch (error) {
      console.error("Error writing note:", error);
      return false;
    }
  }
);

ipcMain.handle("fs:delete-note", async (_, noteId: string, encryptionKey: string) => {
  ensureTypehereDir();

  try {
    if (!fs.existsSync(ID_MAP_FILE)) {
      return true;
    }

    const encryptedIdMap = fs.readFileSync(ID_MAP_FILE, "utf8");
    const idMapJson = decrypt(encryptedIdMap, encryptionKey);
    const idMap: Record<string, string> = JSON.parse(idMapJson);

    const hashedFilename = idMap[noteId];
    if (hashedFilename) {
      const notePath = path.join(NOTES_DIR, `${hashedFilename}.enc`);
      if (fs.existsSync(notePath)) {
        fs.unlinkSync(notePath);
      }

      delete idMap[noteId];
      const updatedIdMapJson = JSON.stringify(idMap);
      const encryptedIdMap = encrypt(updatedIdMapJson, encryptionKey);
      fs.writeFileSync(ID_MAP_FILE, encryptedIdMap, "utf8");
    }

    return true;
  } catch (error) {
    console.error("Error deleting note:", error);
    return false;
  }
});

ipcMain.handle("fs:write-metadata", async (_, metadata: unknown, encryptionKey: string) => {
  ensureTypehereDir();

  try {
    const metadataJson = JSON.stringify(metadata);
    const encryptedMetadata = encrypt(metadataJson, encryptionKey);
    fs.writeFileSync(METADATA_FILE, encryptedMetadata, "utf8");
    return true;
  } catch (error) {
    console.error("Error writing metadata:", error);
    return false;
  }
});

ipcMain.handle("fs:start-watching", async () => {
  if (fileWatcher) {
    return true;
  }

  ensureTypehereDir();

  fileWatcher = fs.watch(NOTES_DIR, { recursive: false }, (eventType, filename) => {
    if (filename && filename.endsWith(".enc")) {
      win?.webContents.send("fs:file-changed", { eventType, filename });
    }
  });

  return true;
});

ipcMain.handle("fs:stop-watching", async () => {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  return true;
});
