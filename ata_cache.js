import fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import { getAccount } from "@solana/spl-token";

const ATA_CACHE_FILE = "ata_cache.json";
const TOKEN_TYPE_CACHE_FILE = "token_type_cache.json";

// Ultra-fast in-memory cache with immediate loading
let ataCache = new Map();
let tokenTypeCache = new Map(); // Cache to store if a token is Token2022
let cacheLoaded = false;
let tokenTypeCacheLoaded = false;
let saveTimeout = null;
let tokenTypeSaveTimeout = null;
let saveQueue = new Set(); // Track pending saves
let tokenTypeSaveQueue = new Set();
let isSaving = false;
let isTokenTypeSaving = false;

// Immediate cache loading for instant access
function loadAtaCacheSync() {
  if (cacheLoaded) return;

  try {
    if (fs.existsSync(ATA_CACHE_FILE)) {
      const data = fs.readFileSync(ATA_CACHE_FILE, "utf8");
      const cacheData = JSON.parse(data);
      ataCache = new Map(Object.entries(cacheData));
    }
  } catch (error) {
    ataCache = new Map();
  }

  cacheLoaded = true;
}

// Load token type cache synchronously
function loadTokenTypeCacheSync() {
  if (tokenTypeCacheLoaded) return;

  try {
    if (fs.existsSync(TOKEN_TYPE_CACHE_FILE)) {
      const data = fs.readFileSync(TOKEN_TYPE_CACHE_FILE, "utf8");
      const cacheData = JSON.parse(data);
      tokenTypeCache = new Map(Object.entries(cacheData));
    }
  } catch (error) {
    tokenTypeCache = new Map();
  }

  tokenTypeCacheLoaded = true;
}

// Background save function - runs asynchronously without blocking
async function performBackgroundSave() {
  if (isSaving || saveQueue.size === 0) return;
  
  isSaving = true;
  const keysToSave = Array.from(saveQueue);
  saveQueue.clear();
  
  try {
    const cacheObject = Object.fromEntries(ataCache);
    await fs.promises.writeFile(ATA_CACHE_FILE, JSON.stringify(cacheObject, null, 2));
  } catch (error) {
    console.warn("Background ATA cache save failed:", error.message);
    // Re-queue failed saves
    keysToSave.forEach(key => saveQueue.add(key));
  } finally {
    isSaving = false;
    
    // Process any new items that were added while saving
    if (saveQueue.size > 0) {
      setTimeout(performBackgroundSave, 10);
    }
  }
}

// Schedule background save with batching
function scheduleBackgroundSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    performBackgroundSave();
  }, 50); // Reduced delay for faster batching
}

// Background save function for token type cache
async function performTokenTypeBackgroundSave() {
  if (isTokenTypeSaving || tokenTypeSaveQueue.size === 0) return;

  isTokenTypeSaving = true;
  const keysToSave = Array.from(tokenTypeSaveQueue);
  tokenTypeSaveQueue.clear();

  try {
    const cacheObject = Object.fromEntries(tokenTypeCache);
    await fs.promises.writeFile(TOKEN_TYPE_CACHE_FILE, JSON.stringify(cacheObject, null, 2));
  } catch (error) {
    console.warn("Background token type cache save failed:", error.message);
    keysToSave.forEach(key => tokenTypeSaveQueue.add(key));
  } finally {
    isTokenTypeSaving = false;

    if (tokenTypeSaveQueue.size > 0) {
      setTimeout(performTokenTypeBackgroundSave, 10);
    }
  }
}

// Schedule background save for token type cache
function scheduleTokenTypeBackgroundSave() {
  if (tokenTypeSaveTimeout) {
    clearTimeout(tokenTypeSaveTimeout);
  }

  tokenTypeSaveTimeout = setTimeout(() => {
    performTokenTypeBackgroundSave();
  }, 50);
}

