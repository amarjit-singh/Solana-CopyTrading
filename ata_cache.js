import fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import { getAccount } from "@solana/spl-token";

const ATA_CACHE_FILE = "ata_cache.json";

// Ultra-fast in-memory cache with immediate loading
// Cache format: { "{mint}_{walletPublicKey}": { ata: "{address}", type: "{tokenType}", onChain: true/false } }
let ataCache = new Map();
let cacheLoaded = false;
let saveTimeout = null;
let saveQueue = new Set(); // Track pending saves
let isSaving = false;

// Immediate cache loading for instant access
function loadAtaCacheSync() {
  if (cacheLoaded) return;

  try {
    if (fs.existsSync(ATA_CACHE_FILE)) {
      const data = fs.readFileSync(ATA_CACHE_FILE, "utf8");
      const cacheData = JSON.parse(data);

      // Handle migration from old format to new format
      const migratedData = {};
      for (const [key, value] of Object.entries(cacheData)) {
        if (typeof value === 'string') {
          // Old format: value is just the ATA address string
          // Migrate to new format with default type 'token' and onChain true
          const newKey = key.endsWith('_token') || key.endsWith('_token2022')
            ? key.replace(/_token2022$/, '').replace(/_token$/, '')
            : key;
          const tokenType = key.endsWith('_token2022') ? 'token2022' : 'token';
          migratedData[newKey] = { ata: value, type: tokenType, onChain: true };
        } else if (typeof value === 'object' && value.ata) {
          // New format: already has the correct structure
          migratedData[key] = value;
        }
      }

      ataCache = new Map(Object.entries(migratedData));
    }
  } catch (error) {
    ataCache = new Map();
  }

  cacheLoaded = true;
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

// Load ATA cache from file (async version for validation)
async function loadAtaCache(connection = null) {
  if (!cacheLoaded) {
    loadAtaCacheSync(); // Immediate sync load first

    // Background validation if connection provided
    if (connection) {
      setImmediate(async () => {
        for (const [key, cacheEntry] of ataCache.entries()) {
          try {
            const tokenProgramId = cacheEntry.type === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
            await getAccount(connection, new PublicKey(cacheEntry.ata), 'confirmed', tokenProgramId);
            // Update onChain status if it was false
            if (!cacheEntry.onChain) {
              cacheEntry.onChain = true;
              saveQueue.add(key);
            }
          } catch (e) {
            if (e.message && e.message.includes("Failed to find account")) {
              // Mark as not on-chain instead of deleting
              cacheEntry.onChain = false;
              saveQueue.add(key);
            }
          }
        }
        if (saveQueue.size > 0) {
          scheduleBackgroundSave();
        }
      });
    }
  }
}

// Ultra-fast cache check - no async operations
function hasAtaInCacheSync(mint, walletPublicKey, tokenType = null) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;

  if (!ataCache.has(key)) return false;

  const cacheEntry = ataCache.get(key);

  // If tokenType specified, check if it matches
  if (tokenType && cacheEntry.type !== tokenType) return false;

  return true;
}

// Ultra-fast ATA address retrieval from cache only (no on-chain validation)
function getAtaAddressSync(mint, walletPublicKey, tokenType = null) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;

  if (!ataCache.has(key)) return null;

  const cacheEntry = ataCache.get(key);

  // If tokenType specified, check if it matches
  if (tokenType && cacheEntry.type !== tokenType) return null;

  return new PublicKey(cacheEntry.ata);
}

// Get full cache entry (includes ata, type, onChain)
function getCacheEntrySync(mint, walletPublicKey) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;
  return ataCache.get(key) || null;
}

// Check if ATA exists in cache (async wrapper for compatibility)
// eslint-disable-next-line no-unused-vars
async function hasAtaInCache(mint, walletPublicKey, _connection = null, tokenType = null) {
  // Use sync version for immediate response
  return hasAtaInCacheSync(mint, walletPublicKey, tokenType);
}

// Add ATA to cache (immediate in-memory, background save)
function addAtaToCache(mint, walletPublicKey, ataAddress, tokenType = 'token', onChain = true) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;
  ataCache.set(key, { ata: ataAddress, type: tokenType, onChain: onChain });
  saveQueue.add(key);
  scheduleBackgroundSave();
}

// Update onChain status in cache
function updateOnChainStatus(mint, walletPublicKey, onChain) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;

  if (ataCache.has(key)) {
    const cacheEntry = ataCache.get(key);
    cacheEntry.onChain = onChain;
    saveQueue.add(key);
    scheduleBackgroundSave();
    return true;
  }
  return false;
}

// Remove ATA from cache (immediate in-memory, background save)
function removeAtaFromCache(mint, walletPublicKey) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;

  if (ataCache.has(key)) {
    ataCache.delete(key);
    saveQueue.add(key);
    scheduleBackgroundSave();
    return true;
  }
  return false;
}

