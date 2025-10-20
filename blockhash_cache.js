import fs from "fs";

// Ultra-fast blockhash cache for instant access
class BlockhashCache {
  constructor() {
    this.cache = new Map();
    this.fallbackCache = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 200; // 200ms updates for ultra-fast trading
    this.maxCacheAge = 2000; // 2 seconds max age
    this.isRunning = false;
    this.updatePromise = null;
    this.connection = null;
    this.rpcEndpoints = [];
    this.currentEndpointIndex = 0;
  }

  // Initialize with connection and RPC endpoints
  initialize(connection, rpcEndpoints = []) {
    this.connection = connection;
    this.rpcEndpoints = rpcEndpoints.length > 0 ? rpcEndpoints : [connection.rpcEndpoint];
    this.start();
  }

  // Start background updates
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("🚀 Starting ultra-fast blockhash cache...");
    
    // Immediate first update
    this.updateBlockhash();
    
    // Start background updates
    this.scheduleNextUpdate();
  }

  stop() {
    this.isRunning = false;
    console.log("⏹️ Stopping blockhash cache...");
  }

  // Schedule next update
  scheduleNextUpdate() {
    if (!this.isRunning) return;
    
    setTimeout(() => {
      if (this.isRunning) {
        this.updateBlockhash();
        this.scheduleNextUpdate();
      }
    }, this.updateInterval);
  }

  // Update blockhash with fallback strategy
  async updateBlockhash() {
    if (this.updatePromise) {
      return this.updatePromise;
    }

    this.updatePromise = this.performUpdate();
    try {
      await this.updatePromise;
    } finally {
      this.updatePromise = null;
    }
  }

  async performUpdate() {
    const startTime = performance.now();
    
    try {
      // Try primary connection first
      const blockhashInfo = await this.connection.getLatestBlockhash("processed");
      
      // Store in cache with timestamp
      const cacheEntry = {
        blockhash: blockhashInfo.blockhash,
        lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
        timestamp: Date.now(),
        source: 'primary'
      };

      // Move current to fallback
      if (this.cache.has('current')) {
        const current = this.cache.get('current');
        this.fallbackCache.set(current.blockhash, current);
        
        // Keep only last 5 fallbacks
        if (this.fallbackCache.size > 5) {
          const firstKey = this.fallbackCache.keys().next().value;
          this.fallbackCache.delete(firstKey);
        }
      }

      this.cache.set('current', cacheEntry);
      this.lastUpdate = Date.now();

      

    } catch (error) {
      console.warn("⚠️ Primary connection failed, trying fallback...");
      
      // Try fallback RPC endpoints
      await this.tryFallbackEndpoints();
    }
  }

  // Try fallback RPC endpoints
  async tryFallbackEndpoints() {
    for (let i = 0; i < this.rpcEndpoints.length; i++) {
      try {
        const endpoint = this.rpcEndpoints[i];
        const tempConnection = new Connection(endpoint, 'processed');
        const blockhashInfo = await tempConnection.getLatestBlockhash("processed");
        
        const cacheEntry = {
          blockhash: blockhashInfo.blockhash,
          lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
          timestamp: Date.now(),
          source: `fallback_${i}`
        };

        this.cache.set('current', cacheEntry);
        this.lastUpdate = Date.now();
        console.log(`✅ Fallback endpoint ${i} succeeded`);
        return;
        
      } catch (error) {
        console.warn(`❌ Fallback endpoint ${i} failed:`, error.message);
      }
    }
    
    console.error("❌ All RPC endpoints failed");
  }

  // Ultra-fast synchronous access
  getBlockhashSync() {
    const current = this.cache.get('current');
    if (!current) return null;
    
    const age = Date.now() - current.timestamp;
    if (age > this.maxCacheAge) {
      return null; // Too old
    }
    
    return current.blockhash;
  }

  // Ultra-fast async access
  async getBlockhash() {
    const current = this.cache.get('current');
    
    if (!current || (Date.now() - current.timestamp) > this.maxCacheAge) {
      await this.updateBlockhash();
      return this.cache.get('current')?.blockhash || null;
    }
    
    return current.blockhash;
  }

  // Get blockhash for trading (with validation)
  getBlockhashForTrading() {
    const current = this.cache.get('current');
    if (!current) return null;
    
    const age = Date.now() - current.timestamp;
    if (age > this.maxCacheAge) {
      // Try fallback cache
      for (const [blockhash, entry] of this.fallbackCache) {
        if ((Date.now() - entry.timestamp) <= this.maxCacheAge) {
          return blockhash;
        }
      }
      return null;
    }
    
    return current.blockhash;
  }

  // Get fresh blockhash (force update)
  async getFreshBlockhash() {
    await this.updateBlockhash();
    return this.cache.get('current')?.blockhash || null;
  }

  // Get blockhash with metadata
  getBlockhashWithInfo() {
    const current = this.cache.get('current');
    if (!current) return null;
    
    return {
      blockhash: current.blockhash,
      age: Date.now() - current.timestamp,
      isValid: (Date.now() - current.timestamp) <= this.maxCacheAge,
      source: current.source,
      lastValidBlockHeight: current.lastValidBlockHeight
    };
  }

  // Get cache status
  getStatus() {
    const current = this.cache.get('current');
    return {
      isRunning: this.isRunning,
      hasBlockhash: !!current,
      blockhashAge: current ? Date.now() - current.timestamp : 0,
      fallbackCount: this.fallbackCache.size,
      lastUpdate: this.lastUpdate,
      cacheSize: this.cache.size
    };
  }

  // Force immediate update
  async forceUpdate() {
    console.log("🚀 Forcing immediate blockhash update...");
    await this.updateBlockhash();
    return this.cache.get('current')?.blockhash || null;
  }

  // Clear cache
  clear() {
    this.cache.clear();
    this.fallbackCache.clear();
    this.lastUpdate = 0;
  }
}

// Export singleton instance
export const blockhashCache = new BlockhashCache();

// Export class for custom instances
export { BlockhashCache };