// Load ATA cache from file (async version for validation)
async function loadAtaCache(connection = null) {
  if (!cacheLoaded) {
    loadAtaCacheSync(); // Immediate sync load first

    // Background validation if connection provided
    if (connection) {
      setImmediate(async () => {
        const invalidEntries = [];
        for (const [key, ataAddress] of ataCache.entries()) {
          // Skip token type entries (they're not ATAs)
          if (key.startsWith('token_type_')) continue;

          try {
            // Determine token program from cache key format
            let tokenProgramId = TOKEN_PROGRAM_ID;
            if (key.endsWith('_token2022')) {
              tokenProgramId = TOKEN_2022_PROGRAM_ID;
            }

            await getAccount(connection, new PublicKey(ataAddress), 'confirmed', tokenProgramId);
          } catch (e) {
            if (e.message && e.message.includes("Failed to find account")) {
              invalidEntries.push(key);
            }
          }
        }
        for (const key of invalidEntries) {
          ataCache.delete(key);
        }
        if (invalidEntries.length > 0) {
          scheduleBackgroundSave();
        }
      });
    }
  }
}

// Ultra-fast cache check - no async operations
// tokenType: 'token' or 'token2022', defaults to 'token' for backward compatibility
function hasAtaInCacheSync(mint, walletPublicKey, tokenType = 'token') {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}_${tokenType}`;

  // Check new key format first
  if (ataCache.has(key)) {
    return true;
  }

  // ONLY check old key format for regular tokens (not Token2022)
  // This prevents Token2022 lookups from finding regular token cache entries
  if (tokenType === 'token') {
    const oldKey = `${mint}_${walletPublicKey}`;
    return ataCache.has(oldKey);
  }

  return false;
}

// Ultra-fast ATA address retrieval from cache only (no on-chain validation)
// tokenType: 'token' or 'token2022', defaults to 'token' for backward compatibility
function getAtaAddressSync(mint, walletPublicKey, tokenType = 'token') {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}_${tokenType}`;

  if (ataCache.has(key)) {
    return new PublicKey(ataCache.get(key));
  }

  // ONLY check old key format for regular tokens (not Token2022)
  // This prevents Token2022 lookups from getting regular token ATA addresses
  if (tokenType === 'token') {
    const oldKey = `${mint}_${walletPublicKey}`;
    if (ataCache.has(oldKey)) {
      return new PublicKey(ataCache.get(oldKey));
    }
  }

  return null;
}

// Check if ATA exists in cache (async wrapper for compatibility)
async function hasAtaInCache(mint, walletPublicKey, connection = null, tokenType = 'token') {
  // Use sync version for immediate response
  return hasAtaInCacheSync(mint, walletPublicKey, tokenType);
}

