#!/bin/bash

# Script to switch from Shyft to Helius gRPC
# Usage: bash switch_to_helius.sh YOUR_HELIUS_API_KEY

echo "🔄 Switching to Helius gRPC Provider"
echo "===================================="
echo ""

# Check if API key is provided
if [ -z "$1" ]; then
    echo "❌ Error: Please provide your Helius API key"
    echo ""
    echo "Usage: bash switch_to_helius.sh YOUR_HELIUS_API_KEY"
    echo ""
    echo "Don't have a Helius API key?"
    echo "1. Go to https://helius.dev/"
    echo "2. Sign up for free"
    echo "3. Create API key in dashboard"
    echo "4. Run this script again with your key"
    exit 1
fi

HELIUS_API_KEY=$1

# Backup current .env
if [ -f .env ]; then
    echo "📦 Backing up current .env to .env.backup.$(date +%s)"
    cp .env .env.backup.$(date +%s)
    echo "✅ Backup created"
else
    echo "❌ Error: .env file not found"
    exit 1
fi

# Update .env file
echo ""
echo "🔧 Updating .env file..."

# Update GRPCTOKEN
sed -i.tmp "s/^GRPCTOKEN=.*/GRPCTOKEN=$HELIUS_API_KEY/" .env

# Update GRPC_ENDPOINT
sed -i.tmp "s|^GRPC_ENDPOINT=.*|GRPC_ENDPOINT=https://mainnet.helius-rpc.com|" .env

# Optional: Update RPC_URL to also use Helius for consistency
read -p "Do you want to also use Helius for RPC calls? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sed -i.tmp "s|^RPC_URL=.*|RPC_URL=https://mainnet.helius-rpc.com/?api-key=$HELIUS_API_KEY|" .env
    echo "✅ RPC_URL updated to Helius"
else
    echo "ℹ️  Keeping existing RPC_URL"
fi

# Clean up temp files
rm -f .env.tmp

echo ""
echo "✅ Configuration updated!"
echo ""
echo "📋 New settings:"
echo "   GRPCTOKEN: ${HELIUS_API_KEY:0:8}****${HELIUS_API_KEY: -4}"
echo "   GRPC_ENDPOINT: https://mainnet.helius-rpc.com"
echo ""

# Test the connection
echo "🧪 Testing connection..."
echo ""
node test_grpc_token.js

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 SUCCESS! You're ready to start the bot!"
    echo ""
    echo "Start your bot with:"
    echo "   npm start"
else
    echo ""
    echo "❌ Connection test failed"
    echo ""
    echo "Please verify:"
    echo "   1. Your Helius API key is correct"
    echo "   2. Your Helius account is active"
    echo "   3. You have internet connection"
    echo ""
    echo "You can restore your old configuration with:"
    echo "   cp .env.backup.* .env"
fi
