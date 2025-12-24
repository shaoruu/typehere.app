/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import LZString from "lz-string";
import Fuse from "fuse.js";
import AceEditor from "react-ace";
import { FaMapPin } from "react-icons/fa";
import { MdVisibilityOff } from "react-icons/md";
import { FiMoreHorizontal } from "react-icons/fi";
import isElectron from "is-electron";
import { deriveKey } from "./crypto";
import "./App.css";

const textsToReplace: [string | RegExp, string][] = [
  ["(c)", "©"],
  ["(r)", "®"],
  ["+-", "±"],
];

interface Snippet {
  name: string;
  description: string;
  getValue: () => string;
}

const digitCount = 5;

const DB_NAME = "typehere-db";
const STORE_NAME = "app-state";

interface DBSchema {
  version: number;
  stores: string[];
}

type Migration = {
  version: number;
  migrate: (db: IDBDatabase, transaction: IDBTransaction) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    migrate: (db, transaction) => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        console.log("Creating object store:", STORE_NAME);
        db.createObjectStore(STORE_NAME);
      }
      const store = transaction.objectStore(STORE_NAME);
      store.put({ version: 1, stores: [STORE_NAME] }, "db_schema");
    },
  },
];

// Update DB_VERSION automatically based on migrations
const DB_VERSION_LATEST = Math.max(...migrations.map((m) => m.version));

// Add connection pooling
const DB_CONNECTION_POOL: { [key: string]: IDBDatabase } = {};
const MAX_POOL_SIZE = 5;

function getConnectionFromPool(dbName: string): IDBDatabase | undefined {
  return DB_CONNECTION_POOL[dbName];
}

function addConnectionToPool(dbName: string, connection: IDBDatabase) {
  // If pool is full, close the oldest connection
  const poolKeys = Object.keys(DB_CONNECTION_POOL);
  if (poolKeys.length >= MAX_POOL_SIZE) {
    const oldestKey = poolKeys[0];
    DB_CONNECTION_POOL[oldestKey].close();
    delete DB_CONNECTION_POOL[oldestKey];
  }
  DB_CONNECTION_POOL[dbName] = connection;
}

function closeAllConnections() {
  Object.values(DB_CONNECTION_POOL).forEach((db) => {
    try {
      db.close();
    } catch (e) {
      console.error("Error closing DB connection:", e);
    }
  });
  Object.keys(DB_CONNECTION_POOL).forEach((key) => delete DB_CONNECTION_POOL[key]);
}

async function initDB() {
  if (!window.indexedDB) {
    console.error("Your browser doesn't support IndexedDB");
    return Promise.reject(new Error("IndexedDB not supported"));
  }

  // Check pool first
  const existingConnection = getConnectionFromPool(DB_NAME);
  if (existingConnection) {
    return existingConnection;
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION_LATEST);

    request.onerror = () => {
      console.error("Database error:", request.error);
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn("Database blocked. Please close other tabs with this app open");
      reject(new Error("Database blocked"));
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onerror = (event: Event) => {
        const target = event.target as IDBRequest;
        console.error("Database error:", target.error);
      };
      addConnectionToPool(DB_NAME, db);
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction;
      const oldVersion = event.oldVersion;

      if (!transaction) {
        console.error("No transaction available for migration");
        return;
      }

      console.log(`Running migrations from version ${oldVersion} to ${DB_VERSION_LATEST}`);

      // Run all needed migrations in order
      migrations
        .filter((migration) => migration.version > oldVersion)
        .sort((a, b) => a.version - b.version)
        .forEach((migration) => {
          console.log(`Applying migration to version ${migration.version}`);
          migration.migrate(db, transaction);
        });
    };
  });
}

async function getFromDB<T>(key: string): Promise<T | undefined> {
  try {
    const db = await initDB();

    if (!db.objectStoreNames.contains(STORE_NAME)) {
      console.warn("Store not found, reinitializing database...");
      closeAllConnections();
      await new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => resolve(undefined);
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
      return getFromDB(key);
    }

    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(STORE_NAME, "readonly");
      } catch (error) {
        console.error("Failed to create transaction:", error);
        closeAllConnections();
        // Try again after clearing the database
        reject(error);
        new Promise<void>((resolveDelete) => {
          const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
          deleteRequest.onsuccess = () => resolveDelete();
          deleteRequest.onerror = () => resolveDelete();
        }).then(() => {
          getFromDB<T>(key).then(resolve).catch(reject);
        });
        return;
      }

      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      transaction.onerror = () => {
        console.error("Transaction error:", transaction.error);
        reject(transaction.error);
      };

      request.onerror = () => {
        console.error("Read error:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    console.error("Failed to read from IndexedDB:", error);
    return undefined;
  }
}

async function setInDB<T>(key: string, value: T): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();

    if (!db.objectStoreNames.contains(STORE_NAME)) {
      console.warn("Store not found, reinitializing database...");
      closeAllConnections();
      await new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => resolve(undefined);
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
      return setInDB(key, value);
    }

    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db!.transaction(STORE_NAME, "readwrite");
      } catch (error) {
        console.error("Failed to create transaction:", error);
        closeAllConnections();
        // Try again after clearing the database
        reject(error);
        new Promise<void>((resolveDelete) => {
          const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
          deleteRequest.onsuccess = () => resolveDelete();
          deleteRequest.onerror = () => resolveDelete();
        }).then(() => {
          setInDB(key, value).then(resolve).catch(reject);
        });
        return;
      }

      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      transaction.onerror = () => {
        console.error("Transaction error:", transaction.error);
        reject(transaction.error);
      };

      request.onerror = () => {
        console.error("Write error:", request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        resolve();
      };

      request.onsuccess = () => {
        // Don't resolve here, wait for transaction complete
      };
    });
  } catch (error) {
    console.error("Failed to write to IndexedDB:", error);
    // Fallback to localStorage if IndexedDB fails
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Failed to write to localStorage:", e);
    }
  }
}

function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number
): {
  (...args: Parameters<T>): void;
  cancel: () => void;
} {
  let timeout: number | undefined;

  const debouncedFn = function (this: unknown, ...args: Parameters<T>) {
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => func.apply(this, args), wait);
  };

  debouncedFn.cancel = () => {
    if (timeout) window.clearTimeout(timeout);
  };

  return debouncedFn;
}

function usePersistentState<T extends string | number | boolean | object | null>(
  storageKey: string,
  defaultValue: T
) {
  const [data, setData] = useState<T>(defaultValue);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        let value: T | undefined = await getFromDB<T>(storageKey);

        if (value === undefined) {
          try {
            const localStorageData = localStorage.getItem(storageKey);
            if (localStorageData) {
              value = JSON.parse(localStorageData) as T;
              await setInDB(storageKey, value);
              localStorage.removeItem(storageKey);
            } else {
              value = defaultValue;
              await setInDB(storageKey, value);
            }
          } catch (e) {
            console.error("Failed to process localStorage data:", e);
            value = defaultValue;
            await setInDB(storageKey, value);
          }
        }

        // Migration for notes without createdAt
        if (storageKey === "typehere-database" && Array.isArray(value)) {
          const migratedNotes = (value as Note[]).map((note) => {
            if (!note.createdAt) {
              return {
                ...note,
                createdAt: note.updatedAt || new Date().toISOString(),
              };
            }
            return note;
          });
          value = migratedNotes as T;
        }

        // Migration for deleted notes backup
        if (storageKey === "typehere-deletedNotes" && Array.isArray(value)) {
          const migratedNotes = (value as Note[]).map((note) => {
            if (!note.createdAt) {
              return {
                ...note,
                createdAt: note.updatedAt || new Date().toISOString(),
              };
            }
            return note;
          });
          value = migratedNotes as T;
        }

        if (isMounted) {
          setData(value);
        }
      } catch (e) {
        console.error("Failed to load data:", e);
        if (isMounted) {
          setData(defaultValue);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [storageKey]);

  // Debounced save function
  const debouncedSave = useMemo(
    () =>
      debounce(async (value: T) => {
        try {
          await setInDB(storageKey, value);
        } catch (e) {
          console.error("Failed to save data:", e);
        }
      }, 200),
    [storageKey]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  // Modified setter function
  const setPersistedData = useCallback(
    (newData: T) => {
      setData(newData);
      debouncedSave(newData);
    },
    [debouncedSave]
  );

  // Return loading state if data hasn't been loaded yet
  if (isLoading) {
    return [defaultValue, setPersistedData] as const;
  }

  return [data ?? defaultValue, setPersistedData] as const;
}

const searchAllNotesKeys = ["@", ">"];

const getRandomId = () => Math.random().toString(36).substring(2);

type Note = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  isHidden: boolean;
  workspace?: string;
};