// Add ATA to cache (immediate in-memory, background save)
function addAtaToCache(mint, walletPublicKey, ataAddress, connection = null, tokenType = 'token') {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}_${tokenType}`;
  ataCache.set(key, ataAddress);
  saveQueue.add(key);
  scheduleBackgroundSave();
}

// Remove ATA from cache (immediate in-memory, background save)
function removeAtaFromCache(mint, walletPublicKey, connection = null, tokenType = null) {
  if (!cacheLoaded) loadAtaCacheSync();

  // If tokenType is provided, remove specific entry
  if (tokenType) {
    const key = `${mint}_${walletPublicKey}_${tokenType}`;
    if (ataCache.has(key)) {
      ataCache.delete(key);
      saveQueue.add(key);
      scheduleBackgroundSave();
      return true;
    }
    return false;
  }

  // Otherwise remove both token and token2022 entries
  let removed = false;
  const key = `${mint}_${walletPublicKey}_token`;
  const key2022 = `${mint}_${walletPublicKey}_token2022`;
  const oldKey = `${mint}_${walletPublicKey}`;

  if (ataCache.has(key)) {
    ataCache.delete(key);
    saveQueue.add(key);
    removed = true;
  }
  if (ataCache.has(key2022)) {
    ataCache.delete(key2022);
    saveQueue.add(key2022);
    removed = true;
  }
  if (ataCache.has(oldKey)) {
    ataCache.delete(oldKey);
    saveQueue.add(oldKey);
    removed = true;
  }

  if (removed) {
    scheduleBackgroundSave();
  }
  return removed;
}

// Detect if a token is Token2022
async function isToken2022(connection, mint) {
  if (!connection) return false;

  // Load token type cache
  if (!tokenTypeCacheLoaded) loadTokenTypeCacheSync();

  const mintStr = typeof mint === 'string' ? mint : mint.toString();

  // Check cache first
  if (tokenTypeCache.has(mintStr)) {
    return tokenTypeCache.get(mintStr) === 'token2022';
  }

  try {
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;

    // Try to get mint info with Token2022 program first
    try {
      await getMint(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      tokenTypeCache.set(mintStr, 'token2022');
      tokenTypeSaveQueue.add(mintStr);
      scheduleTokenTypeBackgroundSave();
      return true;
    } catch (e) {
      // If it fails, try with regular token program
      try {
        await getMint(connection, mintPubkey, 'confirmed', TOKEN_PROGRAM_ID);
        tokenTypeCache.set(mintStr, 'token');
        tokenTypeSaveQueue.add(mintStr);
        scheduleTokenTypeBackgroundSave();
        return false;
      } catch (e2) {
        // If both fail, assume regular token
        return false;
      }
    }
  } catch (error) {
    console.warn(`Failed to detect token type for ${mintStr}:`, error.message);
    return false;
  }
}

// Ultra-fast ATA address retrieval with optimized caching
async function getAtaAddress(mint, walletPublicKey, connection = null) {
  // Immediate cache check without async operations
  if (!cacheLoaded) loadAtaCacheSync();

  // Detect if this is a Token2022 token
  const isT2022 = connection ? await isToken2022(connection, mint) : false;
  const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const tokenType = isT2022 ? 'token2022' : 'token';

  const key = `${mint}_${walletPublicKey}_${tokenType}`;

  // Ultra-fast cache hit path
  if (ataCache.has(key)) {
    const cachedAta = ataCache.get(key);
    const cachedAtaPublicKey = new PublicKey(cachedAta);

    // Only validate on-chain if connection provided and we need to be sure
    if (connection) {
      try {
        // CRITICAL: Pass tokenProgramId to avoid TokenInvalidAccountOwnerError for Token2022
        await getAccount(connection, cachedAtaPublicKey, 'confirmed', tokenProgramId);
        return cachedAtaPublicKey;
      } catch (e) {
        if (e.message && e.message.includes("Failed to find account")) {
          ataCache.delete(key);
          saveQueue.add(key);
          scheduleBackgroundSave();
        } else {
          throw e;
        }
      }
    } else {
      return cachedAtaPublicKey;
    }
  }

  // ONLY check old key format for regular tokens (not Token2022)
  // This prevents Token2022 lookups from getting regular token ATA addresses
  if (tokenType === 'token') {
    const oldKey = `${mint}_${walletPublicKey}`;
    if (ataCache.has(oldKey)) {
      const cachedAta = ataCache.get(oldKey);
      const cachedAtaPublicKey = new PublicKey(cachedAta);

      // Validate and migrate to new key format
      if (connection) {
        try {
          // CRITICAL: Pass tokenProgramId to avoid TokenInvalidAccountOwnerError
          await getAccount(connection, cachedAtaPublicKey, 'confirmed', tokenProgramId);
          // Migrate to new key format
          ataCache.delete(oldKey);
          addAtaToCache(mint, walletPublicKey, cachedAta, connection, tokenType);
          return cachedAtaPublicKey;
        } catch (e) {
          // Old cached entry is invalid, remove it
          ataCache.delete(oldKey);
          saveQueue.add(oldKey);
          scheduleBackgroundSave();
        }
      }
    }
  }

  // Calculate new ATA address with correct token program
  const ataAddress = await getAssociatedTokenAddress(
    new PublicKey(mint),
    new PublicKey(walletPublicKey),
    false, // allowOwnerOffCurve
    tokenProgramId
  );

  // Add to cache immediately (non-blocking)
  addAtaToCache(mint, walletPublicKey, ataAddress.toString(), connection, tokenType);

  return ataAddress;
}

// Clear entire cache (immediate in-memory, background save)
function clearAtaCache() {
  ataCache.clear();
  saveQueue.clear();
  if (fs.existsSync(ATA_CACHE_FILE)) {
    fs.unlinkSync(ATA_CACHE_FILE);
  }
}

// Clear old format cache entries (without token type suffix)
// This helps clean up legacy cache entries that might interfere with Token2022
function clearOldFormatCacheEntries() {
  if (!cacheLoaded) loadAtaCacheSync();

  let clearedCount = 0;
  const keysToDelete = [];

  // Find all old format keys (those without _token or _token2022 suffix)
  for (const key of ataCache.keys()) {
    if (!key.endsWith('_token') && !key.endsWith('_token2022')) {
      keysToDelete.push(key);
    }
  }

  // Delete old format keys
  for (const key of keysToDelete) {
    ataCache.delete(key);
    saveQueue.add(key);
    clearedCount++;
  }

  if (clearedCount > 0) {
    console.log(`🧹 Cleared ${clearedCount} old format ATA cache entries`);
    scheduleBackgroundSave();
  }

  return clearedCount;
}

// Get cache statistics
function getAtaCacheStats(connection = null) {
  if (!cacheLoaded) loadAtaCacheSync();
  return {
    totalAtas: ataCache.size,
    cacheFile: ATA_CACHE_FILE,
    pendingSaves: saveQueue.size,
    isSaving: isSaving
  };
}

// Check if ATA exists on-chain
/**
 * Checks if an ATA exists on-chain for the given mint and wallet public key.
 * @param {Connection} connection - Solana connection object
 * @param {string|PublicKey} mint - Mint address
 * @param {string|PublicKey} walletPublicKey - Wallet public key
 * @returns {Promise<boolean>} - True if exists, false otherwise
 */
async function ataExistsOnChain(connection, mint, walletPublicKey) {
  // Detect token type to use correct program ID
  const isT2022 = await isToken2022(connection, mint);
  const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const ataAddress = await getAtaAddress(mint, walletPublicKey, connection);
  try {
    await getAccount(connection, ataAddress, 'confirmed', tokenProgramId);
    return true;
  } catch (e) {
    if (e.message && e.message.includes("Failed to find account")) {
      return false;
    }
    throw e;
  }
}

// Force immediate save (for shutdown scenarios)
async function forceSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  
  // Wait for any ongoing save to complete
  while (isSaving) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  try {
    const cacheObject = Object.fromEntries(ataCache);
    await fs.promises.writeFile(ATA_CACHE_FILE, JSON.stringify(cacheObject, null, 2));
    saveQueue.clear();
  } catch (error) {
    console.error("Force save ATA cache failed:", error.message);
  }
}

// Initialize cache immediately
loadAtaCacheSync();
loadTokenTypeCacheSync();

// Auto-clear old format cache entries on startup to prevent Token2022 issues
clearOldFormatCacheEntries();

export {
  hasAtaInCache,
  hasAtaInCacheSync, // New sync version for ultra-fast access
  getAtaAddressSync, // Ultra-fast sync ATA address retrieval
  addAtaToCache,
  removeAtaFromCache,
  getAtaAddress,
  clearAtaCache,
  clearOldFormatCacheEntries, // Clear old cache entries
  getAtaCacheStats,
  loadAtaCache,
  ataExistsOnChain,
  forceSave,
  isToken2022, // Export Token2022 detection function
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
}; 