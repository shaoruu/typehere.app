/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { EnhancedTextarea } from './EnhancedTextarea';
import LZString from 'lz-string';
import Fuse from 'fuse.js';

function usePersistentState<T>(storageKey: string, defaultValue?: T) {
  const [data, setData] = useState<T>(() => {
    const localStorageData = localStorage.getItem(storageKey);

    try {
      return localStorageData ? JSON.parse(localStorageData) : defaultValue;
    } catch (e) {
      console.error('Failed to parse local storage data', e);
      return defaultValue;
    }
  });

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setData(event.newValue ? JSON.parse(event.newValue) : defaultValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey, defaultValue]);

  return [
    data,
    (newData: T) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newData));
        setData(newData);
      } catch (e) {
        console.error('Failed to save data to local storage', e);
      }
    },
  ] as const;
}

const getRandomId = () => Math.random().toString(36).substring(2);

type Note = {
  id: string;
  content: string;
  updatedAt: string;
};

const freshDatabase = [
  {
    id: getRandomId(),
    content: '',
    updatedAt: new Date().toISOString(),
  },
];

async function backupDataToSafeLocation(data: unknown) {
  if (!('indexedDB' in window)) {
    console.error("This browser doesn't support IndexedDB");
    return;
  }

  const dbRequest = indexedDB.open('BackupDatabase', 1);

  dbRequest.onupgradeneeded = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    if (!db.objectStoreNames.contains('backups')) {
      db.createObjectStore('backups', { autoIncrement: true });
    }
  };

  dbRequest.onerror = (event) => {
    console.error('Error opening IndexedDB for backup', event);
  };

  dbRequest.onsuccess = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    const transaction = db.transaction('backups', 'readwrite');
    const store = transaction.objectStore('backups');
    const request = store.add({ date: new Date().toISOString(), data });

    request.onsuccess = () => {
      console.log('Data backed up successfully in IndexedDB');
    };

    request.onerror = (event) => {
      console.error('Error backing up data in IndexedDB', event);
    };
  };
}

function usePeriodicBackup<T>(data: T, interval: number = 24 * 60 * 60 * 1000) {
  useEffect(() => {
    const lastBackupDateStr = localStorage.getItem('lastBackupDate');
    const lastBackupDate = lastBackupDateStr
      ? new Date(lastBackupDateStr)
      : new Date(0);
    const now = new Date();

    if (now.getTime() - lastBackupDate.getTime() > interval) {
      backupDataToSafeLocation(data);
      localStorage.setItem('lastBackupDate', now.toISOString());
    }

    const intervalId = setInterval(() => {
      backupDataToSafeLocation(data);
      localStorage.setItem('lastBackupDate', new Date().toISOString());
    }, interval);

    return () => clearInterval(intervalId);
  }, [data, interval]);
}

const themeId = 'typehere-theme';
if (localStorage.getItem(themeId) === '"dark"') {
  document.documentElement.setAttribute('data-theme', 'dark');
}

