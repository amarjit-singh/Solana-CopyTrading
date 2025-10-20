import fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getAccount } from "@solana/spl-token";

const ATA_CACHE_FILE = "ata_cache.json";

// Ultra-fast in-memory cache with immediate loading
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
      ataCache = new Map(Object.entries(cacheData));
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
        const invalidEntries = [];
        for (const [key, ataAddress] of ataCache.entries()) {
          try {
            await getAccount(connection, new PublicKey(ataAddress));
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
function hasAtaInCacheSync(mint, walletPublicKey) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;
  return ataCache.has(key);
}

// Ultra-fast ATA address retrieval from cache only (no on-chain validation)
function getAtaAddressSync(mint, walletPublicKey) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;
  
  if (ataCache.has(key)) {
    return new PublicKey(ataCache.get(key));
  }
  return null;
}

// Check if ATA exists in cache (async wrapper for compatibility)
async function hasAtaInCache(mint, walletPublicKey, connection = null) {
  // Use sync version for immediate response
  return hasAtaInCacheSync(mint, walletPublicKey);
}

// Add ATA to cache (immediate in-memory, background save)
function addAtaToCache(mint, walletPublicKey, ataAddress, connection = null) {
  if (!cacheLoaded) loadAtaCacheSync();
  const key = `${mint}_${walletPublicKey}`;
  ataCache.set(key, ataAddress);
  saveQueue.add(key);
  scheduleBackgroundSave();
}

// Remove ATA from cache (immediate in-memory, background save)
function removeAtaFromCache(mint, walletPublicKey, connection = null) {
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

// Ultra-fast ATA address retrieval with optimized caching
async function getAtaAddress(mint, walletPublicKey, connection = null) {
  // Immediate cache check without async operations
  if (!cacheLoaded) loadAtaCacheSync();
  
  const key = `${mint}_${walletPublicKey}`;
  
  // Ultra-fast cache hit path
  if (ataCache.has(key)) {
    const cachedAta = ataCache.get(key);
    const cachedAtaPublicKey = new PublicKey(cachedAta);
    
    // Only validate on-chain if connection provided and we need to be sure
    if (connection) {
      try {
        await getAccount(connection, cachedAtaPublicKey);
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
  
  // Calculate new ATA address
  const ataAddress = await getAssociatedTokenAddress(
    new PublicKey(mint),
    new PublicKey(walletPublicKey)
  );
  
  // Add to cache immediately (non-blocking)
  addAtaToCache(mint, walletPublicKey, ataAddress.toString(), connection);
  
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
  const ataAddress = await getAtaAddress(mint, walletPublicKey);
  try {
    await getAccount(connection, ataAddress);
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

export {
  hasAtaInCache,
  hasAtaInCacheSync, // New sync version for ultra-fast access
  getAtaAddressSync, // Ultra-fast sync ATA address retrieval
  addAtaToCache,
  removeAtaFromCache,
  getAtaAddress,
  clearAtaCache,
  getAtaCacheStats,
  loadAtaCache,
  ataExistsOnChain,
  forceSave
}; 