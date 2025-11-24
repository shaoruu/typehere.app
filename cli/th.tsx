import React, { useState, useEffect, useMemo } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import Fuse from "fuse.js";
import { generateSalt, deriveKey, encrypt, decrypt, hashNoteId } from "./crypto.js";

const TYPEHERE_DIR = path.join(os.homedir(), ".typehere");
const NOTES_DIR = path.join(TYPEHERE_DIR, "notes");
const SALT_FILE = path.join(TYPEHERE_DIR, ".salt");
const METADATA_FILE = path.join(TYPEHERE_DIR, ".metadata.enc");
const ID_MAP_FILE = path.join(TYPEHERE_DIR, ".id-map.enc");

interface Note {
  id: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  isPinned?: boolean;
  isHidden?: boolean;
  workspace?: string;
}

interface NoteMetadata {
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  isHidden: boolean;
  workspace?: string;
}

interface Metadata {
  notes: Record<string, NoteMetadata>;
}

function ensureTypehereDir(): void {
  if (!fs.existsSync(TYPEHERE_DIR)) {
    fs.mkdirSync(TYPEHERE_DIR, { recursive: true });
  }
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
  }
}

function getSalt(): string {
  ensureTypehereDir();
  if (!fs.existsSync(SALT_FILE)) {
    const salt = generateSalt();
    fs.writeFileSync(SALT_FILE, salt, "utf8");
    return salt;
  }
  return fs.readFileSync(SALT_FILE, "utf8");
}

function loadNotes(encryptionKey: string): { notes: Note[]; metadata: Metadata } {
  try {
    if (!fs.existsSync(ID_MAP_FILE)) {
      return { notes: [], metadata: { notes: {} } };
    }

    const encryptedIdMap = fs.readFileSync(ID_MAP_FILE, "utf8");
    const idMapJson = decrypt(encryptedIdMap, encryptionKey);
    const idMap: Record<string, string> = JSON.parse(idMapJson);

    let metadataObj: Metadata = { notes: {} };
    if (fs.existsSync(METADATA_FILE)) {
      const encryptedMetadata = fs.readFileSync(METADATA_FILE, "utf8");
      const metadataJson = decrypt(encryptedMetadata, encryptionKey);
      metadataObj = JSON.parse(metadataJson);
    }

    const notes: Note[] = [];
    for (const [noteId, hashedFilename] of Object.entries(idMap)) {
      const notePath = path.join(NOTES_DIR, `${hashedFilename}.enc`);
      if (fs.existsSync(notePath)) {
        const encryptedContent = fs.readFileSync(notePath, "utf8");
        const content = decrypt(encryptedContent, encryptionKey);
        const metadata = metadataObj.notes[noteId] || {};
        notes.push({
          id: noteId,
          content,
          ...metadata,
        });
      }
    }

    notes.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });

    return { notes, metadata: metadataObj };
  } catch (error) {
    throw new Error("Incorrect password or corrupted files");
  }
}

function saveNote(noteId: string, content: string, encryptionKey: string): void {
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
}

function updateMetadata(metadata: Metadata, encryptionKey: string): void {
  const metadataJson = JSON.stringify(metadata);
  const encryptedMetadata = encrypt(metadataJson, encryptionKey);
  fs.writeFileSync(METADATA_FILE, encryptedMetadata, "utf8");
}

function getNoteTitle(note: Note): string {
  const firstLineBreakIndex = note.content.trim().indexOf("\n");
  const title = note.content.substring(
    0,
    firstLineBreakIndex === -1 ? undefined : firstLineBreakIndex + 1
  );
  return title.trim() || "New Note";
}

function formatDateCompact(dateStr: string | undefined): string {
  if (!dateStr) return "unknown";
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
}

function openNoteInVim(note: Note, encryptionKey: string, metadata: Metadata): boolean {
  const tempFile = path.join(os.tmpdir(), `typehere-${note.id}.md`);

  try {
    fs.writeFileSync(tempFile, note.content, "utf8");
    spawnSync("vim", [tempFile], { stdio: "inherit" });
    const newContent = fs.readFileSync(tempFile, "utf8");

    if (newContent !== note.content) {
      saveNote(note.id, newContent, encryptionKey);

      if (!metadata.notes[note.id]) {
        metadata.notes[note.id] = {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isPinned: false,
          isHidden: false,
        };
      }
      metadata.notes[note.id].updatedAt = new Date().toISOString();
      updateMetadata(metadata, encryptionKey);
    }

    fs.unlinkSync(tempFile);
    return true;
  } catch (error) {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    return false;
  }
}

function createNewNote(encryptionKey: string, metadata: Metadata, workspace = ""): boolean {
  const noteId = Math.random().toString(36).substring(2);
  const now = new Date().toISOString();

  if (!metadata.notes) {
    metadata.notes = {};
  }

  metadata.notes[noteId] = {
    createdAt: now,
    updatedAt: now,
    isPinned: false,
    isHidden: false,
    workspace: workspace || undefined,
  };

  const tempFile = path.join(os.tmpdir(), `typehere-${noteId}.md`);

  try {
    fs.writeFileSync(tempFile, "", "utf8");
    spawnSync("vim", [tempFile], { stdio: "inherit" });
    const content = fs.readFileSync(tempFile, "utf8");
    saveNote(noteId, content, encryptionKey);
    updateMetadata(metadata, encryptionKey);
    fs.unlinkSync(tempFile);
    return true;
  } catch (error) {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    return false;
  }
}

