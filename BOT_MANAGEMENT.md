# Copy Trading Bot - Management Guide

This guide explains how to easily manage your Solana copy trading bot.

## 📋 Prerequisites

Make sure PM2 is installed globally:
```bash
npm install -g pm2
```

## 🚀 Quick Start

### Starting the Bot
```bash
./start.sh
```
This will start the bot in the background using PM2.

### Stopping the Bot
```bash
./stop.sh
```
This will gracefully stop the bot.

### Restarting the Bot
```bash
./restart.sh
```
This will restart the bot and **reload all environment variables** from the `.env` file.

**Important:** Always use `./restart.sh` instead of manual PM2 commands to ensure your `.env` changes are applied!

### Viewing Logs (Live)
```bash
./logs.sh
```
This shows real-time logs. Press `Ctrl+C` to exit.

### Checking Bot Status
```bash
./status.sh
```
This shows if the bot is running and its current status.

## 📁 Log Files

Logs are automatically saved in the `logs/` directory:
- `logs/output.log` - Standard output logs
- `logs/error.log` - Error logs

### Setting Up Daily Log Rotation

To automatically rotate logs daily (recommended), install the PM2 log rotation module:

```bash
pm2 install pm2-logrotate
```

Configure it for daily rotation:
```bash
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:dateFormat 'YYYY-MM-DD'
```

This will:
- Rotate logs daily at midnight
- Keep logs up to 50MB before rotating
- Retain logs for 30 days
- Name rotated files with the date (e.g., `output-2024-12-06.log`)

## 🔄 Updating the Bot

When you download a new version of the bot:

1. Navigate to the **NEW** bot directory:
   ```bash
   cd /path/to/new/copybot-main
   ```

2. Make sure your `.env` file is in the new directory

3. Stop the old bot (if running):
   ```bash
   pm2 delete copybot
   ```

4. Start the new bot:
   ```bash
   ./start.sh
   ```

## 🛠️ Common Tasks

### Changing Configuration (.env file)

1. Edit your `.env` file:
   ```bash
   nano .env
   ```

2. Save changes (Ctrl+O, Enter, Ctrl+X)

3. Restart the bot to apply changes:
   ```bash
   ./restart.sh
   ```

### Viewing Old Logs

View recent output:
```bash
cat logs/output.log
```

View recent errors:
```bash
cat logs/error.log
```

View last 100 lines:
```bash
tail -100 logs/output.log
```

### Making PM2 Start on System Reboot

To automatically start the bot when the server reboots:

```bash
pm2 startup
```

Follow the instructions it provides, then:
```bash
pm2 save
```

## ⚠️ Troubleshooting

### Bot won't start
1. Check if `.env` file exists: `ls -la .env`
2. Check if PM2 is installed: `pm2 --version`
3. View error logs: `cat logs/error.log`

### Environment variables not updating
Make sure you're using `./restart.sh` instead of `pm2 restart copybot`.

### Can't find the scripts
Make sure you're in the correct directory:
```bash
cd /root/copybot-main
ls *.sh
```

### Multiple bots running
Check all PM2 processes:
```bash
pm2 list
```

Delete all instances:
```bash
pm2 delete all
```

Then start fresh:
```bash
./start.sh
```

## 📞 Support

For issues or questions, refer to the main README.md or contact support.

## 🎯 Summary of Commands

| Command | Description |
|---------|-------------|
| `./start.sh` | Start the bot |
| `./stop.sh` | Stop the bot |
| `./restart.sh` | Restart bot + reload .env |
| `./logs.sh` | View live logs |
| `./status.sh` | Check bot status |
| `pm2 list` | List all PM2 processes |
| `pm2 delete copybot` | Remove bot from PM2 |

---

**Remember:** Always use the provided scripts (`./start.sh`, `./stop.sh`, etc.) instead of direct PM2 commands for the best experience!