type CmdKSuggestion =
  | {
    type: "note";
    note: Note;
  }
  | {
    type: "action";
    title: string;
    content: string;
    color?: string;
    // return true to close the cmd-k menu
    onAction: () => boolean;
  };

const cmdKSuggestionActionType = "action" as const;

const freshDatabase = [
  {
    id: getRandomId(),
    content: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPinned: false,
    isHidden: false,
  },
];

async function backupDataToSafeLocation(data: Note[]): Promise<void> {
  if (!("indexedDB" in window)) {
    console.error("This browser doesn't support IndexedDB");
    return;
  }

  const CHUNK_SIZE = 100; // Process notes in chunks of 100
  const dbRequest = indexedDB.open("BackupDatabase", 1);

  dbRequest.onupgradeneeded = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    if (db.objectStoreNames.contains("backups")) {
      db.deleteObjectStore("backups");
    }
    const store = db.createObjectStore("backups", { keyPath: "date" });
    store.createIndex("dateIndex", "date", { unique: false });
  };

  return new Promise((resolve, reject) => {
    dbRequest.onerror = () => {
      console.error("Error opening IndexedDB for backup", dbRequest.error);
      reject(dbRequest.error);
    };

    dbRequest.onsuccess = async () => {
      const db = dbRequest.result;
      try {
        // Process cleanup in a separate transaction
        const cleanupTx = db.transaction("backups", "readwrite");
        const store = cleanupTx.objectStore("backups");

        await new Promise<void>((resolve, reject) => {
          const request = store.getAllKeys();
          request.onsuccess = () => {
            const keys = request.result as string[];
            if (keys.length >= 5) {
              // Sort keys by date and keep only the latest 4
              keys
                .sort()
                .slice(0, -4)
                .forEach((key) => {
                  store.delete(key);
                });
            }
            resolve();
          };
          request.onerror = () => reject(request.error);
        });

        // Process backup in chunks
        const chunks = [];
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          chunks.push(data.slice(i, i + CHUNK_SIZE));
        }

        const backupEntry: { date: string; data: Note[] } = {
          date: new Date().toISOString(),
          data: [],
        };

        // Process each chunk
        for (const chunk of chunks) {
          const processedChunk = chunk.map((note) => ({
            ...note,
            content: note.content.slice(0, 10000), // Limit content size
          })) as Note[];
          backupEntry.data.push(...processedChunk);
        }

        // Save the processed data
        const tx = db.transaction("backups", "readwrite");
        const backupStore = tx.objectStore("backups");

        await new Promise<void>((resolve, reject) => {
          const request = backupStore.put(backupEntry);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => resolve();
        });
      } catch (error) {
        console.error("Error during backup:", error);
        reject(error);
      } finally {
        db.close();
      }
      resolve();
    };
  });
}

// Currently unused - disabled to prevent memory issues
// Can be re-enabled if memory performance is improved
// @ts-expect-error - Kept for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function usePeriodicBackup(data: Note[], interval: number = 24 * 60 * 60 * 1000): void {
  useEffect(() => {
    let isBackupInProgress = false;
    let isMounted = true;
    let timeoutId: number | undefined;

    const performBackup = async () => {
      if (isBackupInProgress || !isMounted) return;
      isBackupInProgress = true;

      try {
        const lastBackupDateStr = localStorage.getItem("lastBackupDate");
        const lastBackupDate = lastBackupDateStr ? new Date(lastBackupDateStr) : new Date(0);
        const now = new Date();

        if (now.getTime() - lastBackupDate.getTime() > interval) {
          await backupDataToSafeLocation(data);
          if (isMounted) {
            localStorage.setItem("lastBackupDate", new Date().toISOString());
          }
        }
      } catch (error) {
        console.error("Backup failed:", error);
      } finally {
        isBackupInProgress = false;
      }
    };

    const scheduleNextBackup = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(async () => {
        await performBackup();
        if (isMounted) scheduleNextBackup();
      }, interval);
    };

    performBackup();
    scheduleNextBackup();

    return () => {
      isMounted = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [data, interval]);
}

const themeId = "typehere-theme";
if (localStorage.getItem(themeId) === '"dark"') {
  document.documentElement.setAttribute("data-theme", "dark");
}

const sortNotes = (notes: Note[]) => {
  if (!notes || notes.length === 0) return [];
  return notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

// Helper function to check current schema version - now uses direct IndexedDB access
async function getCurrentSchema(): Promise<DBSchema | undefined> {
  return new Promise<DBSchema | undefined>((resolve) => {
    const request = indexedDB.open(DB_NAME);

    request.onerror = () => {
      console.error("Failed to open DB for schema check:", request.error);
      resolve(undefined);
    };

    request.onsuccess = () => {
      const db = request.result;
      try {
        // Check if the object store exists first
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          console.warn(`Object store ${STORE_NAME} does not exist`);
          db.close();
          resolve(undefined);
          return;
        }

        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const schemaRequest = store.get("db_schema");

        schemaRequest.onerror = () => {
          console.error("Failed to get schema:", schemaRequest.error);
          db.close();
          resolve(undefined);
        };

        schemaRequest.onsuccess = () => {
          db.close();
          resolve(schemaRequest.result);
        };
      } catch (error) {
        console.error("Error accessing schema:", error);
        db.close();
        resolve(undefined);
      }
    };
  });
}

// Add a function to check and log schema version - useful for debugging
async function checkSchemaVersion() {
  const schema = await getCurrentSchema();
  console.log("Current schema version:", schema?.version || "not set");
  return schema;
}

// Initialize and check database health at startup
async function initializeDatabase() {
  try {
    // First check if we can access the schema
    const schema = await checkSchemaVersion();
    if (!schema) {
      console.warn("No schema found or database corrupted, reinitializing...");
      closeAllConnections();
      await new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => {
          console.error("Failed to delete database:", deleteRequest.error);
          resolve(); // Continue anyway
        };
      });
    }
    // Initialize the database
    await initDB();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}

// Call it when the app starts
initializeDatabase().catch(console.error);

const getCurrentTime = () => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear().toString().slice(-2);
  const dayAbbr = now.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const hour = now.getHours();
  const minute = now.getMinutes().toString().padStart(2, "0");
  const period = hour >= 12 ? "p" : "a";
  const hour12 = hour % 12 || 12;
  const fixedDayAbbr = dayAbbr === "thu" ? "thur" : dayAbbr;
  return `${month}/${day}/${year} ${fixedDayAbbr} ${hour12}:${minute}${period}`;
};

const getCurrentDate = () => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear().toString().slice(-2);
  const dayAbbr = now.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const fixedDayAbbr = dayAbbr === "thu" ? "thur" : dayAbbr;
  return `${month}/${day}/${year} ${fixedDayAbbr}`;
};

const snippets: Snippet[] = [
  {
    name: "time",
    description: "Insert current date and time",
    getValue: getCurrentTime,
  },
  {
    name: "now",
    description: "Insert current date and time",
    getValue: getCurrentTime,
  },
  {
    name: "date",
    description: "Insert current date",
    getValue: getCurrentDate,
  },
];

