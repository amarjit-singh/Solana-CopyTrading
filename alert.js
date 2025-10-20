import TelegramBot from 'node-telegram-bot-api';
// import "dotenv/config";
import dotenv from "dotenv";
import fetch from 'node-fetch';
dotenv.config()

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const bot = BOT_TOKEN && BOT_TOKEN.length > 0
  ? new TelegramBot(BOT_TOKEN, { polling: false })
  : null;

function escapeMarkdown(text) {
  return String(text).replace(/[_*`\[]/g, '\\$&');
}

// Function to get alert settings from telegram controller
async function getAlertSettings() {
  try {
    // Import the telegram controller dynamically to avoid circular dependencies
    const telegramController = await import('./telegram_controller.js');
    return telegramController.getAlertSettings();
  } catch (error) {
    console.error('Error getting alert settings:', error);
    // Return default settings if telegram controller is not available
    return {
      buyAlerts: true,
      sellAlerts: true,
      insufficientFundsAlerts: true,
      balanceAlerts: true,
      errorAlerts: true
    };
  }
}

// Function to check if a specific alert type is enabled
async function isAlertEnabled(alertType) {
  try {
    const alertSettings = await getAlertSettings();
    return alertSettings[alertType] === true;
  } catch (error) {
    console.error(`Error checking ${alertType} alert setting:`, error);
    return true; // Default to enabled if there's an error
  }
}

/**
 * Sends a sell alert to a Telegram bot using MarkdownV2.
 * @param {Object} info - The sell info object.
 * @param {string} info.tokenMint - The token mint address.
 * @param {number} info.amount - The amount sold.
 * @param {number} info.pnl - The PnL at the time of sell.
 * @param {number} info.price - The price at the time of sell.
 * @param {string} [info.reason] - The reason for the sell (e.g., 'stoploss', 'topPnL', etc).
 * @param {string} [info.txid] - The transaction ID (optional).
 */
export async function sendSellAlert({ tokenMint, amount, toppnl, pnl, price, reason, txid, netProfit }) {
  // Check if sell alerts are enabled
  const sellAlertsEnabled = await isAlertEnabled('sellAlerts');
  if (!sellAlertsEnabled) {
    console.log('Sell alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  // Fetch token name and symbol from Dexscreener
  let tokenName = "";
  let tokenSymbol = "";
  try {
    const tokenData = await getTokenDataFromDexscreener(tokenMint);
    if (tokenData) {
      tokenName = tokenData.name || "";
      tokenSymbol = tokenData.symbol || "";
    }
  } catch (err) {
    console.error("Failed to fetch token name/symbol for sell alert:", err);
  }

  const isPositive = pnl > 0;
  let message = (isPositive ? '🟢 *SELL ALERT* 🟢' : '🚨 *SELL ALERT* 🚨') + '\n';
  if (tokenName || tokenSymbol) {
    message += '*Name:* ' + escapeMarkdown(tokenName) + (tokenSymbol ? ` (${escapeMarkdown(tokenSymbol)})` : '') + '\n';
  }
  message += '*Token:* `' + escapeMarkdown(tokenMint) + '`\n';
  message += '[gmgn](https://gmgn.ai/token/' + escapeMarkdown(tokenMint) + ') | ';
  message += '*SOL Received:* ' + escapeMarkdown(amount) + '\n';
  if (netProfit !== undefined) {
    const profitColor = netProfit >= 0 ? '🟢' : '🔴';
    message += '*Net Profit:* ' + profitColor + ' ' + escapeMarkdown(netProfit.toFixed(6)) + ' SOL\n';
  }
 
  if (txid) message += '[Tx: View on Solscan](https://solscan.io/tx/' + escapeMarkdown(txid) + ')\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Sell alert sent successfully');
  } catch (err) {
    console.error('Failed to send Telegram alert:', err?.response?.data || err.message);
  }
}

export async function sendmessage(message){
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Failed to send Telegram alert:', err?.response?.data || err.message);
  }
}

export async function sendBuyAlert({ tokenMint, amount, price, txid, reason }) {
  // Check if buy alerts are enabled
  const buyAlertsEnabled = await isAlertEnabled('buyAlerts');
  if (!buyAlertsEnabled) {
    console.log('Buy alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  // Fetch token name and symbol from Dexscreener
  let tokenName = "";
  let tokenSymbol = "";
  try {
    const tokenData = await getTokenDataFromDexscreener(tokenMint);
    if (tokenData) {
      tokenName = tokenData.name || "";
      tokenSymbol = tokenData.symbol || "";
    }
  } catch (err) {
    console.error("Failed to fetch token name/symbol for buy alert:", err);
  }

  let message = '🔵 *BUY ALERT* 🔵\n';
 
  if (tokenName || tokenSymbol) {
    message += '*Name:* ' + escapeMarkdown(tokenName) + (tokenSymbol ? ` (${escapeMarkdown(tokenSymbol)})` : '') + '\n';
  }
  message += '*Token:* `' + escapeMarkdown(tokenMint) + '`\n';
  message += '[gmgn](https://gmgn.ai/token/' + escapeMarkdown(tokenMint) + ') | ';
  message += '*SOL Spent:* ' + escapeMarkdown(amount) + '\n';
  if (txid) message += '[Tx: View on Solscan](https://solscan.io/tx/' + escapeMarkdown(txid) + ')\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Buy alert sent successfully');
  } catch (err) {
    console.error('Failed to send Telegram alert:', err?.response?.data || err.message);
  }
}

export async function sendInsufficientFundsAlert({ currentBalance, limitBalance, walletAddress }) {
  // Check if insufficient funds alerts are enabled
  const insufficientFundsAlertsEnabled = await isAlertEnabled('insufficientFundsAlerts');
  if (!insufficientFundsAlertsEnabled) {
    console.log('Insufficient funds alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '🚨🚨🚨 *INSUFFICIENT FUNDS ALERT* 🚨🚨🚨\n';
  message += '*Status:* `🛑 BOT STOPPED`\n';
  message += '*Current Balance:* ' + escapeMarkdown(currentBalance.toFixed(4)) + ' SOL\n';
  message += '*Limit Balance:* ' + escapeMarkdown(limitBalance.toFixed(4)) + ' SOL\n';
  message += '*Wallet:* ' + '\`' + escapeMarkdown(walletAddress) + '\`\n';
  message += '*Action Required:* Add SOL to wallet to resume trading\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Insufficient funds alert sent successfully');
  } catch (err) {
    console.error('Failed to send insufficient funds Telegram alert:', err?.response?.data || err.message);
  }
}
/**
 * Fetch token data (name, symbol, etc.) from mint address using Dexscreener API.
 * @param {string} mintAddress - The token mint address (Solana SPL token).
 * @returns {Promise<{name: string, symbol: string, priceUsd?: string, chainId?: string, [key: string]: any}|null>}
 */
export async function getTokenDataFromDexscreener(mintAddress) {
  if (!mintAddress) return null;
  try {
    // Dexscreener Solana endpoint for token info
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Dexscreener API error: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    // Dexscreener returns a "pairs" array, pick the first one with token info
    if (data && Array.isArray(data.pairs) && data.pairs.length > 0) {
      const tokenInfo = data.pairs[0];
      return {
        name: tokenInfo.baseToken?.name || "",
        symbol: tokenInfo.baseToken?.symbol || "",
        priceUsd: tokenInfo.priceUsd,
        chainId: tokenInfo.chainId,
        ...tokenInfo.baseToken
      };
    }
    return null;
  } catch (err) {
    console.error("Failed to fetch token data from Dexscreener:", err);
    return null;
  }
}

// New function for balance alerts
export async function sendBalanceAlert({ currentBalance, walletAddress }) {
  // Check if balance alerts are enabled
  const balanceAlertsEnabled = await isAlertEnabled('balanceAlerts');
  if (!balanceAlertsEnabled) {
    console.log('Balance alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '💰 *BALANCE UPDATE* 💰\n';
  message += '*Current Balance:* ' + escapeMarkdown(currentBalance.toFixed(4)) + ' SOL\n';
  message += '*Wallet:* ' + '\`' + escapeMarkdown(walletAddress) + '\`\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Balance alert sent successfully');
  } catch (err) {
    console.error('Failed to send balance Telegram alert:', err?.response?.data || err.message);
  }
}

// New function for error alerts
export async function sendErrorAlert({ error, context }) {
  // Check if error alerts are enabled
  const errorAlertsEnabled = await isAlertEnabled('errorAlerts');
  if (!errorAlertsEnabled) {
    console.log('Error alerts are disabled, skipping alert');
    return;
  }

  if (!bot || !CHAT_ID) {
    console.error('Telegram bot token or chat ID not set in environment variables.');
    return;
  }

  let message = '⚠️ *ERROR ALERT* ⚠️\n';
  message += '*Error:* ' + escapeMarkdown(error.message || error) + '\n';
  if (context) message += '*Context:* ' + escapeMarkdown(context) + '\n';
  message += '*Time:* ' + escapeMarkdown(new Date().toLocaleString());

  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('Error alert sent successfully');
  } catch (err) {
    console.error('Failed to send error Telegram alert:', err?.response?.data || err.message);
  }
}
