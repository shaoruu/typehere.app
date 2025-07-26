#!/bin/bash

# Set up node using nvm if .nvmrc exists
if [ -f .nvmrc ]; then
  echo "Using Node.js version specified in .nvmrc"
  source ~/.nvm/nvm.sh
  nvm install
  nvm use
else
  echo "No .nvmrc found, using default Node.js version"
  source ~/.nvm/nvm.sh
  nvm install node
  nvm use node
fi

# Install yarn if not already installed
if ! command -v yarn &> /dev/null; then
  echo "Installing yarn..."
  npm install -g yarn
fi

# Install dependencies
echo "Installing project dependencies..."
pnpm install

echo "Update complete!" 