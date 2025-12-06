#!/bin/bash

# Copy Trading Bot - One-Time Setup Script
# This script sets up PM2 and log rotation for the bot

echo "========================================="
echo "   Copy Trading Bot - Initial Setup"
echo "========================================="
echo ""

# Navigate to bot directory
cd "$(dirname "$0")"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ ERROR: Node.js is not installed!"
    echo "Please install Node.js first: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ ERROR: npm is not installed!"
    exit 1
fi

echo "✅ npm found: $(npm --version)"
echo ""

# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2 globally..."
    npm install -g pm2

    if [ $? -ne 0 ]; then
        echo "❌ Failed to install PM2!"
        exit 1
    fi

    echo "✅ PM2 installed successfully!"
else
    echo "✅ PM2 already installed: $(pm2 --version)"
fi

echo ""

# Install node_modules if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing bot dependencies..."
    npm install

    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies!"
        exit 1
    fi

    echo "✅ Dependencies installed successfully!"
else
    echo "✅ Bot dependencies already installed"
fi

echo ""

# Setup PM2 log rotation
echo "🔄 Setting up daily log rotation..."
pm2 install pm2-logrotate 2>/dev/null

# Configure log rotation
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:dateFormat 'YYYY-MM-DD'

echo "✅ Log rotation configured!"
echo "   - Logs rotate daily at midnight"
echo "   - Keeps logs for 30 days"
echo "   - Max file size: 50MB"

echo ""

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
    mkdir -p logs
    echo "✅ Created logs directory"
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  WARNING: .env file not found!"
    echo ""
    echo "Please create a .env file with your configuration before starting the bot."

    if [ -f ".env.example" ]; then
        echo ""
        echo "You can copy the example file and edit it:"
        echo "  cp .env.example .env"
        echo "  nano .env"
    fi
else
    echo "✅ .env file found"
fi

echo ""
echo "========================================="
echo "   ✅ Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""

if [ ! -f ".env" ]; then
    echo "1. Create your .env file:"
    echo "   cp .env.example .env"
    echo "   nano .env"
    echo ""
    echo "2. Start the bot:"
    echo "   ./start.sh"
else
    echo "1. Start the bot:"
    echo "   ./start.sh"
    echo ""
    echo "2. View logs:"
    echo "   ./logs.sh"
fi

echo ""
echo "For more information, see: BOT_MANAGEMENT.md"
echo ""

# Optional: Setup PM2 to start on system boot
echo "========================================="
echo ""
read -p "Do you want the bot to auto-start on system reboot? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Setting up PM2 startup script..."
    pm2 startup
    echo ""
    echo "⚠️  IMPORTANT: Copy and run the command shown above to complete the setup!"
    echo "   After running that command, start your bot with ./start.sh and then run: pm2 save"
fi

echo ""
echo "Setup script finished!"
echo ""
