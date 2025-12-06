#!/bin/bash

# Copy Trading Bot - Restart Script
# This script restarts the bot and reloads environment variables

echo "========================================="
echo "   Restarting Copy Trading Bot"
echo "========================================="
echo ""

# Navigate to bot directory
cd "$(dirname "$0")"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ ERROR: PM2 is not installed!"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ ERROR: .env file not found!"
    exit 1
fi

# Check if bot is running
if ! pm2 describe copybot &> /dev/null; then
    echo "⚠️  Bot is not running. Starting it instead..."
    ./start.sh
    exit 0
fi

# Delete and restart to ensure fresh env reload
echo "🔄 Restarting bot with fresh environment variables..."
pm2 delete copybot
pm2 start ecosystem.config.cjs

# Save PM2 process list
pm2 save

echo ""
echo "✅ Bot restarted successfully!"
echo "   All environment variables have been reloaded from .env"
echo ""
echo "Useful commands:"
echo "  View logs:    ./logs.sh"
echo "  Check status: ./status.sh"
echo ""
