#!/bin/bash

# Copy Trading Bot - Stop Script
# This script stops the bot

echo "========================================="
echo "   Stopping Copy Trading Bot"
echo "========================================="
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
    exit 1
fi

# Stop the bot
echo "🛑 Stopping the bot..."
pm2 stop copybot

# Save PM2 process list
pm2 save

echo ""
echo "✅ Bot stopped successfully!"
echo ""
echo "To start the bot again, use: ./start.sh"
echo ""
