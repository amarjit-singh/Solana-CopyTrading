import fs from 'fs';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config();

const required = [
  'RPC_URL',
  'ENCODED_PRIVATE_KEY',
  'PUB_KEY'
];

const optionalUrls = [
  'GRPC_ENDPOINT',
  'RPC_URL',
  'NOZOMI_URL',
  'NEXT_BLOCK_URL',
  'ZEROSLOT_RPC_URL'
];

function isUrl(value) {
  if (!value) return false;
  try {
    new url.URL(value);
    return true;
  } catch (e) {
    return false;
  }
}

function isNumber(value) {
  return value !== undefined && value !== '' && !Number.isNaN(Number(value));
}

const problems = [];

for (const key of required) {
  if (!process.env[key]) problems.push(`Missing required env var: ${key}`);
}

for (const key of optionalUrls) {
  const v = process.env[key];
  if (v && !isUrl(v)) problems.push(`Invalid URL in ${key}: ${v}`);
}

// basic numeric checks
const numericKeys = [
  'BUY_AMOUNT', 'MIN_AMOUNT', 'MAX_AMOUNT',
  'PRIORITIZATION_FEE_LAMPORTS', 'BUY_PRIORITIZATION_FEE_LAMPORTS', 'SELL_PRIORITIZATION_FEE_LAMPORTS',
  'JITO_TIP_LAMPORTS', 'NOZOMI_TIP_LAMPORTS', 'SLOT_TIP_LAMPORTS',
  'SLIPPAGE_BPS','SLIPPAGE_BPS_PERCENTAGE', 'BUY_SLIPPAGE_BPS_PERCENTAGE','SELL_SLIPPAGE_BPS_PERCENTAGE',
  'MAX_RETRIES','RETRY_DELAY','TRANSACTION_TIMEOUT','WALLET_COUNT_WINDOW','LOW_WALLET_THRESHOLD'
];

for (const key of numericKeys) {
  const v = process.env[key];
  if (v !== undefined && v !== '' && !isNumber(v)) problems.push(`Expected numeric value for ${key}, got: ${v}`);
}

if (problems.length === 0) {
  console.log('Environment validation passed ✅');
  process.exit(0);
} else {
  console.error('Environment validation failed with the following issues:');
  for (const p of problems) console.error('- ' + p);
  process.exit(1);
}
