#!/usr/bin/env sh

set -e

if [ ! -d nocturne_image.zip ]; then
  echo "nocturne_image is missing"
  exit 1
fi

if [ ! -f ./flashthing-cli ]; then
  ARCH=$(uname -m)
  OS=$(uname -s)
  if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "x86_64" ]; then
      echo "Downloading flashthing-cli-macos-x86_64"
      URL="https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-macos-x86_64"
    elif [ "$ARCH" = "arm64" ]; then
      echo "Downloading flashthing-cli-macos-arm64"
      URL="https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-macos-aarch64"
    else
      echo "Unsupported architecture: $ARCH"
      exit 1
    fi
  elif [ "$OS" = "Linux" ]; then
    if [ "$ARCH" = "x86_64" ]; then
      echo "Downloading flashthing-cli-linux-x86_64"
      URL="https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-linux-x86_64"
    elif [ "$ARCH" = "aarch64" ]; then
      echo "Downloading flashthing-cli-linux-aarch64"
      URL="https://github.com/JoeyEamigh/flashthing/releases/latest/download/flashthing-cli-linux-aarch64"
    else
      echo "Unsupported architecture: $ARCH"
      exit 1
    fi
  else
    echo "Unsupported operating system: $OS"
    exit 1
  fi

  if command -v wget > /dev/null 2>&1; then
    wget -O flashthing-cli "$URL"
  elif command -v curl > /dev/null 2>&1; then
    curl -Lo flashthing-cli "$URL"
  else
    echo "wget or curl is installed. Please install one to proceed."
    exit 1
  fi

  if [ -f ./flashthing-cli ]; then
    echo "Download complete"
  else
    echo "Failed to download flashthing-cli"
    exit 1
  fi

  chmod +x flashthing-cli
fi

if [ -z "$1" ]; then
  echo "This script will flash Nocturne onto your Car Thing. Continue? (y/n)"
  read -r answer
  if [ "$answer" != "y" ]; then
    echo "Aborting."
    exit 1
  fi
fi

./flashthing-cli ./nocturne_image