function App() {
  const textareaDomRef = useRef<HTMLTextAreaElement>(null);

  const [database, setDatabase] = usePersistentState<Note[]>(
    'typehere-database',
    freshDatabase,
  );
  usePeriodicBackup(database);

  const [currentNoteId, setCurrentNoteId] = usePersistentState<string>(
    'typehere-currentNoteId',
    freshDatabase[0].id,
  );
  const [listMenuPosition, setListMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [moreMenuPosition, setMoreMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [textValue, setTextValue] = useState('');

  useEffect(() => {
    const currentNote = database.find((note) => note.id === currentNoteId);
    if (currentNote) {
      setTextValue(currentNote.content);
    } else {
      setCurrentNoteId(database[0].id);
      setTextValue(database[0].content);
    }
  }, [currentNoteId, database, setCurrentNoteId]);

  const deleteNote = (noteId: string) => {
    const updatedDatabase = database.filter((note) => note.id !== noteId);
    setDatabase(updatedDatabase);
    if (currentNoteId === noteId) {
      setCurrentNoteId(updatedDatabase[0]?.id || '');
      setTextValue(updatedDatabase[0]?.content || '');
    }
  };

  const fileInputDomRef = useRef<HTMLInputElement>(null);
  const listDomRef = useRef<HTMLButtonElement>(null);

  const [currentTheme, setCurrentTheme] = usePersistentState<'light' | 'dark'>(
    themeId,
    'light',
  );
  const [selectedListNoteIndex, setSelectedListNoteIndex] = useState<number>(0);
  const [selectedCmdKNoteIndex, setSelectedCmdKNoteIndex] = useState<number>(0);
  const [cmdKSearchQuery, setCmdKSearchQuery] = useState('');
  const [isCmdKMenuOpen, setIsCmdKMenuOpen] = useState(false);
  const [hasVimNavigated, setHasVimNavigated] = useState(false);

  const toggleTheme = () => {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setCurrentTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const filteredDatabase = useMemo(() => {
    const fuse = new Fuse(database, {
      keys: ['content'],
      includeScore: true,
      threshold: 0.3,
    });
    return cmdKSearchQuery
      ? fuse.search(cmdKSearchQuery).map((result) => result.item)
      : database;
  }, [database, cmdKSearchQuery]);

  const openNote = (noteId: string) => {
    setCurrentNoteId(noteId);
    setListMenuPosition(null);
    const n = database.find((n) => n.id === noteId);
    if (n) {
      n.updatedAt = new Date().toISOString();
    }
    setTimeout(() => {
      textareaDomRef.current?.focus();
    }, 10);
  };

  const openNewNote = () => {
    const newNote: Note = {
      id: getRandomId(),
      content: '',
      updatedAt: new Date().toISOString(),
    };
    setDatabase([...database, newNote]);
    setCurrentNoteId(newNote.id);
    setTextValue('');
    openNote(newNote.id);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCmdKMenuOpen && e.key === 'Escape') {
        e.preventDefault();
        setIsCmdKMenuOpen(false);
        textareaDomRef.current?.focus();
        return;
      }

      if (!!listMenuPosition && e.key === 'Escape') {
        e.preventDefault();
        setListMenuPosition(null);
        textareaDomRef.current?.focus();
        return;
      }

      const vimUp = (e.ctrlKey || e.metaKey) && e.key === 'k';
      const vimDown = (e.ctrlKey || e.metaKey) && e.key === 'j';

      if ((isCmdKMenuOpen || !!listMenuPosition) && (vimUp || vimDown)) {
        setHasVimNavigated(true);
      }

      if (isCmdKMenuOpen) {
        let nextIndex: number | null = null;
        if (e.key === 'ArrowUp' || vimUp) {
          e.preventDefault();
          if (selectedCmdKNoteIndex === null) {
            nextIndex = filteredDatabase.length - 1;
          } else {
            nextIndex =
              (selectedCmdKNoteIndex - 1 + filteredDatabase.length) %
              filteredDatabase.length;
          }
          setSelectedCmdKNoteIndex(nextIndex);
        } else if (e.key === 'ArrowDown' || vimDown) {
          e.preventDefault();
          if (selectedCmdKNoteIndex === null) {
            nextIndex = 0;
          } else {
            nextIndex = (selectedCmdKNoteIndex + 1) % filteredDatabase.length;
          }
          setSelectedCmdKNoteIndex(nextIndex);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setIsCmdKMenuOpen(false);
          setSelectedCmdKNoteIndex(0);
          openNote(filteredDatabase[selectedCmdKNoteIndex!].id);
        }
        if (nextIndex !== null) {
          const elementId = `note-list-cmdk-item-${nextIndex}`;
          const element = document.getElementById(elementId);
          if (element) {
            element.scrollIntoView({ block: 'center' });
          }
        }
        return;
      }

      if (listMenuPosition) {
        let nextIndex: number | null = null;
        if (e.key === 'ArrowUp' || vimUp) {
          e.preventDefault();
          if (selectedListNoteIndex === null) {
            nextIndex = 0;
          } else {
            nextIndex = (selectedListNoteIndex + 1) % database.length;
          }
          setSelectedListNoteIndex(nextIndex);
        } else if (e.key === 'ArrowDown' || vimDown) {
          e.preventDefault();
          if (selectedListNoteIndex === null) {
            nextIndex = database.length - 1;
          } else {
            nextIndex =
              (selectedListNoteIndex - 1 + database.length) % database.length;
          }
          setSelectedListNoteIndex(nextIndex);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setSelectedListNoteIndex(0);
          openNote(database[selectedListNoteIndex!].id);
        }
        if (nextIndex !== null) {
          const elementId = `note-list-item-${nextIndex}`;
          const element = document.getElementById(elementId);
          if (element) {
            element.scrollIntoView({ block: 'center' });
          }
        }
        return;
      }

      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        textareaDomRef.current?.blur();
        setSelectedCmdKNoteIndex(0);
        setIsCmdKMenuOpen(true);
        setCmdKSearchQuery('');
        return;
      }

      if (
        (e.key === '/' || e.key === 'm') &&
        (e.metaKey || e.ctrlKey) &&
        listDomRef.current
      ) {
        const list = listDomRef.current;
        textareaDomRef.current?.blur();
        setSelectedListNoteIndex(0);
        const rect = list.getBoundingClientRect();
        setListMenuPosition({
          x: window.innerWidth - (rect.x + rect.width),
          y: window.innerHeight - rect.y + 4,
        });
        return;
      }

      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        textValue.trim().length !== 0
      ) {
        e.preventDefault();
        openNewNote();
        return;
      }

      if (e.key === 'Enter') {
        textareaDomRef.current?.focus();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (
        hasVimNavigated &&
        (isCmdKMenuOpen || !!listMenuPosition) &&
        (event.key === 'Meta' || event.key === 'Control')
      ) {
        if (isCmdKMenuOpen && filteredDatabase.length > 0) {
          openNote(filteredDatabase[selectedCmdKNoteIndex!].id);
        } else {
          openNote(database[selectedListNoteIndex!].id);
        }

        setIsCmdKMenuOpen(false);
        setListMenuPosition(null);
        setHasVimNavigated(false);

        textareaDomRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    database,
    database.length,
    filteredDatabase,
    hasVimNavigated,
    isCmdKMenuOpen,
    listMenuPosition,
    openNewNote,
    openNote,
    selectedCmdKNoteIndex,
    selectedListNoteIndex,
    textValue,
  ]);

  useEffect(() => {
    if (textareaDomRef.current) {
      textareaDomRef.current.focus();
    }
  }, [currentNoteId]);

  return (
    <main>
      <EnhancedTextarea
        id="editor"
        ref={textareaDomRef}
        setText={(newText) => {
          setTextValue(newText);
          const noteIndex = database.findIndex((n) => n.id === currentNoteId);
          if (noteIndex !== -1) {
            const updatedNote = {
              ...database[noteIndex],
              content: newText,
              updatedAt: new Date().toISOString(),
            };
            const newDatabase = [...database];
            newDatabase.splice(noteIndex, 1, updatedNote);
            setDatabase(newDatabase);
          }
        }}
        text={textValue}
        placeholder="Type here..."
      />
      <div id="controls">
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMoreMenuPosition({
              x: window.innerWidth - (rect.x + rect.width),
              y: window.innerHeight - rect.y + 4,
            });
          }}
        >
          more
        </button>
        {moreMenuPosition && (
          <>
            <div
              style={{
                width: '100vw',
                height: '100vh',
                position: 'fixed',
                top: 0,
                left: 0,
              }}
              onClick={() => {
                setMoreMenuPosition(null);
              }}
            />
            <div
              style={{
                position: 'fixed',
                right: moreMenuPosition.x,
                bottom: moreMenuPosition.y,
                zIndex: 100,
              }}
              className="more-menu"
            >
              <button
                onClick={() => {
                  setMoreMenuPosition(null);
                  toggleTheme();
                }}
              >
                {currentTheme === 'light' ? 'dark' : 'light'}
              </button>
              <button
                tabIndex={-1}
                onClick={() => {
                  const compressedData = LZString.compressToEncodedURIComponent(
                    JSON.stringify(database),
                  );
                  const dataStr =
                    'data:text/json;charset=utf-8,' + compressedData;
                  const downloadAnchorNode = document.createElement('a');
                  downloadAnchorNode.setAttribute('href', dataStr);
                  downloadAnchorNode.setAttribute(
                    'download',
                    'notes_export.json',
                  );
                  document.body.appendChild(downloadAnchorNode);
                  downloadAnchorNode.click();
                  downloadAnchorNode.remove();
                }}
              >
                export
              </button>
              <input
                type="file"
                style={{ display: 'none' }}
                ref={fileInputDomRef}
                onChange={(e) => {
                  const fileReader = new FileReader();
                  const target = e.target as HTMLInputElement;
                  if (!target.files) return;
                  fileReader.readAsText(target.files[0], 'UTF-8');
                  fileReader.onload = (e) => {
                    const decompressedContent =
                      LZString.decompressFromEncodedURIComponent(
                        e.target?.result as string,
                      );
                    if (decompressedContent) {
                      const content = JSON.parse(decompressedContent);
                      setDatabase(content);
                    }
                  };
                }}
              />
              <button
                tabIndex={-1}
                onClick={() => fileInputDomRef.current?.click()}
              >
                import
              </button>
            </div>
          </>
        )}
        {textValue && (
          <button tabIndex={-1} onClick={openNewNote}>
            new
          </button>
        )}
        <button
          ref={listDomRef}
          tabIndex={-1}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setListMenuPosition({
              x: window.innerWidth - (rect.x + rect.width),
              y: window.innerHeight - rect.y + 4,
            });
          }}
        >
          list
        </button>
        {listMenuPosition &&
          createPortal(
            <>
              <div
                style={{
                  width: '100vw',
                  height: '100vh',
                  position: 'fixed',
                  top: 0,
                  left: 0,
                }}
                onClick={() => {
                  setListMenuPosition(null);
                }}
              />
              <div
                style={{
                  position: 'fixed',
                  right: listMenuPosition.x,
                  bottom: listMenuPosition.y,
                  zIndex: 100,
                  backgroundColor: 'var(--note-background-color)',
                  boxShadow: '0 4px 6px var(--box-shadow-color)',
                }}
                className="notes-list"
              >
                {database
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((note, index) => {
                    const title = note.content.slice(0, 20);
                    const timestamp = new Date(note.updatedAt).toLocaleString();

                    return (
                      <div
                        key={note.id}
                        id={`note-list-item-${index}`}
                        className="note-list-item"
                        onClick={() => {
                          openNote(note.id);
                        }}
                        style={{
                          backgroundColor:
                            index === selectedListNoteIndex
                              ? 'var(--note-selected-background-color)'
                              : 'var(--note-background-color)',
                        }}
                      >
                        <div className="note-list-item-top">
                          <div
                            className="note-list-item-title"
                            style={{
                              fontWeight:
                                note.id === currentNoteId ? 'bold' : 'normal',
                              fontStyle: title ? 'normal' : 'italic',
                              color: title
                                ? 'var(--dark-color)'
                                : 'var(--untitled-note-title-color)',
                            }}
                          >
                            {title || 'New Note'}
                          </div>
                          {database.length > 1 && (
                            <button
                              className="note-list-item-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNote(note.id);
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <div className="note-list-item-timestamp">
                          {timestamp}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>,
            document.body,
          )}
      </div>
      {isCmdKMenuOpen &&
        createPortal(
          <>
            <div
              style={{
                backgroundColor: 'var(--overlay-background-color)',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
              onClick={() => {
                setIsCmdKMenuOpen(false);
              }}
            />
            <div
              style={{
                zIndex: 100,
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: 'var(--note-background-color)',
                boxShadow: '0 4px 6px var(--box-shadow-color)',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 6,
                border: '1px solid var(--border-color)',
              }}
            >
              <input
                autoFocus
                placeholder="Search for note"
                value={cmdKSearchQuery}
                onChange={(e) => {
                  setCmdKSearchQuery(e.target.value);
                  setSelectedCmdKNoteIndex(0);
                }}
                style={{
                  padding: '4px',
                  outline: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  margin: '6px',
                  marginBottom: 0,
                }}
              />
              <div
                className="notes-list"
                style={{
                  maxHeight: '300px',
                  overflow: 'auto',
                  display: 'flex',
                  border: 'none',
                  flexDirection: 'column',
                  gap: 4,
                  padding: 4,
                }}
              >
                {filteredDatabase.length === 0 && (
                  <div
                    style={{
                      opacity: 0.5,
                      padding: '4px',
                      color: 'var(--dark-color)',
                    }}
                  >
                    No notes found...
                  </div>
                )}
                {filteredDatabase
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((note, index) => {
                    const title = note.content.slice(0, 20);
                    const timestamp = new Date(note.updatedAt).toLocaleString();

                    return (
                      <div
                        key={note.id}
                        id={`note-list-cmdk-item-${index}`}
                        className="note-list-item"
                        onClick={() => {
                          openNote(note.id);
                        }}
                        style={{
                          backgroundColor:
                            index === selectedCmdKNoteIndex
                              ? 'var(--note-selected-background-color)'
                              : 'var(--note-background-color)',
                        }}
                      >
                        <div className="note-list-item-top">
                          <div
                            className="note-list-item-title"
                            style={{
                              fontWeight:
                                note.id === currentNoteId ? 'bold' : 'normal',
                              fontStyle: title ? 'normal' : 'italic',
                              color: title
                                ? 'var(--dark-color)'
                                : 'var(--untitled-note-title-color)',
                            }}
                          >
                            {title || 'New Note'}
                          </div>
                          {database.length > 1 && (
                            <button
                              className="note-list-item-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNote(note.id);
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <div className="note-list-item-timestamp">
                          {timestamp}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>,
          document.body,
        )}
    </main>
  );
}

export default App;