function filterNotes(notes: Note[], query: string, shouldShowHidden = false): Note[] {
  const hiddenNotesMatchLength = 5;

  let visibleNotes = notes;
  if (!shouldShowHidden) {
    visibleNotes = notes.filter((note) => !note.isHidden);
  }

  const matchingHiddenNotes = notes.filter((note) => {
    if (shouldShowHidden || !note.isHidden) {
      return false;
    }
    const noteTitleLower = getNoteTitle(note).toLowerCase();
    const queryLower = query.toLowerCase();
    return (
      note.isHidden &&
      query.length &&
      (query.length >= hiddenNotesMatchLength
        ? noteTitleLower.startsWith(queryLower)
        : noteTitleLower === queryLower)
    );
  });

  if (!query) {
    return [...matchingHiddenNotes, ...visibleNotes];
  }

  const notesWithTitle = visibleNotes.map((note) => ({
    ...note,
    title: getNoteTitle(note),
  }));

  const fuse = new Fuse(notesWithTitle, {
    keys: [
      { name: "content", weight: 1 },
      { name: "title", weight: 0.6 },
    ],
    includeScore: true,
    threshold: 0.2,
  });

  const results = fuse.search(query).map((result) => result.item);
  return [...matchingHiddenNotes, ...results];
}

interface PasswordPromptProps {
  onSubmit: (password: string) => void;
}

function PasswordPrompt({ onSubmit }: PasswordPromptProps): JSX.Element {
  const [password, setPassword] = useState("");
  const { exit } = useApp();

  useInput((input: string, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Enter master password:
        </Text>
      </Box>
      <TextInput
        value={password}
        onChange={setPassword}
        onSubmit={() => onSubmit(password)}
        mask="*"
      />
    </Box>
  );
}

interface NoteListProps {
  notes: Note[];
  metadata: Metadata;
  encryptionKey: string;
}

function NoteList({ notes, metadata, encryptionKey }: NoteListProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [shouldReload, setShouldReload] = useState(false);
  const { exit } = useApp();

  const filteredNotes = useMemo(() => filterNotes(notes, searchQuery), [notes, searchQuery]);

  useEffect(() => {
    if (selectedIndex >= filteredNotes.length && filteredNotes.length > 0) {
      setSelectedIndex(filteredNotes.length - 1);
    } else if (filteredNotes.length === 0) {
      setSelectedIndex(0);
    }
  }, [filteredNotes.length, selectedIndex]);

  useInput((input: string, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    if (key.ctrl && input === "n") {
      exit();
      createNewNote(encryptionKey, metadata);
      setShouldReload(true);
      return;
    }

    if (isSearchFocused) {
      if (key.downArrow || key.upArrow) {
        setIsSearchFocused(false);
      }
    } else {
      if (key.downArrow || input === "j") {
        setSelectedIndex((prev) => Math.min(prev + 1, filteredNotes.length - 1));
      } else if (key.upArrow || input === "k") {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (key.return && filteredNotes[selectedIndex]) {
        exit();
        openNoteInVim(filteredNotes[selectedIndex], encryptionKey, metadata);
        setShouldReload(true);
      } else if (input === "/" || (key.ctrl && input === "s")) {
        setIsSearchFocused(true);
      } else if (input.length === 1 && !key.ctrl && !key.meta) {
        setSearchQuery((prev) => prev + input);
        setIsSearchFocused(true);
      }
    }
  });

  if (shouldReload) {
    return <Text>Reloading...</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Type Here
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Search: </Text>
        <TextInput
          value={searchQuery}
          onChange={setSearchQuery}
          focus={isSearchFocused}
          onSubmit={() => setIsSearchFocused(false)}
        />
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {filteredNotes.length === 0 ? (
          <Text color="gray">No notes found</Text>
        ) : (
          filteredNotes.map((note, index) => {
            const title = getNoteTitle(note);
            const workspace = note.workspace ? ` [${note.workspace}]` : "";
            const timestamp = formatDateCompact(note.updatedAt || note.createdAt);
            const isSelected = index === selectedIndex && !isSearchFocused;

            return (
              <Box key={note.id}>
                <Text
                  color={isSelected ? "black" : "white"}
                  backgroundColor={isSelected ? "blue" : undefined}
                >
                  {title}
                  {workspace} ({timestamp})
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box>
        <Text color="gray">[↑↓/jk] Navigate [Enter] Open [/] Search [Ctrl+N] New [Esc/q] Exit</Text>
      </Box>
    </Box>
  );
}

function App(): JSX.Element {
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesData, setNotesData] = useState<{ notes: Note[]; metadata: Metadata } | null>(null);
  const { exit } = useApp();

  const handlePasswordSubmit = (password: string): void => {
    const salt = getSalt();
    const key = deriveKey(password, salt);

    try {
      const data = loadNotes(key);
      setEncryptionKey(key);
      setNotesData(data);
    } catch (err) {
      setError("Incorrect password or corrupted files. To reset: rm -rf ~/.typehere");
      setTimeout(() => exit(), 2000);
    }
  };

  if (error) {
    return (
      <Box padding={1}>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!encryptionKey || !notesData) {
    return <PasswordPrompt onSubmit={handlePasswordSubmit} />;
  }

  return (
    <NoteList notes={notesData.notes} metadata={notesData.metadata} encryptionKey={encryptionKey} />
  );
}

function main(): void {
  ensureTypehereDir();

  if (!fs.existsSync(NOTES_DIR) || !fs.existsSync(SALT_FILE)) {
    console.error("No encrypted notes found. Run the Electron app first to sync.");
    process.exit(1);
  }

  render(<App />);
}

main();
