
import { Connection } from "@solana/web3.js";
// Ultra-fast blockhash management with intelligent caching and background updates
export class BlockhashManager {
  constructor(connection, updateInterval = 200) { // Set to 200ms as requested
    this.connection = connection;
    this.updateInterval = updateInterval;
    this.currentBlockhash = null;
    this.lastValidBlockHeight = null;
    this.isRunning = false;
    this.updatePromise = null;
    this.lastUpdateTime = 0;
    this.blockhashAge = 0;
    this.maxBlockhashAge = 5; // Max age in slots (1.5 seconds)
    this.fallbackBlockhashes = []; // Keep last 5 blockhashes as fallback
    this.maxFallbacks = 5;
    this.connectionHealth = true;
    this.consecutiveFailures = 0;
    this.maxFailures = 5;
    this.backgroundInterval = null;
    this.healthCheckInterval = null;
    this.stats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      lastError: null,
      averageUpdateTime: 0
    };
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("🔄 Starting ultra-fast background blockhash manager (200ms updates)...");
    
    // Immediate first update
    await this.updateBlockhash();
    
    // Start background updates with setInterval for consistent timing
    this.startBackgroundUpdates();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    console.log("✅ Background blockhash manager started successfully");
  }

  stop() {
    this.isRunning = false;
    
    // Clear intervals
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    console.log("⏹️ Stopping background blockhash manager...");
  }

  startBackgroundUpdates() {
    // Use setInterval for consistent 200ms updates
    this.backgroundInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.updateBlockhash();
      }
    }, this.updateInterval);
  }

  async updateBlockhash() {
    if (this.updatePromise) {
      return this.updatePromise; // Prevent multiple simultaneous updates
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
    this.stats.totalUpdates++;
    
    try {
      const blockhashInfo = await this.connection.getLatestBlockhash("processed");
      const endTime = performance.now();
      const updateTime = endTime - startTime;
      
      // Update average update time
      this.stats.averageUpdateTime = (this.stats.averageUpdateTime * (this.stats.successfulUpdates) + updateTime) / (this.stats.successfulUpdates + 1);
      this.stats.successfulUpdates++;
      
      // Store old blockhash in fallback array
      if (this.currentBlockhash) {
        this.fallbackBlockhashes.unshift({
          blockhash: this.currentBlockhash,
          blockHeight: this.lastValidBlockHeight,
          timestamp: this.lastUpdateTime
        });
        
        // Keep only max fallbacks
        if (this.fallbackBlockhashes.length > this.maxFallbacks) {
          this.fallbackBlockhashes.pop();
        }
      }

      this.currentBlockhash = blockhashInfo.blockhash;
      this.lastValidBlockHeight = blockhashInfo.lastValidBlockHeight;
      this.lastUpdateTime = Date.now();
      this.blockhashAge = 0;
      this.connectionHealth = true;
      this.consecutiveFailures = 0;
      this.stats.lastError = null;

      // Log successful updates every 100 updates (every 20 seconds)
      if (this.stats.successfulUpdates % 100 === 0) {
        console.log(`🔄 Blockhash updated successfully (${this.stats.successfulUpdates} total) | Avg time: ${this.stats.averageUpdateTime.toFixed(2)}ms`);
      }
      
    } catch (error) {
      this.consecutiveFailures++;
      this.connectionHealth = false;
      this.stats.failedUpdates++;
      this.stats.lastError = error.message;
      
      console.error("❌ Failed to update blockhash:", error.message);
      
      // Use fallback blockhash if available
      if (this.fallbackBlockhashes.length > 0) {
        const fallback = this.fallbackBlockhashes[0];
        this.currentBlockhash = fallback.blockhash;
        this.lastValidBlockHeight = fallback.blockHeight;
        console.log("🔄 Using fallback blockhash");
      }
      
      // If too many consecutive failures, try to recover
      if (this.consecutiveFailures >= this.maxFailures) {
        console.warn("⚠️ Too many consecutive failures, attempting recovery...");
        this.consecutiveFailures = 0;
      }
    }
  }

  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(() => {
      if (this.lastUpdateTime > 0) {
        this.blockhashAge = Math.floor((Date.now() - this.lastUpdateTime) / 400); // Approximate slots
        
        // If blockhash is getting old, force update
        if (this.blockhashAge > this.maxBlockhashAge) {
          console.log("⚠️ Blockhash getting old, forcing update...");
          this.updateBlockhash();
        }
      }
    }, 1000); // Check every second
  }

  getBlockhashSync() {
    // Ultra-fast synchronous access - no validation
    if (!this.currentBlockhash) {
      console.warn("⚠️ No cached blockhash available in sync mode");
      return null;
    }
    return this.currentBlockhash;
  }

  async getBlockhash() {
    // Ultra-fast async access with smart fallback
    if (!this.currentBlockhash) {
      console.log("⚠️ No cached blockhash, fetching immediately...");
      await this.updateBlockhash();
    }

    // Return immediately - background process keeps it fresh
    return this.currentBlockhash;
  }

  // Ultra-fast method for trading operations
  getBlockhashForTrading() {
    // Use current blockhash if available and not too old
    if (this.currentBlockhash && this.blockhashAge < this.maxBlockhashAge) {
      return this.currentBlockhash;
    }
    
    // Use fallback if available
    if (this.fallbackBlockhashes.length > 0) {
      return this.fallbackBlockhashes[0].blockhash;
    }
    
    return null;
  }

  // Method for when you need a guaranteed fresh blockhash
  async getFreshBlockhash() {
    await this.updateBlockhash();
    return this.currentBlockhash;
  }

  // Get blockhash with age validation
  getBlockhashWithAge() {
    return {
      blockhash: this.currentBlockhash,
      age: this.blockhashAge,
      isValid: this.blockhashAge < this.maxBlockhashAge,
      lastUpdate: this.lastUpdateTime
    };
  }

  getLastValidBlockHeight() {
    return this.lastValidBlockHeight;
  }

  // Get manager status with detailed statistics
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasBlockhash: !!this.currentBlockhash,
      blockhashAge: this.blockhashAge,
      connectionHealth: this.connectionHealth,
      consecutiveFailures: this.consecutiveFailures,
      fallbackCount: this.fallbackBlockhashes.length,
      lastUpdate: this.lastUpdateTime,
      updateInterval: this.updateInterval,
      stats: this.stats
    };
  }

  // Force immediate update (for critical operations)
  async forceUpdate() {
    console.log("🚀 Forcing immediate blockhash update...");
    await this.updateBlockhash();
    console.log("✅ Forced blockhash update completed", this.currentBlockhash);
    return this.currentBlockhash;
  }

  // Get performance statistics
  getPerformanceStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalUpdates > 0 ? (this.stats.successfulUpdates / this.stats.totalUpdates * 100).toFixed(2) : 0,
      averageUpdateTime: this.stats.averageUpdateTime.toFixed(2),
      uptime: this.isRunning ? Date.now() - this.lastUpdateTime : 0
    };
  }
} 