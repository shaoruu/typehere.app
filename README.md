# TypeHere: A Powerful Textarea

A textarea with vim

<img width="2560" alt="image" src="https://github.com/shaoruu/typehere.app/assets/35216312/4fdcbb50-6d84-48f4-88d8-07e5f3547a92">

## Inspirations

I used to use typehere.co a lot until the site was taken down, so I created [typehere.app](https://typehere.app). For a long while, it was also just a textarea that saved its contents to `localStorage`, but recently I've decided to add more features that I would find useful myself.

## Features

- Toggleable vim
- Multiple notes
- A bunch of keyboard shortcuts 
- Fast navigation with cmd+K menu
- Light/dark theme
- Everything client-side, all in `localStorage`
- Periodically backed up to `indexDB` (also on ur laptop)

## Keyboard Shortcuts

<i>For the most up-to-date keyboard shortcuts, press <b>?</b> on bottom right</i>

- <kbd>⌘/⌃</kbd> + <kbd>k/p</kbd>: Open notes search
- <kbd>⌘/⌃</kbd> + <kbd>m/slash</kbd>: Open notes list 
- <kbd>⌘/⌃</kbd> + <kbd>⇧</kbd> + <kbd>↵</kbd>: Create new note
- <kbd>⌘/⌃</kbd> + <kbd>i</kbd>: Toggle narrow screen
- <kbd>⌘/⌃</kbd> + <kbd>j/k</kbd> or <kbd>↑↓</kbd>: Navigate in lists

## Things to Add/Do

- Passport protected notes
- Quick workspaces to switch context
- Clean up code, right now `App.tsx` has 600+ lines
