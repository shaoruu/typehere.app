// /* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import LZString from 'lz-string';
import Fuse from 'fuse.js';
import AceEditor from 'react-ace';
import { FaMapPin } from 'react-icons/fa';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { MdVisibilityOff } from 'react-icons/md';

// import { LuLock, LuUnlock } from 'react-icons/lu';

// Updated textsToReplace with additional text replacements for enhanced text processing
const textsToReplace: [string | RegExp, string][] = [
  [' -> ', ' → '],
  [' <- ', ' ← '],
  ['\n-> ', '\n→ '],
  ['<- \n', '← \n'],
  [/^-> /, '→ '],
  [/^<- /, '← '],
  ['(c)', '©'],
  ['(r)', '®'],
  ['+-', '±'],
];

function usePersistentState<T>(
  storageKey: string,
  defaultValue?: T,
  shouldListenToChange = true,
) {
  const [data, setData] = useState<T>(() => {
    const localStorageData = localStorage.getItem(storageKey);

    try {
      return localStorageData ? JSON.parse(localStorageData) : defaultValue;
    } catch (e) {
      console.error('Failed to parse local storage data', e);
      return defaultValue;
    }
  });

  // Function to save data to localStorage
  const saveData = (dataToSave: T) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(dataToSave));
    } catch (e) {
      console.error('Failed to save data to local storage', e);
    }
  };

  useEffect(() => {
    if (!shouldListenToChange) return;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setData(event.newValue ? JSON.parse(event.newValue) : defaultValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey, defaultValue, shouldListenToChange]);

  // Debounce function to limit the rate at which the function can fire
  const debounce = (func: (dataToSave: T) => void, delay: number) => {
    let timer: number;
    return (dataToSave: T) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func(dataToSave);
      }, delay);
    };
  };

  const saveDataDebounced = debounce(saveData, 100); // Adjust the delay as needed

  useEffect(() => {
    // Save data when the component is about to unmount or page is about to be closed
    const handleBeforeUnload = () => {
      saveData(data);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [data]);

  return [
    data,
    (newData: T) => {
      setData(newData);
      saveDataDebounced(newData);
    },
  ] as const;
}

const getRandomId = () => Math.random().toString(36).substring(2);

type Note = {
  id: string;
  content: string;
  updatedAt: string;
  isPinned: boolean;
  isHidden: boolean;
  workspace?: string;
};

type CmdKSuggestion =
  | {
      type: 'note';
      note: Note;
    }
  | {
      type: 'action';
      title: string;
      content: string;
      color?: string;
      // return true to close the cmd-k menu
      onAction: () => boolean;
    };

const cmdKSuggestionActionType = 'action' as const;

const freshDatabase = [
  {
    id: getRandomId(),
    content: '',
    updatedAt: new Date().toISOString(),
    isPinned: false,
    isHidden: false,
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

const sortNotes = (notes: Note[]) => {
  return notes.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
};

function App() {
  const textareaDomRef = useRef<HTMLTextAreaElement>(null);
  const cmdKInputDomRef = useRef<HTMLInputElement>(null);

  const [database, setDatabase] = usePersistentState<Note[]>(
    'typehere-database',
    freshDatabase,
  );

  usePeriodicBackup(database);

  const [currentWorkspace, setCurrentWorkspace] = usePersistentState<
    string | null
  >('typehere-currentWorkspace', null, false);
  const [currentNoteId, setCurrentNoteId] = usePersistentState<string>(
    'typehere-currentNoteId',
    freshDatabase[0].id,
    false,
  );
  const [moreMenuPosition, setMoreMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [lastAceCursorPosition, setLastAceCursorPosition] = useState({
    row: 0,
    column: 0,
  });

  const workspaceNotes = useMemo(() => {
    return currentWorkspace === null
      ? sortNotes(database)
      : sortNotes(
          database.filter(
            (n) => n.workspace === currentWorkspace || n.isPinned,
          ),
        );
  }, [database, currentWorkspace]);

  const availableWorkspaces = useMemo(() => {
    const seenWorkspaces = new Set<string>();
    const allWorkspaces: string[] = [];
    const shallowDatabase = sortNotes([...database]);

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
    const currentNote = workspaceNotes.find(
      (note) => note.id === currentNoteId,
    );
    if (currentNote) {
      setTextValue(currentNote.content);
    } else {
      setCurrentNoteId(workspaceNotes[0].id);
      setTextValue(workspaceNotes[0].content);
    }
  }, [currentNoteId, workspaceNotes, setCurrentNoteId]);

  const focus = () => {
    if (aceEditorRef.current) {
      const editor = aceEditorRef.current.editor;
      if (editor.isFocused()) return;
      editor.moveCursorTo(
        lastAceCursorPosition.row,
        lastAceCursorPosition.column,
      );
      editor.focus();
    } else {
      textareaDomRef.current?.focus();
    }
  };

  const deleteNote = (noteId: string) => {
    const deletedNote = database.find((note) => note.id === noteId);
    if (!deletedNote) return;
    setFreshlyDeletedNotes((prev) => [...prev, deletedNote]);
    // only keep the last 10 deleted notes
    setDeletedNotesBackup([...deletedNotesBackup, deletedNote].slice(-10));
    const updatedDatabase = database.filter((note) => note.id !== noteId);
    setDatabase(updatedDatabase);
    if (currentNoteId === noteId) {
      setCurrentNoteId(updatedDatabase[0]?.id || '');
      setTextValue(updatedDatabase[0]?.content || '');
    }
  };

  const openNote = (noteId: string, shouldFocus: boolean = true) => {
    if (!noteId || !database.find((n) => n.id === noteId)) {
      return;
    }

    setLastAceCursorPosition({ row: 0, column: 0 });
    setCurrentNoteId(noteId);

    const n = database.find((n) => n.id === noteId);
    if (n) {
      n.updatedAt = new Date().toISOString();
    }

    if (n && !n.isPinned && n.workspace !== currentWorkspace) {
      setCurrentWorkspace(n.workspace ?? null);
    }

    setDatabase(database);

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
  };

  const openNewNote = (
    defaultContent: string = '',
    defaultWorkspace: string = '',
    shouldFocus = true,
  ) => {
    const newNote: Note = {
      id: getRandomId(),
      content: defaultContent,
      updatedAt: new Date().toISOString(),
      workspace: (defaultWorkspace || currentWorkspace) ?? undefined,
      isPinned: false,
      isHidden: false,
    };

    setDatabase([...database, newNote]);
    setCurrentNoteId(newNote.id);
    setTextValue('');
    openNote(newNote.id, shouldFocus);

    return newNote;
  };

  const fileInputDomRef = useRef<HTMLInputElement>(null);

  const [currentTheme, setCurrentTheme] = usePersistentState<'light' | 'dark'>(
    themeId,
    'light',
  );
  const [selectedCmdKSuggestionIndex, setSelectedCmdKSuggestionIndex] =
    useState<number>(0);
  const [cmdKSearchQuery, setCmdKSearchQuery] = useState('');
  const [isCmdKMenuOpen, setIsCmdKMenuOpen] = useState(false);
  const [hasVimNavigated, setHasVimNavigated] = useState(false);
  const [isUsingVim, setIsUsingVim] = usePersistentState('typehere-vim', false);
  const [isNarrowScreen, setIsNarrowScreen] = usePersistentState(
    'typehere-narrow',
    false,
  );
  const [freshlyDeletedNotes, setFreshlyDeletedNotes] = useState<Note[]>([]);
  const [deletedNotesBackup, setDeletedNotesBackup] = usePersistentState<
    Note[]
  >('typehere-deletedNotes', []);
  const [shouldShowHiddenNotes, setShouldShowHiddenNotes] = useState(false);

  usePeriodicBackup(deletedNotesBackup);

  const toggleTheme = () => {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    saveTheme(newTheme);
  };

  const saveTheme = (theme: 'light' | 'dark') => {
    setCurrentTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
  };

  useEffect(() => {
    if (currentTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, [currentTheme]);

  const moveNoteToWorkspace = (note: Note, workspace?: string) => {
    note.workspace = workspace;
    setDatabase(database);
    setCurrentWorkspace(workspace ?? null);
    setSelectedCmdKSuggestionIndex(0);
    openNote(note.id, false);
  };

  const runCmdKSuggestion = (suggestion?: CmdKSuggestion): boolean => {
    if (!suggestion) return true;
    if (suggestion.type === 'note') {
      openNote(suggestion.note.id);
      return true;
    } else if (suggestion.type === 'action') {
      return suggestion.onAction();
    }
    return false;
  };

  const getNextWorkspace = (direction: 'left' | 'right') => {
    const currentIndex = navigableWorkspaces.indexOf(currentWorkspace);
    if (currentIndex === -1) {
      console.warn('wtf?'); // not supposed to happen
    } else {
      if (direction === 'left') {
        return navigableWorkspaces[
          (currentIndex - 1 + navigableWorkspaces.length) %
            navigableWorkspaces.length
        ];
      } else {
        return navigableWorkspaces[
          (currentIndex + 1) % navigableWorkspaces.length
        ];
      }
    }
  };

  const openWorkspace = (workspace: string | null) => {
    setSelectedCmdKSuggestionIndex(0);
    setCurrentWorkspace(workspace ?? null);
    setCurrentNoteId(''); // hack to force a re-render
  };

  const getNoteTitle = (note: Note) => {
    const firstLineBreakIndex = note.content.trim().indexOf('\n');
    const title = note.content.substring(
      0,
      firstLineBreakIndex === -1 ? undefined : firstLineBreakIndex + 1,
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

  const cmdKSuggestions = useMemo<CmdKSuggestion[]>(() => {
    const searchAllNotesKeys = ['@', '>'];
    const shouldSearchAllNotes = searchAllNotesKeys.some((key) =>
      cmdKSearchQuery.startsWith(key),
    );
    const processedCmdKSearchQuery = shouldSearchAllNotes
      ? cmdKSearchQuery.substring(1)
      : cmdKSearchQuery;
    const relevantNotes = shouldSearchAllNotes ? database : workspaceNotes;
    const notesToSearch = relevantNotes.filter(
      (note) =>
        shouldShowHiddenNotes || !note.isHidden || note.id === currentNoteId,
    );
    const hiddenNotesMatchLength = 5;
    // we're matching the entire database for easier access.
    const matchingHiddenNotes = database.filter((note) => {
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
    });

    const notesFuse = new Fuse(notesToSearch, {
      keys: ['content'],
      includeScore: true,
      threshold: 0.2,
    });
    const workspaceFuse = new Fuse(
      [
        ...availableWorkspaces.map((workspace) => ({
          label: workspace,
          value: workspace,
        })),
        {
          label: 'all notes',
          value: null,
        },
      ],
      {
        keys: ['label'],
        includeScore: true,
        threshold: 0.05, // lower for workspace match
      },
    );
    const notes = processedCmdKSearchQuery
      ? notesFuse.search(processedCmdKSearchQuery).map((result) => result.item)
      : notesToSearch;
    const workspaces = processedCmdKSearchQuery
      ? workspaceFuse
          .search(processedCmdKSearchQuery)
          .map((result) => result.item)
      : [];
    const currentNote = database.find((note) => note.id === currentNoteId);

    const unlinkTitle = 'unlink note';
    const shouldTrimQuery = processedCmdKSearchQuery.length > 20;
    const trimmedQuery = processedCmdKSearchQuery.slice(0, 20);
    const trimmedContent = shouldTrimQuery
      ? trimmedQuery + '...'
      : processedCmdKSearchQuery;

    const regularCommands: CmdKSuggestion[] = [
      {
        type: 'action',
        title: 'toggle light dark theme mode',
        content:
          'enter ' + (currentTheme === 'light' ? 'dark' : 'light') + ' mode',
        color: '#B39DDB', // A soothing lavender
        onAction: () => {
          toggleTheme();
          return false;
        },
      },
      {
        type: 'action',
        title: 'toggle vim mode',
        content: 'turn ' + (isUsingVim ? 'off' : 'on') + ' vim mode',
        color: '#81D4FA', // A calming light blue
        onAction: () => {
          setIsUsingVim(!isUsingVim);
          return true;
        },
      },
      {
        type: 'action',
        title: 'toggle narrow screen mode',
        content:
          'enter ' + (isNarrowScreen ? 'wide' : 'narrow') + ' screen mode',
        color: '#AED581', // A gentle light green
        onAction: () => {
          setIsNarrowScreen(!isNarrowScreen);
          return true;
        },
      },
      {
        type: 'action',
        title: 'backup all notes',
        content: 'to indexedDb',
        color: '#FFEB3B', // A soothing yellow
        onAction: () => {
          backupDataToSafeLocation(database);
          return true;
        },
      },
    ];

    const regularCommandsFuse = new Fuse(regularCommands, {
      shouldSort: true,
      keys: ['title', 'content'],
      includeScore: true,
      threshold: 0.4,
    });

    const regularCommandsResults = regularCommandsFuse.search(
      processedCmdKSearchQuery,
    );

    const actions: CmdKSuggestion[] = [
      ...(processedCmdKSearchQuery
        ? [
            ...(workspaces.length > 0
              ? [
                  ...workspaces.slice(0, 3).map((workspace) => ({
                    type: cmdKSuggestionActionType,
                    title: `go to ${workspace.label}`,
                    content: `↓[${workspace.label}]`,
                    color: '#2196F3',
                    onAction() {
                      openWorkspace(workspace.value);
                      setCmdKSearchQuery('');
                      return false;
                    },
                  })),
                ]
              : []),

            ...(regularCommandsResults.length > 0
              ? regularCommandsResults.map((result) => result.item)
              : []),

            {
              type: cmdKSuggestionActionType,
              title: 'create new note',
              content: `"${trimmedContent}"`,
              color: '#4CAF50',
              onAction: () => {
                openNewNote(processedCmdKSearchQuery);
                setIsCmdKMenuOpen(false);
                setSelectedCmdKSuggestionIndex(0);
                setCmdKSearchQuery('');
                return true;
              },
            },
            ...(workspaces.length > 0
              ? [
                  {
                    type: cmdKSuggestionActionType,
                    title: `move note to ${workspaces[0].label}`,
                    content: `→[${workspaces[0].label}]`,
                    color: '#00BCD4',
                    onAction() {
                      if (!currentNote) {
                        console.warn('weird weird weird');
                        return true;
                      }
                      moveNoteToWorkspace(
                        currentNote,
                        workspaces[0]?.value ?? undefined,
                      );
                      setCmdKSearchQuery('');
                      return false;
                    },
                  },
                ]
              : []),

            ...(availableWorkspaces.find(
              (workspace) => workspace === processedCmdKSearchQuery,
            )
              ? currentWorkspace
                ? []
                : []
              : [
                  {
                    type: cmdKSuggestionActionType,
                    title: 'create workspace',
                    color: '#FF9800',
                    content: `+[${trimmedContent}]`,
                    onAction: () => {
                      openNewNote('', processedCmdKSearchQuery, false);
                      setSelectedCmdKSuggestionIndex(0);
                      setCurrentWorkspace(processedCmdKSearchQuery);
                      setCmdKSearchQuery('');
                      return false;
                    },
                  },
                ]),
            ...(currentWorkspace
              ? [
                  {
                    type: cmdKSuggestionActionType,
                    title: 'rename workspace',
                    content: `±[${trimmedContent}]`,
                    color: '#9C27B0',
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
                      setCmdKSearchQuery('');
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
              color: '#F44336',
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

    return [
      ...notes.map((note) => ({
        type: 'note' as const,
        note,
      })),
      ...matchingHiddenNotes.map((note) => ({
        type: 'note' as const,
        note,
      })),
      ...actions,
    ];
  }, [
    cmdKSearchQuery,
    database,
    workspaceNotes,
    availableWorkspaces,
    currentTheme,
    isUsingVim,
    isNarrowScreen,
    currentWorkspace,
    currentNoteId,
    toggleTheme,
    setIsUsingVim,
    setIsNarrowScreen,
    openWorkspace,
    openNewNote,
    moveNoteToWorkspace,
    setCurrentWorkspace,
    setDatabase,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent escape from minimizing the window
      if (e.key === 'Escape') {
        e.preventDefault();
      }

      // NO PRINT
      if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
      }

      if (isCmdKMenuOpen && e.key === 'Escape') {
        e.preventDefault();
        setIsCmdKMenuOpen(false);
        focus();
        return;
      }

      if (e.key === 'e' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsNarrowScreen(!isNarrowScreen);
        return;
      }

      const currentSuggestion = cmdKSuggestions[selectedCmdKSuggestionIndex];
      const currentSelectedNote =
        currentSuggestion.type === 'note' ? currentSuggestion.note : null;

      const vimUp = (e.ctrlKey || e.metaKey) && e.key === 'k';
      const vimDown = (e.ctrlKey || e.metaKey) && e.key === 'j';
      const vimLeft = (e.ctrlKey || e.metaKey) && e.key === 'u';
      const vimRight = (e.ctrlKey || e.metaKey) && e.key === 'i';

      if (isCmdKMenuOpen && (vimUp || vimDown || vimLeft || vimRight)) {
        setHasVimNavigated(true);
      }

      if (isCmdKMenuOpen) {
        if (
          freshlyDeletedNotes.length > 0 &&
          e.key === 'z' &&
          (e.ctrlKey || e.metaKey)
        ) {
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
        if (e.key === 'ArrowUp' || vimUp) {
          e.preventDefault();
          if (selectedCmdKSuggestionIndex === null) {
            nextIndex = length - 1;
          } else {
            nextIndex = (selectedCmdKSuggestionIndex - 1 + length) % length;
          }
          setSelectedCmdKSuggestionIndex(nextIndex);
        } else if (e.key === 'ArrowDown' || vimDown) {
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
            element.scrollIntoView({ block: 'center' });
          }
          return;
        }

        if (e.key === 'Enter' || (e.key === 'b' && (e.ctrlKey || e.metaKey))) {
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
          vimLeft || (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey)
            ? 'left'
            : vimRight || (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey)
            ? 'right'
            : null;
        if (direction) {
          e.preventDefault();
          const nextWorkspace = getNextWorkspace(direction);
          if (nextWorkspace !== currentWorkspace) {
            openWorkspace(nextWorkspace ?? null);
          }
        }

        if (currentSelectedNote) {
          if ((e.key === 'h' || e.key === 'g') && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pinNote(currentSelectedNote, !currentSelectedNote.isPinned);
            openNote(currentSelectedNote.id, false);
            setSelectedCmdKSuggestionIndex(0);
            return;
          }

          if (
            (e.ctrlKey || e.metaKey) &&
            e.key === "'" &&
            !currentSelectedNote.isPinned
          ) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.shiftKey) {
              setShouldShowHiddenNotes(!shouldShowHiddenNotes);
              console.log('hi');
            } else {
              setIsNoteHidden(
                currentSelectedNote,
                !currentSelectedNote.isHidden,
              );
            }
            return;
          }

          if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const nextWorkspace = getNextWorkspace('left');
            if (nextWorkspace !== currentWorkspace) {
              moveNoteToWorkspace(
                currentSelectedNote,
                nextWorkspace ?? undefined,
              );
              setSelectedCmdKSuggestionIndex(0);
            }
            return;
          }

          if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const nextWorkspace = getNextWorkspace('right');
            if (nextWorkspace !== currentWorkspace) {
              moveNoteToWorkspace(
                currentSelectedNote,
                nextWorkspace ?? undefined,
              );
              setSelectedCmdKSuggestionIndex(0);
            }
            return;
          }
        }

        // otherwise, just focus on the cmdk search and let the user type
        cmdKInputDomRef.current?.focus();

        return;
      }

      if (isHelpMenuOpen && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        setIsHelpMenuOpen((prev) => !prev);
        focus();
        return;
      }

      if ((e.key === 'p' || e.key === 'k') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        textareaDomRef.current?.blur();
        setSelectedCmdKSuggestionIndex(0);
        setIsCmdKMenuOpen(true);
        setIsHelpMenuOpen(false);

        if (e.shiftKey) {
          setCmdKSearchQuery('@');
        } else {
          setCmdKSearchQuery('');
        }
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
        focus();
      } else if (isUsingVim && !isCmdKMenuOpen) {
        if (document.activeElement === document.body) {
          aceEditorRef.current?.editor.focus();
        }
      }
    };

    // const handleKeyUp = (event: KeyboardEvent) => {
    //   if (
    //     hasVimNavigated &&
    //     isCmdKMenuOpen &&
    //     (event.key === 'Meta' || event.key === 'Control')
    //   ) {
    //     let shouldCloseCmdK: boolean = true;
    //     if (cmdKSuggestions.length > 0) {
    //       const suggestion = cmdKSuggestions[selectedCmdKSuggestionIndex];
    //       shouldCloseCmdK = runCmdKSuggestion(suggestion);
    //     }

    //     if (shouldCloseCmdK) {
    //       setIsCmdKMenuOpen(false);
    //     }

    //     setHasVimNavigated(false);

    //     focus();
    //   }
    // };

    window.addEventListener('keydown', handleKeyDown);
    // window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // window.removeEventListener('keyup', handleKeyUp);
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
      editor.renderer.setScrollMargin(32, 512, 0, 0);
      editor.commands.removeCommand('find');
      editor.getSession().setOption('indentedSoftWrap', false);
      editor.resize();
    }
  }, []);

  useEffect(() => {
    if (!aceEditorRef.current) return;

    const editor = aceEditorRef.current.editor;
    if (isUsingVim) {
      editor.setKeyboardHandler('ace/keyboard/vim');
    } else {
      editor.setKeyboardHandler('ace/keyboard/keybinding');
    }
  }, [isUsingVim]);

  useEffect(() => {
    const editor = aceEditorRef.current?.editor;
    editor?.renderer.setScrollMargin(32, 512, 0, 0);
  });

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? '⌘' : 'ctrl';

  return (
    <main
      style={{
        ...(isNarrowScreen
          ? {
              maxWidth: 'calc(800px + 4rem)',
              margin: '0 auto',
            }
          : {}),
      }}
    >
      <div
        style={{
          width: '100%',
          padding: '0px 2rem',
          paddingBottom: '0',
          height: '100vh',
        }}
      >
        <AceEditor
          theme={currentTheme === 'dark' ? 'clouds_midnight' : 'clouds'}
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
          }}
          fontSize="1.5rem"
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
          style={{
            lineHeight: '1.5',
            background: 'var(--note-background-color)',
            color: 'var(--dark-color)',
          }}
          placeholder="Type here..."
        />
      </div>
      <div id="controls">
        {currentWorkspace && (
          <div
            style={{
              color: 'var(--dark-color)',
              opacity: 0.5,
            }}
          >
            [{currentWorkspace}]
          </div>
        )}
        <button
          onClick={() => {
            setIsHelpMenuOpen(true);
          }}
        >
          ?
        </button>
        {isHelpMenuOpen &&
          createPortal(
            <>
              <div
                style={{
                  width: '100vw',
                  height: '100vh',
                  position: 'fixed',
                  background: 'var(--overlay-background-color)',
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
            document.body,
          )}
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
                  setIsUsingVim(!isUsingVim);
                }}
              >
                {isUsingVim ? 'no vim' : 'vim'}
              </button>
              <button
                onClick={() => {
                  setMoreMenuPosition(null);
                  toggleTheme();
                }}
              >
                {currentTheme === 'light' ? 'dark' : 'light'}
              </button>
              <button
                onClick={() => {
                  backupDataToSafeLocation(database);
                }}
              >
                backup
              </button>
              <button
                tabIndex={-1}
                onClick={async () => {
                  const compressedData = LZString.compressToEncodedURIComponent(
                    JSON.stringify(database),
                  );
                  const dataStr =
                    'data:text/json;charset=utf-8,' + compressedData;

                  // @ts-expect-error: bypass tauri
                  if (window.__TAURI__) {
                    const filePath = await save({
                      defaultPath: 'notes_export.json',
                    });
                    if (filePath) {
                      await writeTextFile(filePath, compressedData);
                    } else {
                      console.error('No file path selected');
                    }
                  } else {
                    const downloadAnchorNode = document.createElement('a');
                    downloadAnchorNode.setAttribute('href', dataStr);
                    downloadAnchorNode.setAttribute(
                      'download',
                      'notes_export.json',
                    );
                    document.body.appendChild(downloadAnchorNode);
                    downloadAnchorNode.click();
                    downloadAnchorNode.remove();
                  }
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
                      setCurrentWorkspace(null);
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
              <div
                style={{
                  height: '1px',
                  width: '100%',
                  backgroundColor: 'var(--border-color)',
                }}
              />
              <a
                href="https://github.com/shaoruu/typehere.app"
                target="_blank"
                rel="noreferrer"
              >
                <button tabIndex={-1}>github</button>
              </a>
            </div>
          </>
        )}
        {textValue && (
          <button tabIndex={-1} onClick={() => openNewNote('')}>
            new
          </button>
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
                top: '25%',
                left: '50%',
                width: '240px',
                transform: 'translateX(-50%)',
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
                ref={cmdKInputDomRef}
                placeholder="Search for note"
                value={cmdKSearchQuery}
                onChange={(e) => {
                  setCmdKSearchQuery(e.target.value);
                  setSelectedCmdKSuggestionIndex(0);
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
                className="notes-list no-scrollbar"
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
                {cmdKSuggestions.map((suggestion, index) => {
                  if (suggestion.type === 'note') {
                    const note = suggestion.note;
                    const title = getNoteTitle(note);
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
                            index === selectedCmdKSuggestionIndex
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
                            {note.isHidden && (
                              <MdVisibilityOff
                                style={{
                                  color: 'var(--hidden-color)',
                                  marginRight: '4px',
                                  fontSize: '0.8rem',
                                }}
                              />
                            )}
                            {note.isPinned && (
                              <FaMapPin
                                style={{
                                  marginRight: '4px',
                                  color: 'var(--pin-color)',
                                  fontSize: '0.8rem',
                                }}
                              />
                            )}
                            {title || 'New Note'}
                          </div>
                          <button
                            className="note-list-item-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNote(note.id);
                            }}
                            style={{
                              visibility:
                                workspaceNotes.length > 1 &&
                                index === selectedCmdKSuggestionIndex
                                  ? 'visible'
                                  : 'hidden',
                              pointerEvents:
                                workspaceNotes.length > 1 &&
                                index === selectedCmdKSuggestionIndex
                                  ? 'auto'
                                  : 'none',
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        <div
                          className="note-list-item-timestamp"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {note.workspace && (
                            <>
                              <span
                                style={{
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                  direction: 'rtl',
                                }}
                              >
                                {note.workspace}
                              </span>
                              <span>•</span>
                            </>
                          )}
                          <span>{timestamp}</span>
                        </div>
                      </div>
                    );
                  }

                  const { title, onAction, content, color } = suggestion;

                  return (
                    <div
                      id={`note-list-cmdk-item-${index}`}
                      className="note-list-item"
                      onClick={onAction}
                      style={{
                        backgroundColor:
                          index === selectedCmdKSuggestionIndex
                            ? 'var(--note-selected-background-color)'
                            : 'var(--note-background-color)',
                        position: 'relative',
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
                            position: 'absolute',
                            background: color,
                            opacity:
                              index === selectedCmdKSuggestionIndex ? 1.0 : 0.5,
                          }}
                        ></div>
                      )}
                      <div className="note-list-item-top">
                        <div
                          className="note-list-item-title"
                          style={{
                            fontWeight: 'normal',
                            fontStyle: 'normal',
                            color: 'var(--dark-color)',
                          }}
                        >
                          {title}
                        </div>
                        <p
                          style={{
                            marginLeft: '4px',
                            fontSize: '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '1px 4px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            color: 'var(--on-fill-color)',
                            background: 'var(--keyboard-key-color)',
                            borderRight: '2px solid var(--border-color)',
                            borderBottom: '2px solid var(--border-color)',
                            borderLeft: 'none',
                            borderTop: 'none',
                            visibility:
                              index === selectedCmdKSuggestionIndex
                                ? 'visible'
                                : 'hidden',
                          }}
                        >
                          Enter{' '}
                          <span
                            style={{
                              marginLeft: '4px',
                              marginBottom: '1px',
                            }}
                          >
                            ↵
                          </span>
                        </p>
                      </div>
                      <div
                        className="note-list-item-timestamp"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
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
                  outline: 'none',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  borderTop: '1px solid var(--border-color)',
                  color: 'var(--dark-color)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  opacity: 0.6,
                }}
              >
                {currentWorkspace
                  ? `workspace: [${currentWorkspace}]`
                  : `all notes`}
              </div>
            </div>
          </>,
          document.body,
        )}
    </main>
  );
}

export default App;
