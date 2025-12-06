#!/bin/bash

# Copy Trading Bot - Start Script
# This script starts the bot using PM2

echo "========================================="
echo "   Starting Copy Trading Bot"
echo "========================================="
echo ""

# Navigate to bot directory
cd "$(dirname "$0")"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ ERROR: PM2 is not installed!"
    echo "Please install PM2 first: npm install -g pm2"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ ERROR: .env file not found!"
    echo "Please create a .env file with your configuration"
    exit 1
fi

# Check if bot exists and is running
if pm2 describe copybot &> /dev/null; then
    BOT_STATUS=$(pm2 jlist | grep -o '"name":"copybot","pm2_env":{"status":"[^"]*"' | grep -o 'status":"[^"]*' | cut -d'"' -f3)

    if [ "$BOT_STATUS" = "online" ]; then
        echo "⚠️  Bot is already running!"
        echo ""
        echo "To restart the bot, use: ./restart.sh"
        echo "To view logs, use: ./logs.sh"
        echo "To check status, use: ./status.sh"
        exit 1
    else
        echo "🔄 Bot exists but is stopped. Removing and starting fresh..."
        pm2 delete copybot &> /dev/null
    fi
fi

# Start the bot
echo "🚀 Starting the bot..."
pm2 start ecosystem.config.cjs

# Save PM2 process list
pm2 save

echo ""
echo "✅ Bot started successfully!"
echo ""
echo "Useful commands:"
echo "  View logs:    ./logs.sh"
echo "  Check status: ./status.sh"
echo "  Stop bot:     ./stop.sh"
echo "  Restart bot:  ./restart.sh"
echo ""