// Detect if a token is Token2022 (uses cache first)
async function isToken2022(connection, mint) {
  if (!connection) return false;
  if (!cacheLoaded) loadAtaCacheSync();

  const mintStr = typeof mint === 'string' ? mint : mint.toString();

  // Check if we have any cache entry with this mint that has type info
  // We iterate to find any entry with this mint
  for (const [key, cacheEntry] of ataCache.entries()) {
    if (key.startsWith(mintStr + '_')) {
      return cacheEntry.type === 'token2022';
    }
  }

  // Not in cache, detect from chain
  try {
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;

    // Try to get mint info with Token2022 program first
    try {
      await getMint(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      return true;
    } catch (e) {
      // If it fails, try with regular token program
      try {
        await getMint(connection, mintPubkey, 'confirmed', TOKEN_PROGRAM_ID);
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

// Get token type from cache (sync, returns null if not cached)
function getTokenTypeSync(mint) {
  if (!cacheLoaded) loadAtaCacheSync();
  const mintStr = typeof mint === 'string' ? mint : mint.toString();

  // Find any cache entry with this mint
  for (const [key, cacheEntry] of ataCache.entries()) {
    if (key.startsWith(mintStr + '_')) {
      return cacheEntry.type;
    }
  }
  return null;
}

// Ultra-fast ATA address retrieval with optimized caching
async function getAtaAddress(mint, walletPublicKey, connection = null) {
  // Immediate cache check without async operations
  if (!cacheLoaded) loadAtaCacheSync();

  const mintStr = typeof mint === 'string' ? mint : mint.toString();
  const walletStr = typeof walletPublicKey === 'string' ? walletPublicKey : walletPublicKey.toString();
  const key = `${mintStr}_${walletStr}`;

  // Ultra-fast cache hit path
  if (ataCache.has(key)) {
    const cacheEntry = ataCache.get(key);
    const cachedAtaPublicKey = new PublicKey(cacheEntry.ata);

    // Only validate on-chain if connection provided and we need to be sure
    if (connection) {
      try {
        const tokenProgramId = cacheEntry.type === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        await getAccount(connection, cachedAtaPublicKey, 'confirmed', tokenProgramId);

        // Update onChain status if needed
        if (!cacheEntry.onChain) {
          cacheEntry.onChain = true;
          saveQueue.add(key);
          scheduleBackgroundSave();
        }
        return cachedAtaPublicKey;
      } catch (e) {
        if (e.message && e.message.includes("Failed to find account")) {
          // Mark as not on-chain
          cacheEntry.onChain = false;
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

  // Detect if this is a Token2022 token
  const isT2022 = connection ? await isToken2022(connection, mint) : false;
  const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const tokenType = isT2022 ? 'token2022' : 'token';

  // Calculate new ATA address with correct token program
  const ataAddress = await getAssociatedTokenAddress(
    new PublicKey(mint),
    new PublicKey(walletPublicKey),
    false, // allowOwnerOffCurve
    tokenProgramId
  );

  // Check if ATA exists on-chain
  let onChain = false;
  if (connection) {
    try {
      await getAccount(connection, ataAddress, 'confirmed', tokenProgramId);
      onChain = true;
    } catch (e) {
      onChain = false;
    }
  }

  // Add to cache immediately (non-blocking)
  addAtaToCache(mintStr, walletStr, ataAddress.toString(), tokenType, onChain);

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

// Get cache statistics
function getAtaCacheStats() {
  if (!cacheLoaded) loadAtaCacheSync();

  let onChainCount = 0;
  let offChainCount = 0;
  let token2022Count = 0;
  let tokenCount = 0;

  for (const cacheEntry of ataCache.values()) {
    if (cacheEntry.onChain) onChainCount++;
    else offChainCount++;
    if (cacheEntry.type === 'token2022') token2022Count++;
    else tokenCount++;
  }

  return {
    totalAtas: ataCache.size,
    onChain: onChainCount,
    offChain: offChainCount,
    tokenCount: tokenCount,
    token2022Count: token2022Count,
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
  const mintStr = typeof mint === 'string' ? mint : mint.toString();
  const walletStr = typeof walletPublicKey === 'string' ? walletPublicKey : walletPublicKey.toString();
  const key = `${mintStr}_${walletStr}`;

  // Check cache first for quick response
  if (ataCache.has(key)) {
    const cacheEntry = ataCache.get(key);
    if (cacheEntry.onChain) {
      return true; // Trust cached on-chain status
    }
  }

  // Detect token type to use correct program ID
  const isT2022 = await isToken2022(connection, mint);
  const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const ataAddress = await getAtaAddress(mint, walletPublicKey, connection);
  try {
    await getAccount(connection, ataAddress, 'confirmed', tokenProgramId);

    // Update cache
    updateOnChainStatus(mintStr, walletStr, true);
    return true;
  } catch (e) {
    if (e.message && e.message.includes("Failed to find account")) {
      updateOnChainStatus(mintStr, walletStr, false);
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

export {
  hasAtaInCache,
  hasAtaInCacheSync,
  getAtaAddressSync,
  getCacheEntrySync,
  getTokenTypeSync,
  addAtaToCache,
  updateOnChainStatus,
  removeAtaFromCache,
  getAtaAddress,
  clearAtaCache,
  getAtaCacheStats,
  loadAtaCache,
  ataExistsOnChain,
  forceSave,
  isToken2022,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
};
