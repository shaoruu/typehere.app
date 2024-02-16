import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { EnhancedTextarea } from './EnhancedTextarea';

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

  useEffect(() => {
    if (textareaDomRef.current) {
      textareaDomRef.current.focus();
    }
  }, [currentNoteId]);

  return (
    <main>
      <EnhancedTextarea
        id="editor"
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
            }}
          >
            new
          </button>
        )}
        <button
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
                  .map((note) => {
                    const title = note.content.slice(0, 20);
                    const timestamp = new Date(note.updatedAt).toLocaleString();

                    return (
                      <div
                        key={note.id}
                        className="note-list-item"
                        onClick={() => {
                          setCurrentNoteId(note.id);
                          setListMenuPosition(null);
                          const n = database.find((n) => n.id === note.id);
                          if (n) {
                            n.updatedAt = new Date().toISOString();
                          }
                          setDatabase([...database]);
                          setTimeout(() => {
                            textareaDomRef.current?.focus();
                          }, 10);
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
    </main>
  );
}

export default App;
