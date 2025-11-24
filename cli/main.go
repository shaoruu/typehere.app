package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/sahilm/fuzzy"
)

const (
	typehereDir  = ".typehere"
	notesDir     = "notes"
	editingDir   = "editing"
	saltFile     = ".salt"
	metadataFile = ".metadata.enc"
	idMapFile    = ".id-map.enc"
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("250"))

	selectedStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("0")).
			Background(lipgloss.Color("250"))

	helpStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("240"))

	errorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("9"))

	boxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("240")).
			Padding(1, 2).
			Width(50)

	searchBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("240")).
			Padding(0, 1)
)

type Note struct {
	ID        string    `json:"id"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	IsPinned  bool      `json:"isPinned"`
	IsHidden  bool      `json:"isHidden"`
	Workspace string    `json:"workspace,omitempty"`
}

type Metadata struct {
	Notes map[string]NoteMetadata `json:"notes"`
}

type NoteMetadata struct {
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	IsPinned  bool      `json:"isPinned"`
	IsHidden  bool      `json:"isHidden"`
	Workspace string    `json:"workspace,omitempty"`
}

type state int

const (
	passwordView state = iota
	noteListView
)

type model struct {
	state         state
	passwordInput textinput.Model
	searchInput   textinput.Model
	notes         []Note
	filteredNotes []Note
	metadata      Metadata
	encryptionKey []byte
	cursor        int
	width         int
	height        int
	err           error
	searchFocused bool
}

func initialModel() model {
	pi := textinput.New()
	pi.Placeholder = "Enter master password"
	pi.EchoMode = textinput.EchoPassword
	pi.Focus()

	si := textinput.New()
	si.Placeholder = "Search notes..."
	si.CharLimit = 100

	return model{
		state:         passwordView,
		passwordInput: pi,
		searchInput:   si,
	}
}

func (m model) Init() tea.Cmd {
	return textinput.Blink
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch m.state {
		case passwordView:
			switch msg.String() {
			case "ctrl+c", "esc":
				return m, tea.Quit
			case "enter":
				password := m.passwordInput.Value()
				if err := m.loadNotes(password); err != nil {
					m.err = err
					return m, nil
				}
				m.state = noteListView
				m.searchInput.Blur()
				m.searchFocused = false
				return m, nil
			}
			var cmd tea.Cmd
			m.passwordInput, cmd = m.passwordInput.Update(msg)
			return m, cmd

		case noteListView:
			switch msg.String() {
			case "ctrl+c", "esc":
				return m, tea.Quit
			case "ctrl+n":
				m.createNewNote()
				return m, tea.Quit
			case "enter":
				if len(m.filteredNotes) > 0 && m.cursor < len(m.filteredNotes) {
					m.openNoteInVim(m.filteredNotes[m.cursor])
					return m, tea.Quit
				}
			case "up":
				if m.searchFocused {
					m.searchFocused = false
					m.searchInput.Blur()
				} else if m.cursor > 0 {
					m.cursor--
				}
			case "down":
				if m.searchFocused {
					m.searchFocused = false
					m.searchInput.Blur()
				} else if m.cursor < len(m.filteredNotes)-1 {
					m.cursor++
				}
			case "tab":
				m.searchFocused = !m.searchFocused
				if m.searchFocused {
					m.searchInput.Focus()
				} else {
					m.searchInput.Blur()
				}
			case "/":
				if !m.searchFocused {
					m.searchFocused = true
					m.searchInput.Focus()
				}
			default:
				if m.searchFocused {
					var cmd tea.Cmd
					m.searchInput, cmd = m.searchInput.Update(msg)
					m.filterNotes()
					m.cursor = 0
					return m, cmd
				} else if len(msg.String()) == 1 {
					m.searchFocused = true
					m.searchInput.Focus()
					var cmd tea.Cmd
					m.searchInput, cmd = m.searchInput.Update(msg)
					m.filterNotes()
					m.cursor = 0
					return m, cmd
				}
			}
		}
	}

	return m, nil
}

func (m model) View() string {
	if m.width == 0 {
		return ""
	}

	switch m.state {
	case passwordView:
		return m.passwordView()
	case noteListView:
		return m.noteListView()
	}
	return ""
}

func (m model) passwordView() string {
	var content strings.Builder

	content.WriteString(titleStyle.Render("Type Here"))
	content.WriteString("\n\n")

	if m.err != nil {
		content.WriteString(errorStyle.Render(m.err.Error()))
		content.WriteString("\n\n")
	}

	content.WriteString("Enter master password:\n\n")
	content.WriteString(m.passwordInput.View())
	content.WriteString("\n\n")
	content.WriteString(helpStyle.Render("Press Enter to continue, Esc to quit"))

	box := boxStyle.Render(content.String())

	// Center the box
	height := m.height
	width := m.width
	boxHeight := lipgloss.Height(box)
	boxWidth := lipgloss.Width(box)

	verticalPadding := (height - boxHeight) / 2
	horizontalPadding := (width - boxWidth) / 2

	if verticalPadding < 0 {
		verticalPadding = 0
	}
	if horizontalPadding < 0 {
		horizontalPadding = 0
	}

	return lipgloss.Place(
		width,
		height,
		lipgloss.Center,
		lipgloss.Center,
		box,
	)
}

func (m model) noteListView() string {
	// Calculate available height for the list
	// Title (1 line) + padding (1) + search box (3 lines) + padding (1) + help (1) + padding (2) = 9 lines
	listHeight := m.height - 9
	if listHeight < 1 {
		listHeight = 1
	}

	var s strings.Builder

	s.WriteString("\n\n")
	s.WriteString(titleStyle.Render("Type Here"))
	s.WriteString("\n\n")

	// Make search box full width
	searchWidth := m.width - 4
	if searchWidth < 20 {
		searchWidth = 20
	}
	fullWidthSearchStyle := searchBoxStyle.Copy().Width(searchWidth)
	searchBox := fullWidthSearchStyle.Render(m.searchInput.View())
	s.WriteString(searchBox)
	s.WriteString("\n\n")

	// Calculate which notes to show
	start := m.cursor - listHeight/2
	if start < 0 {
		start = 0
	}
	end := start + listHeight
	if end > len(m.filteredNotes) {
		end = len(m.filteredNotes)
		start = end - listHeight
		if start < 0 {
			start = 0
		}
	}

	// Always render full height list
	linesRendered := 0
	if len(m.filteredNotes) == 0 {
		s.WriteString(helpStyle.Render("No notes found"))
		s.WriteString("\n")
		linesRendered = 1
	} else {
		for i := start; i < end && i < len(m.filteredNotes); i++ {
			note := m.filteredNotes[i]
			title := getNoteTitle(note)
			timestamp := formatDateCompact(note.UpdatedAt)

			line := fmt.Sprintf("%s (%s)", title, timestamp)

			if i == m.cursor {
				s.WriteString(selectedStyle.Render(line))
			} else {
				s.WriteString(line)
			}
			s.WriteString("\n")
			linesRendered++
		}
	}

	// Fill remaining space with empty lines to keep height consistent
	for linesRendered < listHeight {
		s.WriteString("\n")
		linesRendered++
	}

	s.WriteString("\n")
	s.WriteString(helpStyle.Render("[↑↓] Navigate [Enter] Open [Type] Search [Ctrl+N] New [Esc] Exit"))

	return s.String()
}

func (m *model) loadNotes(password string) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	baseDir := filepath.Join(homeDir, typehereDir)

	saltPath := filepath.Join(baseDir, saltFile)
	saltBytes, err := os.ReadFile(saltPath)
	if err != nil {
		return fmt.Errorf("no encrypted notes found")
	}

	m.encryptionKey = deriveKey(password, string(saltBytes))

	idMapPath := filepath.Join(baseDir, idMapFile)
	if _, err := os.Stat(idMapPath); os.IsNotExist(err) {
		m.notes = []Note{}
		m.filteredNotes = []Note{}
		return nil
	}

	encryptedIdMap, err := os.ReadFile(idMapPath)
	if err != nil {
		return err
	}

	idMapJSON, err := decrypt(encryptedIdMap, m.encryptionKey)
	if err != nil {
		return fmt.Errorf("incorrect password")
	}

	var idMap map[string]string
	if err := json.Unmarshal([]byte(idMapJSON), &idMap); err != nil {
		return err
	}

	m.metadata = Metadata{Notes: make(map[string]NoteMetadata)}
	metadataPath := filepath.Join(baseDir, metadataFile)
	if _, err := os.Stat(metadataPath); err == nil {
		encryptedMetadata, err := os.ReadFile(metadataPath)
		if err == nil {
			metadataJSON, err := decrypt(encryptedMetadata, m.encryptionKey)
			if err == nil {
				json.Unmarshal([]byte(metadataJSON), &m.metadata)
			}
		}
	}

	m.notes = []Note{}
	notesPath := filepath.Join(baseDir, notesDir)
	for noteID, hashedFilename := range idMap {
		notePath := filepath.Join(notesPath, hashedFilename+".enc")
		encryptedContent, err := os.ReadFile(notePath)
		if err != nil {
			continue
		}

		content, err := decrypt(encryptedContent, m.encryptionKey)
		if err != nil {
			continue
		}

		meta := m.metadata.Notes[noteID]
		note := Note{
			ID:        noteID,
			Content:   content,
			CreatedAt: meta.CreatedAt,
			UpdatedAt: meta.UpdatedAt,
			IsPinned:  meta.IsPinned,
			IsHidden:  meta.IsHidden,
			Workspace: meta.Workspace,
		}
		m.notes = append(m.notes, note)
	}

	sort.Slice(m.notes, func(i, j int) bool {
		return m.notes[i].UpdatedAt.After(m.notes[j].UpdatedAt)
	})

	// Initially show only visible notes
	m.filteredNotes = []Note{}
	for _, note := range m.notes {
		if !note.IsHidden {
			m.filteredNotes = append(m.filteredNotes, note)
		}
	}
	return nil
}

func (m *model) filterNotes() {
	query := m.searchInput.Value()

	const hiddenNotesMatchLength = 5

	// Filter visible notes
	visibleNotes := []Note{}
	for _, note := range m.notes {
		if !note.IsHidden {
			visibleNotes = append(visibleNotes, note)
		}
	}

	// Check for matching hidden notes
	matchingHiddenNotes := []Note{}
	if query != "" {
		queryLower := strings.ToLower(query)
		for _, note := range m.notes {
			if !note.IsHidden {
				continue
			}
			titleLower := strings.ToLower(getNoteTitle(note))

			if len(query) >= hiddenNotesMatchLength {
				if strings.HasPrefix(titleLower, queryLower) {
					matchingHiddenNotes = append(matchingHiddenNotes, note)
				}
			} else if titleLower == queryLower {
				matchingHiddenNotes = append(matchingHiddenNotes, note)
			}
		}
	}

	if query == "" {
		m.filteredNotes = visibleNotes
		return
	}

	var titles []string
	noteMap := make(map[string]Note)
	for _, note := range visibleNotes {
		title := getNoteTitle(note)
		titles = append(titles, title)
		noteMap[title] = note
	}

	matches := fuzzy.Find(query, titles)
	m.filteredNotes = matchingHiddenNotes
	for _, match := range matches {
		m.filteredNotes = append(m.filteredNotes, noteMap[match.Str])
	}
}

func (m *model) openNoteInVim(note Note) {
	homeDir, _ := os.UserHomeDir()
	editingPath := filepath.Join(homeDir, typehereDir, editingDir)
	os.MkdirAll(editingPath, 0700)

	// Use a cleaner filename with just the note title
	title := getNoteTitle(note)
	// Clean the title for use as filename
	cleanTitle := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' {
			return '-'
		}
		return r
	}, title)

	// Limit length
	if len(cleanTitle) > 50 {
		cleanTitle = cleanTitle[:50]
	}

	tmpFile := filepath.Join(editingPath, fmt.Sprintf("%s.md", cleanTitle))
	os.WriteFile(tmpFile, []byte(note.Content), 0600)
	defer os.Remove(tmpFile)

	cmd := exec.Command("vim", tmpFile)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Run()

	newContent, err := os.ReadFile(tmpFile)
	if err != nil {
		return
	}

	if string(newContent) != note.Content {
		m.saveNote(note.ID, string(newContent))
	}
}

func (m *model) createNewNote() {
	homeDir, _ := os.UserHomeDir()
	editingPath := filepath.Join(homeDir, typehereDir, editingDir)
	os.MkdirAll(editingPath, 0700)

	noteID := generateID()
	tmpFile := filepath.Join(editingPath, "untitled.md")
	os.WriteFile(tmpFile, []byte(""), 0600)
	defer os.Remove(tmpFile)

	cmd := exec.Command("vim", tmpFile)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Run()

	content, err := os.ReadFile(tmpFile)
	if err != nil {
		return
	}

	m.saveNote(noteID, string(content))

	now := time.Now()
	m.metadata.Notes[noteID] = NoteMetadata{
		CreatedAt: now,
		UpdatedAt: now,
		IsPinned:  false,
		IsHidden:  false,
	}
	m.saveMetadata()
}

func (m *model) saveNote(noteID, content string) {
	homeDir, _ := os.UserHomeDir()
	baseDir := filepath.Join(homeDir, typehereDir)

	idMapPath := filepath.Join(baseDir, idMapFile)
	var idMap map[string]string

	if data, err := os.ReadFile(idMapPath); err == nil {
		if idMapJSON, err := decrypt(data, m.encryptionKey); err == nil {
			json.Unmarshal([]byte(idMapJSON), &idMap)
		}
	}

	if idMap == nil {
		idMap = make(map[string]string)
	}

	hashedFilename, ok := idMap[noteID]
	if !ok {
		hashedFilename = hashNoteID(noteID)
		idMap[noteID] = hashedFilename
		idMapJSON, _ := json.Marshal(idMap)
		encryptedIdMap := encrypt(string(idMapJSON), m.encryptionKey)
		os.WriteFile(idMapPath, []byte(encryptedIdMap), 0600)
	}

	notePath := filepath.Join(baseDir, notesDir, hashedFilename+".enc")
	encryptedContent := encrypt(content, m.encryptionKey)
	os.WriteFile(notePath, []byte(encryptedContent), 0600)

	if meta, ok := m.metadata.Notes[noteID]; ok {
		meta.UpdatedAt = time.Now()
		m.metadata.Notes[noteID] = meta
	}
	m.saveMetadata()
}

func (m *model) saveMetadata() {
	homeDir, _ := os.UserHomeDir()
	baseDir := filepath.Join(homeDir, typehereDir)
	metadataPath := filepath.Join(baseDir, metadataFile)

	metadataJSON, _ := json.Marshal(m.metadata)
	encryptedMetadata := encrypt(string(metadataJSON), m.encryptionKey)
	os.WriteFile(metadataPath, []byte(encryptedMetadata), 0600)
}

func getNoteTitle(note Note) string {
	lines := strings.Split(strings.TrimSpace(note.Content), "\n")
	if len(lines) > 0 && lines[0] != "" {
		title := lines[0]
		if len(title) > 80 {
			title = title[:80] + "..."
		}
		return title
	}
	return "New Note"
}

func formatDateCompact(t time.Time) string {
	if t.IsZero() {
		return "unknown"
	}

	now := time.Now()
	diff := now.Sub(t)
	days := int(diff.Hours() / 24)

	if days == 0 {
		return t.Format("3:04pm")
	} else if days == 1 {
		return "yesterday"
	} else if days < 7 {
		return fmt.Sprintf("%dd ago", days)
	} else {
		return t.Format("Jan2")
	}
}

func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

func main() {
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
}
