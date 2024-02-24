import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { EnhancedTextarea } from './EnhancedTextarea';
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

function App() {
  const textareaDomRef = useRef<HTMLTextAreaElement>(null);

  const [database, setDatabase] = usePersistentState<Note[]>(
    'typehere-database',
    freshDatabase,
  );
  const [currentNoteId, setCurrentNoteId] = usePersistentState<string>(
    'typehere-currentNoteId',
    freshDatabase[0].id,
  );
  const [listMenuPosition, setListMenuPosition] = useState<{
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

  const listDomRef = useRef<HTMLButtonElement>(null);

  const [selectedListNoteIndex, setSelectedListNoteIndex] = useState<
    number | null
  >(null);
  const [selectedCmdKNoteIndex, setSelectedCmdKNoteIndex] = useState<number>(0);
  const [cmdkSearchQuery, setCmdKSearchQuery] = useState('');
  const [isCmdKMenuOpen, setIsCmdKMenuOpen] = useState(false);

  const filteredDatabase = useMemo(() => {
    const fuse = new Fuse(database, {
      keys: ['content'],
      includeScore: true,
      threshold: 0.3,
    });
    return cmdkSearchQuery
      ? fuse.search(cmdkSearchQuery).map((result) => result.item)
      : database;
  }, [database, cmdkSearchQuery]);

  const openNote = useCallback(
    (noteId: string) => {
      setCurrentNoteId(noteId);
      setListMenuPosition(null);
      const n = database.find((n) => n.id === noteId);
      if (n) {
        n.updatedAt = new Date().toISOString();
      }
      setDatabase([...database]);
      setTimeout(() => {
        textareaDomRef.current?.focus();
      }, 10);
    },
    [database, setCurrentNoteId, setDatabase],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCmdKMenuOpen(true);
        setCmdKSearchQuery('');
        return;
      }

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

      if (
        (e.key === '/' || e.key === 'm') &&
        (e.metaKey || e.ctrlKey) &&
        listDomRef.current
      ) {
        const list = listDomRef.current;
        const rect = list.getBoundingClientRect();
        setListMenuPosition({
          x: window.innerWidth - (rect.x + rect.width),
          y: window.innerHeight - rect.y + 4,
        });
        return;
      }

      if (isCmdKMenuOpen) {
        let nextIndex: number | null = null;
        if (
          e.key === 'ArrowUp' ||
          ((e.ctrlKey || e.metaKey) && e.key === 'k')
        ) {
          e.preventDefault();
          if (selectedCmdKNoteIndex === null) {
            nextIndex = filteredDatabase.length - 1;
          } else {
            nextIndex =
              (selectedCmdKNoteIndex - 1 + filteredDatabase.length) %
              filteredDatabase.length;
          }
          setSelectedCmdKNoteIndex(nextIndex);
        } else if (
          e.key === 'ArrowDown' ||
          ((e.ctrlKey || e.metaKey) && e.key === 'j')
        ) {
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
            element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        return;
      }

      if (listMenuPosition) {
        let nextIndex: number | null = null;
        if (
          e.key === 'ArrowUp' ||
          ((e.ctrlKey || e.metaKey) && e.key === 'k')
        ) {
          e.preventDefault();
          if (selectedListNoteIndex === null) {
            nextIndex = 0;
          } else {
            nextIndex = (selectedListNoteIndex + 1) % database.length;
          }
          setSelectedListNoteIndex(nextIndex);
        } else if (
          e.key === 'ArrowDown' ||
          ((e.ctrlKey || e.metaKey) && e.key === 'j')
        ) {
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
            element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        return;
      }

      if (e.key === 'Enter') {
        console.log(textareaDomRef.current);
        textareaDomRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    database,
    database.length,
    filteredDatabase,
    isCmdKMenuOpen,
    listMenuPosition,
    openNote,
    selectedCmdKNoteIndex,
    selectedListNoteIndex,
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
        {textValue && (
          <button
            tabIndex={-1}
            onClick={() => {
              const newNote: Note = {
                id: getRandomId(),
                content: '',
                updatedAt: new Date().toISOString(),
              };
              setDatabase([...database, newNote]);
              setCurrentNoteId(newNote.id);
              setTextValue('');
              openNote(newNote.id);
            }}
          >
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
                  backgroundColor: '#fff',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
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
                              ? 'lightgray'
                              : 'white',
                        }}
                      >
                        <div className="note-list-item-top">
                          <div
                            className="note-list-item-title"
                            style={{
                              fontWeight:
                                note.id === currentNoteId ? 'bold' : 'normal',
                              fontStyle: title ? 'normal' : 'italic',
                              color: title ? 'black' : '#66666699',
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
                backgroundColor: 'rgba(0,0,0,0.5)',
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
                backgroundColor: '#fff',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 6,
                border: '1px solid #888',
              }}
            >
              <input
                autoFocus
                placeholder="Search for note"
                value={cmdkSearchQuery}
                onChange={(e) => {
                  setCmdKSearchQuery(e.target.value);
                  setSelectedCmdKNoteIndex(0);
                }}
                style={{
                  padding: '4px',
                  outline: 'none',
                  border: '1px solid #888',
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
                  <div style={{ opacity: 0.5, padding: '4px' }}>
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
                              ? 'lightgray'
                              : 'white',
                        }}
                      >
                        <div className="note-list-item-top">
                          <div
                            className="note-list-item-title"
                            style={{
                              fontWeight:
                                note.id === currentNoteId ? 'bold' : 'normal',
                              fontStyle: title ? 'normal' : 'italic',
                              color: title ? 'black' : '#66666699',
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