const formatDateCompact = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const hour = date.getHours();
    const minute = date.getMinutes().toString().padStart(2, "0");
    const period = hour >= 12 ? "p" : "a";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minute}${period}`;
  } else if (diffDays === 1) {
    return "yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    const month = date.toLocaleString("default", { month: "short" }).toLowerCase();
    const day = date.getDate();
    return `${month}${day}`;
  }
};

function App() {
  const textareaDomRef = useRef<HTMLTextAreaElement>(null);
  const cmdKInputDomRef = useRef<HTMLInputElement>(null);

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [fsInitialized, setFsInitialized] = useState(false);

  const [database, setDatabase] = usePersistentState<Note[]>("typehere-database", freshDatabase);

  // Auto backup disabled to prevent memory issues
  // usePeriodicBackup(database);

  const [currentWorkspace, setCurrentWorkspace] = usePersistentState<string | null>(
    "typehere-currentWorkspace",
    null
  );
  const [currentNoteId, setCurrentNoteId] = usePersistentState<string>(
    "typehere-currentNoteId",
    freshDatabase[0].id
  );
  const [shouldShowScrollbar, setShouldShowScrollbar] = usePersistentState<boolean>(
    "typehere-shouldShowScrollbar",
    false
  );
  const [moreMenuPosition, setMoreMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [isAltKeyDown, setIsAltKeyDown] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [lastAceCursorPosition, setLastAceCursorPosition] = useState({
    row: 0,
    column: 0,
  });

  const workspaceNotes = useMemo(() => {
    return currentWorkspace === null
      ? sortNotes(database ?? [])
      : sortNotes((database ?? []).filter((n) => n.workspace === currentWorkspace || n.isPinned));
  }, [database, currentWorkspace]);

  const availableWorkspaces = useMemo(() => {
    const seenWorkspaces = new Set<string>();
    const allWorkspaces: string[] = [];
    const shallowDatabase = sortNotes([...(database ?? [])]);

    for (const note of shallowDatabase) {
      if (!note.workspace || seenWorkspaces.has(note.workspace)) {
        continue;
      }

      allWorkspaces.push(note.workspace);
      seenWorkspaces.add(note.workspace);
    }

    return allWorkspaces;
  }, [database]);

  const navigableWorkspaces = useMemo(() => {
    return [null, ...availableWorkspaces];
  }, [availableWorkspaces]);

  useEffect(() => {
    const currentNote = workspaceNotes.find((note) => note.id === currentNoteId);
    if (currentNote) {
      setTextValue(currentNote.content);
    } else if (workspaceNotes.length > 0) {
      setCurrentNoteId(workspaceNotes[0].id);
      setTextValue(workspaceNotes[0].content);
    }
  }, [workspaceNotes, currentNoteId]);

  const focus = () => {
    if (aceEditorRef.current) {
      const editor = aceEditorRef.current.editor;
      if (editor.isFocused()) return;
      editor.moveCursorTo(lastAceCursorPosition.row, lastAceCursorPosition.column);
      editor.focus();
    } else {
      textareaDomRef.current?.focus();
    }
  };

  const deleteNote = (noteId: string) => {
    const deletedNote = database?.find((note) => note.id === noteId);
    if (!deletedNote || !database) return;
    setFreshlyDeletedNotes((prev) => [...prev, deletedNote]);
    setDeletedNotesBackup([...deletedNotesBackup, deletedNote].slice(-10));
    const updatedDatabase = database.filter((note) => note.id !== noteId);
    setDatabase(updatedDatabase);
    if (currentNoteId === noteId) {
      setCurrentNoteId(updatedDatabase[0]?.id || "");
      setTextValue(updatedDatabase[0]?.content || "");
    }
  };

  const [historyStack, setHistoryStack] = useState<string[]>([currentNoteId ?? ""]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  const openNote = (
    noteId: string,
    shouldFocus: boolean = true,
    shouldUpdateHistory: boolean = true
  ) => {
    if (!noteId || !database?.find((n) => n.id === noteId)) {
      return;
    }

    setLastAceCursorPosition({ row: 0, column: 0 });
    setCurrentNoteId(noteId);

    const n = database?.find((n) => n.id === noteId);
    if (n) {
      n.updatedAt = new Date().toISOString();
    }

    if (n && !n.isPinned && n.workspace !== currentWorkspace) {
      setCurrentWorkspace(n.workspace ?? null);
    }

    setDatabase(database ?? []);

    if (shouldFocus) {
      setTimeout(() => {
        focus();

        if (aceEditorRef.current) {
          const editor = aceEditorRef.current.editor;
          editor.getSession().getUndoManager().reset();
          editor.clearSelection();
          editor.moveCursorTo(0, 0);
        }
      }, 10);
    }

    if (shouldUpdateHistory) {
      if (historyStack[historyIndex] !== noteId) {
        // Discard forward history if any
        const newHistoryStack = historyStack.slice(0, historyIndex + 1);
        newHistoryStack.push(noteId);
        setHistoryStack(newHistoryStack);
        setHistoryIndex(newHistoryStack.length - 1);
      }
    }
  };

  const openNewNote = (
    defaultContent: string = "",
    defaultWorkspace: string = "",
    shouldFocus = true
  ) => {
    const newNote: Note = {
      id: getRandomId(),
      content: defaultContent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspace: (defaultWorkspace || currentWorkspace) ?? undefined,
      isPinned: false,
      isHidden: false,
    };

    setDatabase([...database, newNote]);
    setCurrentNoteId(newNote.id);
    setTextValue("");
    openNote(newNote.id, shouldFocus);

    return newNote;
  };

  const fileInputDomRef = useRef<HTMLInputElement>(null);

  const [currentTheme, setCurrentTheme] = usePersistentState<"light" | "dark">(themeId, "light");
  const [selectedCmdKSuggestionIndex, setSelectedCmdKSuggestionIndex] = useState<number>(0);
  const [cmdKSearchQuery, setCmdKSearchQuery] = useState("");
  const [isCmdKMenuOpen, setIsCmdKMenuOpen] = useState(false);
  const [hasVimNavigated, setHasVimNavigated] = useState(false);
  const [isUsingVim, setIsUsingVim] = usePersistentState<boolean>("typehere-vim", false);
  const [isNarrowScreen, setIsNarrowScreen] = usePersistentState<boolean>("typehere-narrow", false);
  const [isIndentedWrap, setIsIndentedWrap] = usePersistentState<boolean>(
    "typehere-indentedWrap",
    false
  );
  const [freshlyDeletedNotes, setFreshlyDeletedNotes] = useState<Note[]>([]);
  const [deletedNotesBackup, setDeletedNotesBackup] = usePersistentState<Note[]>(
    "typehere-deletedNotes",
    []
  );
  const [shouldShowHiddenNotes, setShouldShowHiddenNotes] = useState(false);

  // Auto backup disabled to prevent memory issues
  // usePeriodicBackup(deletedNotesBackup);

  const toggleTheme = () => {
    const newTheme = currentTheme === "light" ? "dark" : "light";
    saveTheme(newTheme);
  };

  const saveTheme = (theme: "light" | "dark") => {
    setCurrentTheme(theme);
    document.documentElement.setAttribute("data-theme", theme);
  };

  useEffect(() => {
    if (currentTheme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, [currentTheme]);

  const moveNoteToWorkspace = (note: Note, workspace?: string) => {
    note.workspace = workspace;
    setDatabase(database ?? []);
    setCurrentWorkspace(workspace ?? null);
    setSelectedCmdKSuggestionIndex(0);
    openNote(note.id, false);
  };

  const runCmdKSuggestion = (suggestion?: CmdKSuggestion): boolean => {
    if (!suggestion) return true;
    if (suggestion.type === "note") {
      openNote(suggestion.note.id);
      return true;
    } else if (suggestion.type === "action") {
      return suggestion.onAction();
    }
    return false;
  };

  const getNextWorkspace = (direction: "left" | "right") => {
    const currentIndex = navigableWorkspaces.indexOf(currentWorkspace ?? null);
    if (currentIndex === -1) {
      console.warn("wtf?"); // not supposed to happen
    } else {
      if (direction === "left") {
        return navigableWorkspaces[
          (currentIndex - 1 + navigableWorkspaces.length) % navigableWorkspaces.length
        ];
      } else {
        return navigableWorkspaces[(currentIndex + 1) % navigableWorkspaces.length];
      }
    }
  };

  const openWorkspace = (workspace: string | null) => {
    setSelectedCmdKSuggestionIndex(0);
    setCurrentWorkspace(workspace ?? null);
    setCurrentNoteId(""); // hack to force a re-render
  };

  const getNoteTitle = (note: Note) => {
    const firstLineBreakIndex = note.content.trim().indexOf("\n");
    const title = note.content.substring(
      0,
      firstLineBreakIndex === -1 ? undefined : firstLineBreakIndex + 1
    );
    return title;
  };

  const saveNote = (noteId: string, newText: string) => {
    let processedText = newText;
    if (aceEditorRef.current) {
      const editor = aceEditorRef.current.editor;
      textsToReplace.forEach(([from, to]) => {
        if (from instanceof RegExp) {
          editor.replaceAll(to, {
            needle: from,
            regExp: true,
          });
        } else {
          editor.replaceAll(to, {
            needle: from,
            regExp: false,
          });
        }
      });
      processedText = editor.getValue();
    } else {
      textsToReplace.forEach(([from, to]) => {
        if (from instanceof RegExp) {
          processedText = processedText.replace(from, to);
        } else {
          processedText = processedText.split(from).join(to);
        }
      });
    }

    if (!database) return;

    const noteIndex = database.findIndex((n) => n.id === noteId);
    if (noteIndex !== -1) {
      const updatedNote = {
        ...database[noteIndex],
        content: processedText,
        updatedAt: new Date().toISOString(),
      };
      const newDatabase = [...database];
      newDatabase.splice(noteIndex, 1, updatedNote);
      setDatabase(newDatabase);
    }
  };

  const pinNote = (note: Note, isPinned: boolean = true) => {
    note.isPinned = isPinned;
    setDatabase(sortNotes([...database.filter((n) => n.id !== note.id), note]));
  };

  const setIsNoteHidden = (note: Note, isHidden: boolean) => {
    note.isHidden = isHidden;
    setDatabase(sortNotes([...database.filter((n) => n.id !== note.id), note]));
  };
  const getAllSuggestions = useCallback(
    (shouldSearchAllNotes = false): CmdKSuggestion[] => {
      const processedCmdKSearchQuery =
        shouldSearchAllNotes && searchAllNotesKeys.some((key) => cmdKSearchQuery.startsWith(key))
          ? cmdKSearchQuery.substring(1)
          : cmdKSearchQuery;
      const relevantNotes = shouldSearchAllNotes ? database : workspaceNotes;
      const notesToSearch = relevantNotes
        .filter((note) => shouldShowHiddenNotes || !note.isHidden || note.id === currentNoteId)
        .map((note) => {
          const firstLineBreakIndex = note.content.trim().indexOf("\n");
          return {
            ...note,
            firstLineWithWorkspace:
              firstLineBreakIndex !== -1
                ? note.content.slice(0, firstLineBreakIndex) +
                (note.workspace ? ` (${note.workspace})` : "")
                : note.content + (note.workspace ? ` ${note.workspace}` : ""),
          };
        });
      const hiddenNotesMatchLength = 5;
      // we're matching the entire database for easier access.
      const matchingHiddenNotes = database
        .filter((note) => {
          if (shouldShowHiddenNotes) {
            return false;
          }
          const noteTitleLower = getNoteTitle(note).toLowerCase();
          const queryLower = processedCmdKSearchQuery.toLowerCase();
          return (
            note.isHidden &&
            note.id !== currentNoteId &&
            processedCmdKSearchQuery.length &&
            (processedCmdKSearchQuery.length >= hiddenNotesMatchLength
              ? noteTitleLower.startsWith(queryLower)
              : // if less than the limit, must be exact match
              noteTitleLower === queryLower)
          );
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      const notesFuse = new Fuse(notesToSearch, {
        keys: [
          { name: "content", weight: 1 },
          { name: "firstLineWithWorkspace", weight: 0.6 },
        ],
        includeScore: true,
        threshold: 0.2,
        useExtendedSearch: true,
      });
      const workspaceFuse = new Fuse(
        [
          ...availableWorkspaces.map((workspace) => ({
            label: workspace,
            value: workspace,
          })),
          {
            label: "all notes",
            value: null,
          },
        ],
        {
          keys: ["label"],
          includeScore: true,
          threshold: 0.05, // lower for workspace match
        }
      );
      const notes = processedCmdKSearchQuery
        ? notesFuse.search(processedCmdKSearchQuery.trim()).map((result) => result.item)
        : notesToSearch;

      if (notes.length <= 1 && !shouldSearchAllNotes) {
        return getAllSuggestions(true);
      }

      const workspaces = processedCmdKSearchQuery
        ? workspaceFuse.search(processedCmdKSearchQuery).map((result) => result.item)
        : [];
      const currentNote = database.find((note) => note.id === currentNoteId);

      const unlinkTitle = "unlink note";
      const shouldTrimQuery = processedCmdKSearchQuery.length > 20;
      const trimmedQuery = processedCmdKSearchQuery.slice(0, 20);
      const trimmedContent = shouldTrimQuery ? trimmedQuery + "..." : processedCmdKSearchQuery;

      const regularCommands: CmdKSuggestion[] = [
        {
          type: "action",
          title: "toggle light dark theme mode",
          content: "enter " + (currentTheme === "light" ? "dark" : "light") + " mode",
          color: "#B39DDB", // A soothing lavender
          onAction: () => {
            toggleTheme();
            setCmdKSearchQuery("");
            return false;
          },
        },
        {
          type: "action",
          title: "pin/unpin current note",
          content: currentNote?.isPinned ? "unpin from all workspaces" : "pin to all workspaces",
          color: "#FF9800", // Orange
          onAction: () => {
            if (!currentNote) return true;
            pinNote(currentNote, !currentNote.isPinned);
            setCmdKSearchQuery("");
            return false;
          },
        },
        {
          type: "action",
          title: "toggle vim mode",
          content: "turn " + (isUsingVim ? "off" : "on") + " vim mode",
          color: "#81D4FA", // A calming light blue
          onAction: () => {
            setIsUsingVim(!isUsingVim);
            return true;
          },
        },
        {
          type: "action",
          title: "toggle narrow screen mode",
          content: "enter " + (isNarrowScreen ? "wide" : "narrow") + " screen mode",
          color: "#AED581", // A gentle light green
          onAction: () => {
            setIsNarrowScreen(!isNarrowScreen);
            return true;
          },
        },
        {
          type: "action",
          title: "toggle indented wrap",
          content: "turn " + (isIndentedWrap ? "off" : "on") + " indented soft wrap",
          color: "#FFB74D",
          onAction: () => {
            setIsIndentedWrap(!isIndentedWrap);
            return true;
          },
        },
        {
          type: "action",
          title: "backup all notes",
          content: "to indexedDb",
          color: "#FFEB3B", // A soothing yellow
          onAction: () => {
            backupDataToSafeLocation(database);
            return true;
          },
        },
        {
          type: "action",
          title: "import notes",
          content: "import notes from chosen JSON file",
          color: "#FA7070", // A soothing pink
          onAction: () => {
            fileInputDomRef.current?.click();
            return true;
          },
        },
        {
          type: "action",
          title: "export notes",
          content: "export notes to chosen JSON file",
          color: "#FFF7F7", // A soothing white
          onAction: () => {
            exportDatabase();
            setCmdKSearchQuery("");
            return false;
          },
        },
        {
          type: "action",
          title: shouldShowScrollbar ? "hide scrollbar" : "show scrollbar",
          content: "toggle the scrollbar visibility",
          color: "#B2B2FF", // A soothing light blue
          onAction: () => {
            setShouldShowScrollbar(!shouldShowScrollbar);
            setCmdKSearchQuery("");
            return true;
          },
        },
      ];

      const regularCommandsFuse = new Fuse(regularCommands, {
        shouldSort: true,
        keys: ["title", "content"],
        includeScore: true,
        threshold: 0.4,
      });

      const regularCommandsResults = regularCommandsFuse.search(processedCmdKSearchQuery);

      const prioritizedActions: CmdKSuggestion[] = [
        ...(processedCmdKSearchQuery
          ? [
            ...(workspaces.length > 0
              ? [
                ...workspaces.slice(0, 3).map((workspace) => ({
                  type: cmdKSuggestionActionType,
                  title: `go to ${workspace.label}`,
                  content: `↓[${workspace.label}]`,
                  color: "#2196F3",
                  onAction() {
                    openWorkspace(workspace.value);
                    setCmdKSearchQuery("");
                    return false;
                  },
                })),
              ]
              : []),
          ]
          : []),
      ];

      const actions: CmdKSuggestion[] = [
        ...(processedCmdKSearchQuery
          ? [
            ...(regularCommandsResults.length > 0
              ? regularCommandsResults.map((result) => result.item)
              : []),

            {
              type: cmdKSuggestionActionType,
              title: "create new note",
              content: `"${trimmedContent}"`,
              color: "#4CAF50",
              onAction: () => {
                openNewNote(processedCmdKSearchQuery);
                setIsCmdKMenuOpen(false);
                setSelectedCmdKSuggestionIndex(0);
                setCmdKSearchQuery("");
                return true;
              },
            },
            ...(workspaces.length > 0
              ? [
                {
                  type: cmdKSuggestionActionType,
                  title: `move note to ${workspaces[0].label}`,
                  content: `→[${workspaces[0].label}]`,
                  color: "#00BCD4",
                  onAction() {
                    if (!currentNote) {
                      console.warn("weird weird weird");
                      return true;
                    }
                    moveNoteToWorkspace(currentNote, workspaces[0]?.value ?? undefined);
                    setCmdKSearchQuery("");
                    return false;
                  },
                },
              ]
              : []),

            ...(availableWorkspaces.find((workspace) => workspace === processedCmdKSearchQuery)
              ? currentWorkspace
                ? []
                : []
              : [
                {
                  type: cmdKSuggestionActionType,
                  title: "create workspace",
                  color: "#FF9800",
                  content: `+[${trimmedContent}]`,
                  onAction: () => {
                    openNewNote("", processedCmdKSearchQuery, false);
                    setSelectedCmdKSuggestionIndex(0);
                    setCurrentWorkspace(processedCmdKSearchQuery);
                    setCmdKSearchQuery("");
                    return false;
                  },
                },
              ]),
            ...(currentWorkspace
              ? [
                {
                  type: cmdKSuggestionActionType,
                  title: "rename workspace",
                  content: `±[${trimmedContent}]`,
                  color: "#9C27B0",
                  onAction: () => {
                    const newDatabase = [...database].map((n) => {
                      if (n.workspace !== currentWorkspace) {
                        return n;
                      }
                      return {
                        ...n,
                        workspace: processedCmdKSearchQuery,
                      };
                    });
                    setCurrentWorkspace(processedCmdKSearchQuery);
                    setSelectedCmdKSuggestionIndex(0);
                    setDatabase(newDatabase);
                    setCmdKSearchQuery("");
                    return false;
                  },
                },
              ]
              : []),
          ]
          : []),
        ...(currentNote?.workspace &&
          processedCmdKSearchQuery &&
          unlinkTitle.includes(processedCmdKSearchQuery)
          ? [
            {
              type: cmdKSuggestionActionType,
              title: unlinkTitle,
              content: `-[${currentNote.workspace}]`,
              color: "#F44336",
              onAction() {
                currentNote.workspace = undefined;
                setDatabase(sortNotes(database));
                setCurrentWorkspace(null);
                return false;
              },
            },
          ]
          : []),
      ];

      sortNotes(notes);

      if (shouldSearchAllNotes) {
        notes.sort((a, b) => {
          const aInCurrentWorkspace = a.workspace === currentWorkspace ? 1 : 0;
          const bInCurrentWorkspace = b.workspace === currentWorkspace ? 1 : 0;
          return bInCurrentWorkspace - aInCurrentWorkspace;
        });
      }

      return [
        ...matchingHiddenNotes.map((note) => ({
          type: "note" as const,
          note,
        })),
        ...prioritizedActions,
        ...notes.map((note) => ({
          type: "note" as const,
          note,
        })),
        ...actions,
      ];
    },
    [database, cmdKSearchQuery, workspaceNotes, currentNoteId]
  );

  const cmdKSuggestions = useMemo<CmdKSuggestion[]>(() => {
    const shouldSearchAllNotes = searchAllNotesKeys.some((key) => cmdKSearchQuery.startsWith(key));
    return getAllSuggestions(shouldSearchAllNotes);
  }, [cmdKSearchQuery, getAllSuggestions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent escape from minimizing the window
      if (e.code === "Escape") {
        e.preventDefault();
      }

      // NO PRINT
      if (e.code === "KeyP" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
      }

      if (isCmdKMenuOpen && e.code === "Escape") {
        e.preventDefault();
        setIsCmdKMenuOpen(false);
        focus();
        return;
      }

      if (e.code === "KeyE" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsNarrowScreen(!isNarrowScreen);
        return;
      }

      const currentSuggestion = cmdKSuggestions[selectedCmdKSuggestionIndex];
      const currentSelectedNote = currentSuggestion.type === "note" ? currentSuggestion.note : null;

      const vimUp = (e.ctrlKey || e.metaKey) && e.code === "KeyK";
      const vimDown = (e.ctrlKey || e.metaKey) && e.code === "KeyJ";
      const vimLeft = (e.ctrlKey || e.metaKey) && e.code === "KeyU";
      const vimRight = (e.ctrlKey || e.metaKey) && e.code === "KeyI";

      if (isCmdKMenuOpen && (vimUp || vimDown || vimLeft || vimRight)) {
        setHasVimNavigated(true);
      }

      if (isCmdKMenuOpen) {
        const topXDigits = new Array(digitCount).fill(0).map((_, i) => `Digit${i + 1}`);
        const topXDigitsSet = new Set(topXDigits);

        if (e.altKey) {
          setIsAltKeyDown(true);
        }

        if (e.altKey && topXDigitsSet.has(e.code)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const index = topXDigits.findIndex((key) => key === e.code);
          const suggestion = cmdKSuggestions[index];
          const shouldCloseCmdK = runCmdKSuggestion(suggestion);
          if (shouldCloseCmdK) {
            setIsCmdKMenuOpen(false);
            setSelectedCmdKSuggestionIndex(0);
          }
          return;
        }

        if (freshlyDeletedNotes.length > 0 && e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
          const topOfStack = freshlyDeletedNotes.pop();
          if (topOfStack) {
            e.stopImmediatePropagation();
            e.preventDefault();
            setDatabase(sortNotes([...database, topOfStack]));
          }
          return;
        }

        let nextIndex: number | null = null;
        const length = cmdKSuggestions.length;
        if (e.code === "ArrowUp" || vimUp) {
          e.preventDefault();
          if (selectedCmdKSuggestionIndex === null) {
            nextIndex = length - 1;
          } else {
            nextIndex = (selectedCmdKSuggestionIndex - 1 + length) % length;
          }
          setSelectedCmdKSuggestionIndex(nextIndex);
        } else if (e.code === "ArrowDown" || vimDown) {
          e.preventDefault();
          if (selectedCmdKSuggestionIndex === null) {
            nextIndex = 0;
          } else {
            nextIndex = (selectedCmdKSuggestionIndex + 1) % length;
          }
          setSelectedCmdKSuggestionIndex(nextIndex);
        }

        if (nextIndex !== null) {
          const elementId = `note-list-cmdk-item-${nextIndex}`;
          const element = document.getElementById(elementId);
          if (element) {
            element.scrollIntoView({ block: "center" });
          }
          return;
        }

        if (e.code === "Enter" || (e.code === "KeyB" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          const suggestion = cmdKSuggestions[selectedCmdKSuggestionIndex];
          const shouldCloseCmdK = runCmdKSuggestion(suggestion);
          if (shouldCloseCmdK) {
            setIsCmdKMenuOpen(false);
            setSelectedCmdKSuggestionIndex(0);
          }
          return;
        }

        const direction =
          vimLeft || (e.code === "ArrowLeft" && !e.metaKey && !e.ctrlKey)
            ? "left"
            : vimRight || (e.code === "ArrowRight" && !e.metaKey && !e.ctrlKey)
              ? "right"
              : null;
        const isArrowKeys =
          !e.metaKey && !e.ctrlKey && (e.code === "ArrowLeft" || e.code === "ArrowRight");
        if (direction && (isArrowKeys ? cmdKSearchQuery.length === 0 : true)) {
          e.preventDefault();
          const nextWorkspace = getNextWorkspace(direction);
          if (nextWorkspace !== currentWorkspace) {
            openWorkspace(nextWorkspace ?? null);
          }
        }

        if (currentSelectedNote) {
          if ((e.code === "KeyH" || e.code === "KeyG") && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pinNote(currentSelectedNote, !currentSelectedNote.isPinned);
            openNote(currentSelectedNote.id, false);
            setSelectedCmdKSuggestionIndex(0);
            return;
          }

          if ((e.ctrlKey || e.metaKey) && e.code === "Quote" && !currentSelectedNote.isPinned) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const shouldAllowShowAll = false;
            if (e.shiftKey && shouldAllowShowAll) {
              setShouldShowHiddenNotes(!shouldShowHiddenNotes);
              return;
            }

            setIsNoteHidden(currentSelectedNote, !currentSelectedNote.isHidden);
            return;
          }

          if (e.code === "ArrowLeft" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const nextWorkspace = getNextWorkspace("left");
            if (nextWorkspace !== currentWorkspace) {
              moveNoteToWorkspace(currentSelectedNote, nextWorkspace ?? undefined);
              setSelectedCmdKSuggestionIndex(0);
            }
            return;
          }

          if (e.code === "ArrowRight" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const nextWorkspace = getNextWorkspace("right");
            if (nextWorkspace !== currentWorkspace) {
              moveNoteToWorkspace(currentSelectedNote, nextWorkspace ?? undefined);
              setSelectedCmdKSuggestionIndex(0);
            }
            return;
          }
        }

        // otherwise, just focus on the cmdk search and let the user type
        cmdKInputDomRef.current?.focus();

        return;
      }

      if (isHelpMenuOpen && (e.code === "Escape" || e.code === "Enter")) {
        e.preventDefault();
        setIsHelpMenuOpen((prev) => !prev);
        focus();
        return;
      }

      if ((e.code === "KeyP" || e.code === "KeyK") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        textareaDomRef.current?.blur();
        setSelectedCmdKSuggestionIndex(0);
        setIsCmdKMenuOpen(true);
        setIsHelpMenuOpen(false);

        if (e.shiftKey) {
          setCmdKSearchQuery("@");
        } else {
          setCmdKSearchQuery("");
        }
        return;
      }

      if (e.code === "KeyF" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        textareaDomRef.current?.blur();
        setSelectedCmdKSuggestionIndex(0);
        setIsCmdKMenuOpen(true);
        setIsHelpMenuOpen(false);
        setCmdKSearchQuery("@");
        return;
      }

      if (
        e.code === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        textValue.trim().length !== 0 &&
        !e.isComposing
      ) {
        e.preventDefault();
        openNewNote();
        return;
      }

      if (e.code === "Enter") {
        focus();
      } else if (isUsingVim && !isCmdKMenuOpen) {
        if (document.activeElement === document.body) {
          aceEditorRef.current?.editor.focus();
        }
      }

      if (e.metaKey && e.code === "BracketLeft") {
        e.preventDefault();
        if (historyIndex > 0) {
          const prevIndex = historyIndex - 1;
          setHistoryIndex(prevIndex);
          openNote(historyStack[prevIndex], true, false);
        }
      } else if (e.metaKey && e.code === "BracketRight") {
        e.preventDefault();
        if (historyIndex < historyStack.length - 1) {
          const nextIndex = historyIndex + 1;
          setHistoryIndex(nextIndex);
          openNote(historyStack[nextIndex], true, false);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "AltLeft") {
        setIsAltKeyDown(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    database,
    database.length,
    hasVimNavigated,
    isCmdKMenuOpen,
    openNewNote,
    openNote,
    selectedCmdKSuggestionIndex,
    textValue,
    isNarrowScreen,
    isHelpMenuOpen,
    isUsingVim,
    focus,
    cmdKSuggestions,
    setIsNarrowScreen,
    currentWorkspace,
    navigableWorkspaces,
    runCmdKSuggestion,
    setCurrentWorkspace,
    workspaceNotes.length,
    freshlyDeletedNotes,
    deleteNote,
    setDatabase,
    getNextWorkspace,
    setCurrentNoteId,
    moveNoteToWorkspace,
    openWorkspace,
    pinNote,
    setIsNoteHidden,
    shouldShowHiddenNotes,
    historyIndex,
    historyStack,
  ]);

  useEffect(() => {
    if (textareaDomRef.current) {
      textareaDomRef.current.focus();
    }
  }, [currentNoteId]);

  const aceEditorRef = useRef<AceEditor>(null);

  useEffect(() => {
    if (aceEditorRef.current) {
      const editor = aceEditorRef.current.editor;
      editor.renderer.setScrollMargin(32, 32, 0, 0);
      editor.commands.removeCommand("findprevious");
      editor.commands.removeCommand("findnext");
      editor.commands.removeCommand("removetolineend");

      // Memory optimizations
      editor.setOption("enableBasicAutocompletion", false);
      editor.setOption("enableLiveAutocompletion", false);
      editor.setOption("enableSnippets", false);
      editor.getSession().setUseWorker(false); // Disable worker thread
      editor.renderer.setShowGutter(false);
      editor.renderer.setShowPrintMargin(false);
      editor.resize();

      const snippetCompleter = {
        getCompletions: (
          _editor: unknown,
          session: { getLine: (row: number) => string },
          pos: { row: number; column: number },
          _prefix: string,
          callback: (
            error: null,
            completions: { caption: string; snippet: string; meta: string; score: number }[]
          ) => void
        ) => {
          const line = session.getLine(pos.row);
          const beforeCursor = line.substring(0, pos.column);

          const searchTerm = beforeCursor.substring(1).toLowerCase();
          const completions = snippets
            .filter((snippet) => snippet.name.toLowerCase().startsWith(searchTerm))
            .map((snippet) => ({
              caption: snippet.name,
              snippet: snippet.getValue(),
              meta: snippet.description,
              score: 1000,
            }));

          callback(null, completions);
        },
      };

      editor.completers = [snippetCompleter];
      editor.setOptions({
        enableBasicAutocompletion: true,
        enableSnippets: true,
        enableLiveAutocompletion: true,
      });
    }
  }, []);

  useEffect(() => {
    if (!aceEditorRef.current) return;

    const editor = aceEditorRef.current.editor;
    if (isUsingVim) {
      editor.setKeyboardHandler("ace/keyboard/vim");
    } else {
      editor.setKeyboardHandler("ace/keyboard/keybinding");
    }
  }, [isUsingVim]);

  useEffect(() => {
    if (!aceEditorRef.current) return;

    const editor = aceEditorRef.current.editor;
    editor.getSession().setOption("indentedSoftWrap", isIndentedWrap);
  }, [isIndentedWrap]);

  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const cmdKey = isMac ? "⌘" : "ctrl";

  const exportDatabase = async () => {
    const compressedData = LZString.compressToEncodedURIComponent(JSON.stringify(database));
    const dataStr = "data:text/json;charset=utf-8," + compressedData;

    // Generate filename with current date in format: notes_export_MMDDYY
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const year = String(now.getFullYear()).slice(-2);
    const filename = `notes_export_${month}${day}${year}.json`;

    const downloadAnchorNode = document.createElement("a");
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", filename);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  useEffect(() => {
    const aceScroller = document.querySelector(".ace_scrollbar") as HTMLElement;
    if (aceScroller) {
      aceScroller.style.visibility = shouldShowScrollbar ? "visible" : "hidden";
      document.body.classList.toggle("show-scrollbar", shouldShowScrollbar);
    }
  }, [shouldShowScrollbar]);

  useEffect(() => {
    if (!isElectron()) return;

    const adjustTitleBarSize = () => {
      const zoomLevel = window.devicePixelRatio;
      const titleBar = document.querySelector(".custom-title-bar");
      if (titleBar) {
        (titleBar as HTMLElement).style.height = `${28 / zoomLevel}px`;
      }
    };

    window.addEventListener("resize", adjustTitleBarSize);
    adjustTitleBarSize(); // Initial adjustment

    return () => {
      window.removeEventListener("resize", adjustTitleBarSize);
    };
  }, []);

  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getCurrentTime());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  // Add cleanup for Ace editor and database connections
  useEffect(() => {
    return () => {
      // Cleanup Ace editor
      if (aceEditorRef.current) {
        const editor = aceEditorRef.current.editor;
        editor.destroy();
        editor.container.remove();
      }

      // Close all IndexedDB connections
      closeAllConnections();

      if (isElectron() && window.electronFS) {
        window.electronFS.stopWatching();
      }
    };
  }, []);

  useEffect(() => {
    if (!isElectron() || !window.electronFS) {
      return;
    }

    async function initializeFileSystem() {
      try {
        const { hasPasswordSet } = await window.electronFS!.init();

        if (!hasPasswordSet) {
          setIsSettingPassword(true);
          setIsPasswordModalOpen(true);
        } else {
          setIsSettingPassword(false);
          setIsPasswordModalOpen(true);
        }
      } catch (error) {
        console.error("Error initializing filesystem:", error);
      }
    }

    initializeFileSystem();
  }, []);

  useEffect(() => {
    if (!isElectron() || !window.electronFS || !encryptionKey || fsInitialized) {
      return;
    }

    const key = encryptionKey;

    async function syncFromFilesystem() {
      try {
        const { notes, metadata } = await window.electronFS!.readNotes(key);

        const notesList: Note[] = Object.entries(notes).map(([noteId, content]) => {
          const meta =
            (metadata as { notes?: Record<string, Partial<Note>> }).notes?.[noteId] || {};
          return {
            id: noteId,
            content,
            createdAt: meta.createdAt || new Date().toISOString(),
            updatedAt: meta.updatedAt || new Date().toISOString(),
            isPinned: meta.isPinned || false,
            isHidden: meta.isHidden || false,
            workspace: meta.workspace,
          };
        });

        if (notesList.length > 0) {
          setDatabase(sortNotes(notesList));
        } else {
          await syncToFilesystem();
        }

        await window.electronFS!.startWatching();
        setFsInitialized(true);

        window.electronFS!.onFileChanged(async () => {
          if (aceEditorRef.current?.editor.isFocused()) {
            return;
          }

          const { notes: updatedNotes, metadata: updatedMetadata } =
            await window.electronFS!.readNotes(key);

          const updatedNotesList: Note[] = Object.entries(updatedNotes).map(([noteId, content]) => {
            const meta =
              (updatedMetadata as { notes?: Record<string, Partial<Note>> }).notes?.[noteId] || {};
            return {
              id: noteId,
              content,
              createdAt: meta.createdAt || new Date().toISOString(),
              updatedAt: meta.updatedAt || new Date().toISOString(),
              isPinned: meta.isPinned || false,
              isHidden: meta.isHidden || false,
              workspace: meta.workspace,
            };
          });

          setDatabase(sortNotes(updatedNotesList));
        });
      } catch (error) {
        console.error("Error syncing from filesystem:", error);
      }
    }

    syncFromFilesystem();
  }, [encryptionKey, fsInitialized]);

  const lastSyncedDatabase = useRef<Note[]>([]);
  const isSyncing = useRef(false);

  const syncToFilesystem = useCallback(async () => {
    if (!isElectron() || !window.electronFS || !encryptionKey || isSyncing.current) {
      return;
    }

    isSyncing.current = true;

    try {
      const metadata = {
        notes: database.reduce(
          (acc, note) => {
            acc[note.id] = {
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              isPinned: note.isPinned,
              isHidden: note.isHidden,
              workspace: note.workspace,
            };
            return acc;
          },
          {} as Record<string, Partial<Note>>
        ),
      };

      await window.electronFS.writeMetadata(metadata, encryptionKey);

      const changedNotes = database.filter((note) => {
        const lastNote = lastSyncedDatabase.current.find((n) => n.id === note.id);
        return (
          !lastNote || lastNote.content !== note.content || lastNote.updatedAt !== note.updatedAt
        );
      });

      for (const note of changedNotes) {
        await window.electronFS.writeNote(note.id, note.content, encryptionKey);
      }

      lastSyncedDatabase.current = JSON.parse(JSON.stringify(database));
    } catch (error) {
      console.error("Error syncing to filesystem:", error);
    } finally {
      isSyncing.current = false;
    }
  }, [database, encryptionKey]);

  useEffect(() => {
    if (!isElectron() || !window.electronFS || !encryptionKey || !fsInitialized) {
      return;
    }

    const timeoutId = setTimeout(() => {
      syncToFilesystem();
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [database, encryptionKey, fsInitialized, syncToFilesystem]);

  useEffect(() => {
    document.fonts.ready.then(() => {
      if (aceEditorRef.current) {
        aceEditorRef.current.editor.renderer.updateFull();
      }
    });
  }, []);

  const handlePasswordSubmit = async () => {
    if (!window.electronFS || !passwordInput) {
      return;
    }

    try {
      const { salt } = await window.electronFS.init();
      const key = deriveKey(passwordInput, salt);

      if (isSettingPassword) {
        await window.electronFS.setPassword(passwordInput);
        setEncryptionKey(key);
        setIsPasswordModalOpen(false);
        setPasswordInput("");
      } else {
        const isValid = await window.electronFS.verifyPassword(passwordInput);
        if (isValid) {
          setEncryptionKey(key);
          setIsPasswordModalOpen(false);
          setPasswordInput("");
        } else {
          alert("Incorrect password. Please try again.");
        }
      }
    } catch (error) {
      console.error("Error handling password:", error);
    }
  };

  return (
    <main
      style={{
        ...(isNarrowScreen
          ? {
            maxWidth: "calc(800px + 64px)",
            margin: "0 auto",
          }
          : {}),
      }}
    >
      {isElectron() && (
        <div className="custom-title-bar">
          <div className="traffic-light-placeholder"></div>
          <div className="drag-region"></div>
        </div>
      )}
      <div
        style={{
          width: "100%",
          height: isElectron() ? "calc(100vh - 28px)" : "100vh", // Adjust height based on whether it's Electron
          padding: isNarrowScreen ? "0px" : "0 36px",
          ...(shouldShowScrollbar ? { paddingRight: "0px" } : {}),
        }}
      >
        <AceEditor
          theme={currentTheme === "dark" ? "clouds_midnight" : "clouds"}
          ref={aceEditorRef}
          value={textValue}
          onChange={(newText: string) => {
            setTextValue(newText);
            saveNote(currentNoteId, newText);
          }}
          setOptions={{
            showLineNumbers: false,
            showGutter: false,
            wrap: true,
            highlightActiveLine: false,
            showPrintMargin: false,
            fontFamily: "'Berkeley Mono', 'JetBrains Mono', monospace",
          }}
          fontSize="1rem"
          onCursorChange={(e) => {
            setLastAceCursorPosition({
              row: e.cursor.row,
              column: e.cursor.column,
            });
          }}
          tabSize={4}
          keyboardHandler="vim"
          width="100%"
          height="100%"
          className="editor"
          onLoad={() => {
            const aceScroller = document.querySelector(".ace_scrollbar") as HTMLElement;
            if (aceScroller) {
              aceScroller.style.visibility = shouldShowScrollbar ? "visible" : "hidden";
            }
          }}
          style={{
            lineHeight: "1.5",
            background: "var(--note-background-color)",
            color: "var(--dark-color)",
          }}
          placeholder="Type here..."
        />
      </div>
      <div id="controls">
        <div
          style={{
            color: "var(--dark-color)",
            opacity: 0.5,
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {currentWorkspace && <span>[{currentWorkspace}]</span>}
          <span>[{currentTime}]</span>
        </div>
        {isHelpMenuOpen &&
          createPortal(
            <>
              <div
                style={{
                  width: "100vw",
                  height: "100vh",
                  position: "fixed",
                  background: "var(--overlay-background-color)",
                  top: 0,
                  left: 0,
                  zIndex: 10,
                }}
                onClick={() => {
                  setIsHelpMenuOpen(false);
                }}
              />
              <div className="help-menu">
                <h3>Keyboard Shortcuts</h3>
                <div className="help-menu-shortcuts">
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>k/p</kbd>
                    </div>
                    <span>Open notes search</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>⇧</kbd>
                      <kbd>f</kbd>
                    </div>
                    <span>Search all notes</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>⇧</kbd>
                      <kbd>⏎</kbd>
                    </div>
                    <span>Create empty note</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>j/k</kbd>
                    </div>
                    or
                    <div className="help-menu-shortcuts-keys">
                      <kbd>↑/↓</kbd>
                    </div>
                    <span>Navigation</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>e</kbd>
                    </div>
                    <span>Toggle narrow screen</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>←/→</kbd>
                    </div>
                    <span>Switch workspaces</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>←/→</kbd>
                    </div>
                    <span>Move note between workspaces</span>
                  </div>
                  <div className="help-menu-shortcuts-item">
                    <div className="help-menu-shortcuts-keys">
                      <kbd>{cmdKey}</kbd>
                      <kbd>h</kbd>
                    </div>
                    <span>Pin note to all workspaces</span>
                  </div>
                </div>
                <button onClick={() => setIsHelpMenuOpen(false)}>close</button>
              </div>
            </>,
            document.body
          )}
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMoreMenuPosition({
              x: window.innerWidth - (rect.x + rect.width),
              y: rect.y + rect.height + 4,
            });
          }}
          aria-label="More"
          title="More"
        >
          <FiMoreHorizontal size={14} />
        </button>
        {moreMenuPosition && (
          <>
            <div
              style={{
                width: "100vw",
                height: "100vh",
                position: "fixed",
                top: 0,
                left: 0,
              }}
              onClick={() => {
                setMoreMenuPosition(null);
              }}
            />
            <div
              style={{
                position: "fixed",
                right: moreMenuPosition.x,
                top: moreMenuPosition.y,
                zIndex: 100,
              }}
              className="more-menu"
            >
              <button
                onClick={() => {
                  setMoreMenuPosition(null);
                  setIsUsingVim(!isUsingVim);
                }}
              >
                {isUsingVim ? "no vim" : "vim"}
              </button>
              <button
                onClick={() => {
                  setMoreMenuPosition(null);
                  toggleTheme();
                }}
              >
                {currentTheme === "light" ? "dark" : "light"}
              </button>
              <button
                onClick={() => {
                  setMoreMenuPosition(null);
                  backupDataToSafeLocation(database);
                }}
              >
                backup
              </button>
              <button
                tabIndex={-1}
                onClick={() => {
                  setMoreMenuPosition(null);
                  exportDatabase();
                }}
              >
                export
              </button>
              <button
                tabIndex={-1}
                onClick={() => {
                  setMoreMenuPosition(null);
                  fileInputDomRef.current?.click();
                }}
              >
                import
              </button>
              {textValue && (
                <button
                  tabIndex={-1}
                  onClick={() => {
                    setMoreMenuPosition(null);
                    openNewNote("");
                  }}
                >
                  new
                </button>
              )}
              <div
                style={{
                  height: "1px",
                  width: "100%",
                  backgroundColor: "var(--border-color)",
                  margin: "4px 6px",
                  opacity: 0.5,
                }}
              />
              <a href="https://github.com/shaoruu/typehere.app" target="_blank" rel="noreferrer">
                <button tabIndex={-1}>github</button>
              </a>
              <button
                tabIndex={-1}
                onClick={() => {
                  setMoreMenuPosition(null);
                  setIsHelpMenuOpen(true);
                }}
              >
                how
              </button>
            </div>
          </>
        )}
      </div>
      {isCmdKMenuOpen &&
        createPortal(
          <>
            <div
              style={{
                backgroundColor: "var(--overlay-background-color)",
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 99,
              }}
              onClick={() => {
                setIsCmdKMenuOpen(false);
              }}
            />
            <div
              style={{
                zIndex: 100,
                position: "fixed",
                top: "25%",
                left: "50%",
                width: "360px",
                maxWidth: "calc(100vw - 32px)",
                transform: "translateX(-50%)",
                backgroundColor: "var(--note-background-color)",
                boxShadow: "0 8px 16px var(--box-shadow-color)",
                display: "flex",
                flexDirection: "column",
                borderRadius: 8,
                border: "1px solid var(--border-color)",
              }}
            >
              <input
                autoFocus
                ref={cmdKInputDomRef}
                placeholder="Search for note"
                value={cmdKSearchQuery}
                onChange={(e) => {
                  setCmdKSearchQuery(e.target.value);
                  setSelectedCmdKSuggestionIndex(0);
                }}
                style={{
                  padding: "8px 10px",
                  outline: "none",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  margin: "8px",
                  marginBottom: 6,
                  fontSize: "0.95rem",
                }}
              />
              <div
                className="notes-list no-scrollbar"
                style={{
                  maxHeight: "min(320px, 40vh)",
                  overflow: "auto",
                  display: "flex",
                  border: "none",
                  flexDirection: "column",
                  gap: 4,
                  padding: "4px 8px 8px 8px",
                }}
              >
                {cmdKSuggestions.map((suggestion, index) => {
                  if (suggestion.type === "note") {
                    const note = suggestion.note;
                    const title = getNoteTitle(note);
                    const createdFormatted = formatDateCompact(note.createdAt);
                    const updatedFormatted = formatDateCompact(note.updatedAt);
                    const showBothDates = note.createdAt !== note.updatedAt;

                    return (
                      <div
                        key={`note-${note.id}-${index}`}
                        id={`note-list-cmdk-item-${index}`}
                        className="note-list-item"
                        onClick={() => {
                          openNote(note.id);
                        }}
                        style={{
                          backgroundColor:
                            index === selectedCmdKSuggestionIndex
                              ? "var(--note-selected-background-color)"
                              : "var(--note-background-color)",
                        }}
                      >
                        <div className="note-list-item-top">
                          <div
                            className="note-list-item-title"
                            style={{
                              fontWeight: note.id === currentNoteId ? "bold" : "normal",
                              fontStyle: title ? "normal" : "italic",
                              color: title
                                ? "var(--dark-color)"
                                : "var(--untitled-note-title-color)",
                            }}
                          >
                            {isAltKeyDown && index + 1 <= digitCount && (
                              <div
                                style={{
                                  display: "inline-block",
                                  color: "var(--secondary-dark-color)",
                                  marginRight: "4px",
                                  fontSize: "0.8rem",
                                }}
                              >
                                {index + 1}
                              </div>
                            )}
                            {note.isHidden && (
                              <MdVisibilityOff
                                style={{
                                  color: "var(--hidden-color)",
                                  marginRight: "4px",
                                  fontSize: "0.8rem",
                                }}
                              />
                            )}
                            {note.isPinned && (
                              <FaMapPin
                                style={{
                                  marginRight: "4px",
                                  color: "var(--pin-color)",
                                  fontSize: "0.8rem",
                                }}
                              />
                            )}
                            <span>{title.trim() || "New Note"}</span>
                          </div>
                          <button
                            className="note-list-item-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNote(note.id);
                            }}
                            style={{
                              visibility:
                                workspaceNotes.length > 1 && index === selectedCmdKSuggestionIndex
                                  ? "visible"
                                  : "hidden",
                              pointerEvents:
                                workspaceNotes.length > 1 && index === selectedCmdKSuggestionIndex
                                  ? "auto"
                                  : "none",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        <div
                          className="note-list-item-timestamp"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            flexDirection: "row",
                            flexWrap: "wrap",
                          }}
                        >
                          {note.workspace && (
                            <>
                              <span
                                style={{
                                  overflow: "hidden",
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  direction: "rtl",
                                }}
                              >
                                {note.workspace}
                              </span>
                              <span>•</span>
                            </>
                          )}
                          {showBothDates ? (
                            <>
                              <span title="Created">{createdFormatted}</span>
                              <span>→</span>
                              <span title="Updated">{updatedFormatted}</span>
                            </>
                          ) : (
                            <span>{updatedFormatted}</span>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const { title, onAction, content, color } = suggestion;

                  return (
                    <div
                      key={`action-${title}-${index}`}
                      id={`note-list-cmdk-item-${index}`}
                      className="note-list-item"
                      onClick={onAction}
                      style={{
                        backgroundColor:
                          index === selectedCmdKSuggestionIndex
                            ? "var(--note-selected-background-color)"
                            : "var(--note-background-color)",
                        position: "relative",
                      }}
                    >
                      {color && (
                        <div
                          style={{
                            top: 2,
                            bottom: 2,
                            left: 0,
                            width: 3,
                            borderRadius: 4,
                            position: "absolute",
                            background: color,
                            opacity: index === selectedCmdKSuggestionIndex ? 1.0 : 0.5,
                          }}
                        ></div>
                      )}
                      <div className="note-list-item-top">
                        <div
                          className="note-list-item-title"
                          style={{
                            fontWeight: "normal",
                            fontStyle: "normal",
                            color: "var(--dark-color)",
                          }}
                        >
                          {title}
                        </div>
                        <p
                          style={{
                            marginLeft: "4px",
                            fontSize: "0.8rem",
                            display: "flex",
                            alignItems: "center",
                            padding: "1px 4px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            color: "var(--on-fill-color)",
                            background: "var(--keyboard-key-color)",
                            borderRight: "2px solid var(--border-color)",
                            borderBottom: "2px solid var(--border-color)",
                            borderLeft: "none",
                            borderTop: "none",
                            visibility:
                              index === selectedCmdKSuggestionIndex ? "visible" : "hidden",
                          }}
                        >
                          Enter{" "}
                          <span
                            style={{
                              marginLeft: "4px",
                              marginBottom: "1px",
                            }}
                          >
                            ↵
                          </span>
                        </p>
                      </div>
                      <div
                        className="note-list-item-timestamp"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <p>{content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  outline: "none",
                  padding: "6px 12px",
                  fontSize: "0.75rem",
                  borderTop: "1px solid var(--border-color)",
                  color: "var(--dark-color)",
                  display: "flex",
                  justifyContent: "flex-end",
                  opacity: 0.5,
                }}
              >
                {currentWorkspace ? `workspace: [${currentWorkspace}]` : `all notes`}
              </div>
            </div>
          </>,
          document.body
        )}
      <input
        type="file"
        style={{ display: "none" }}
        ref={fileInputDomRef}
        onChange={(e) => {
          const fileReader = new FileReader();
          const target = e.target as HTMLInputElement;
          if (!target.files) return;
          fileReader.readAsText(target.files[0], "UTF-8");
          fileReader.onload = (e) => {
            const decompressedContent = LZString.decompressFromEncodedURIComponent(
              e.target?.result as string
            );
            if (decompressedContent) {
              const content = JSON.parse(decompressedContent);
              setDatabase(content);
              setCurrentWorkspace(null);
            }
          };
        }}
      />
      {isPasswordModalOpen &&
        isElectron() &&
        createPortal(
          <>
            <div
              style={{
                width: "100vw",
                height: "100vh",
                position: "fixed",
                background: "var(--overlay-background-color)",
                top: 0,
                left: 0,
                zIndex: 1000,
              }}
            />
            <div
              style={{
                zIndex: 1001,
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "360px",
                maxWidth: "calc(100vw - 32px)",
                backgroundColor: "var(--note-background-color)",
                boxShadow: "0 8px 16px var(--box-shadow-color)",
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                padding: "24px",
              }}
            >
              <h2
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "1.2rem",
                  color: "var(--dark-color)",
                }}
              >
                {isSettingPassword ? "Set Master Password" : "Enter Password"}
              </h2>
              <p
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "0.9rem",
                  color: "var(--dark-color)",
                  opacity: 0.7,
                }}
              >
                {isSettingPassword
                  ? "Create a password to encrypt your notes on disk for CLI access."
                  : "Enter your password to unlock encrypted notes."}
              </p>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handlePasswordSubmit();
                  }
                }}
                placeholder="Password"
                autoFocus
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  outline: "none",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  fontSize: "0.95rem",
                  marginBottom: "16px",
                  backgroundColor: "var(--note-background-color)",
                  color: "var(--dark-color)",
                }}
              />
              <button
                onClick={handlePasswordSubmit}
                style={{
                  width: "100%",
                  padding: "8px 16px",
                  backgroundColor: "var(--keyboard-key-color)",
                  color: "var(--on-fill-color)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: "0.95rem",
                }}
              >
                {isSettingPassword ? "Set Password" : "Unlock"}
              </button>
            </div>
          </>,
          document.body
        )}
    </main>
  );
}

export default App;
