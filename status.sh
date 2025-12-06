#!/bin/bash

# Copy Trading Bot - Status Script
# This script shows the current status of the bot

echo "========================================="
echo "   Copy Trading Bot - Status"
echo "========================================="
echo ""

# Navigate to bot directory
cd "$(dirname "$0")"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ ERROR: PM2 is not installed!"
    exit 1
fi

# Show status
pm2 describe copybot 2>/dev/null

if [ $? -ne 0 ]; then
    echo "⚠️  Bot is not running!"
    echo ""
    echo "To start the bot, use: ./start.sh"
    exit 1
fi

echo ""
echo "Useful commands:"
echo "  View logs:   ./logs.sh"
echo "  Stop bot:    ./stop.sh"
echo "  Restart bot: ./restart.sh"
echo ""
