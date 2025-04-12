FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Install Node.js using nvm to match the project's node version
RUN apt-get update && apt-get install -y curl
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Install additional dependencies for Electron
RUN apt-get update && apt-get install -y \
    libgtk-3-0 \
    libnotify-dev \
    libgconf-2-4 \
    libnss3 \
    libxss1 \
    libasound2 \
    libxtst6 \
    xauth \
    xvfb 