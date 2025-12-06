#!/bin/bash

# Copy Trading Bot - Logs Script
# This script shows real-time logs from the bot

echo "========================================="
echo "   Copy Trading Bot - Live Logs"
echo "========================================="
echo ""
echo "Press Ctrl+C to exit log view"
echo ""

# Navigate to bot directory
cd "$(dirname "$0")"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ ERROR: PM2 is not installed!"
    exit 1
fi

# Check if bot is running
if ! pm2 describe copybot &> /dev/null; then
    echo "⚠️  Bot is not running!"
    echo ""
    echo "To start the bot, use: ./start.sh"
    exit 1
fi

# Show logs
pm2 logs copybot
