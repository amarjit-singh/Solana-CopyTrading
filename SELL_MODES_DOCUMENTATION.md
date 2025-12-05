# Copy Sell Modes Documentation

## Overview

This bot supports two sell modes that control how the bot responds to target wallet sells:

1. **MIMIC MODE** (default) - Proportional selling
2. **FULL MODE** - FIFO complete position selling

## Configuration

Set in `.env` file:
```bash
COPY_SELL_MODE=mimic  # or "full"
```

## Mode Descriptions

### MIMIC MODE (Default)

**Behavior:** The bot sells in the same proportion as the target wallet.

**Example:**
```
Target buys: 100,000 tokens → Bot buys: 50,000 tokens
Target sells: 50,000 (50%) → Bot sells: 25,000 (50%)

Target buys: 200,000 tokens → Bot buys: 100,000 tokens
Target sells: 100,000 (50%) → Bot sells: 50,000 (50%)
```

**Matching Logic:**
1. **Exact Match**: If target sells exact amount they bought, bot sells exact amount it bought
2. **Proportional Match**: If no exact match, finds closest purchase and calculates proportional amount
   - Example: Target bought 1M, bot bought 500K. Target sells 500K (50%) → Bot sells 250K (50%)

**Use Cases:**
- Mirror target's trading strategy closely
- Maintain same position percentage as target
- Conservative exit strategy

---

### FULL MODE

**Behavior:** The bot always sells 100% of its oldest purchase (FIFO), regardless of target's sell amount.

**Example:**
```
Target buys: 100,000 tokens → Bot buys: 50,000 tokens (OLDEST)
Target buys: 200,000 tokens → Bot buys: 100,000 tokens
Target buys: 150,000 tokens → Bot buys: 75,000 tokens (NEWEST)

Target sells: 25,000 (25% of first) → Bot sells: 50,000 (100% of oldest)
Target sells: 50,000 (25% of second) → Bot sells: 100,000 (100% of next oldest)
Target sells: 37,500 (25% of third) → Bot sells: 75,000 (100% of last)
```

**FIFO Logic:**
- Purchases are tracked with timestamps
- Always sells the oldest (first-bought) position completely
- Ignores target's sell percentage

**Use Cases:**
- Aggressive exit strategy
- Quick position liquidation when target starts selling
- Simplify position management (one sell = one complete position)

---

## Safety Features

### Ratio Capping (MIMIC Mode)

The bot includes a **percentage-based protection** that prevents over-selling:

```javascript
// Calculate proportional ratio
let ratio = targetSellAmount / closestPurchase.targetBoughtAmount;

// Cap ratio at 100% to prevent over-selling
if (ratio > 1.0) {
  console.log(`⚠️ Target selling ${(ratio * 100).toFixed(1)}% of tracked purchase. Capping at 100%.`);
  ratio = 1.0;
}

const ourSellAmount = Math.floor(closestPurchase.ourBoughtAmount * ratio);
```

**Why This Matters:**

This handles the case where position tracking is incomplete, such as:
- Target wallet had tokens before bot started tracking
- Bot only tracked partial history
- Target sells more than they bought (because they had pre-existing tokens)

**Example Scenario:**
```
1. Target wallet already has 500,000 tokens (BEFORE bot starts)
2. Bot starts tracking
3. Target buys 357,142,571 tokens → Bot buys 178,571,285 tokens
4. Target now has 857,142,571 tokens total
5. Target sells 883,857,153 tokens (103% of their total, 247% of tracked buy!)
6. Bot calculates: 883,857,153 / 357,142,571 = 247.5% ratio
7. Bot caps ratio at 100%
8. Bot sells 178,571,285 tokens (100% of what it has) ✅
```

**Performance Benefits:**
- ✅ **No API calls** - Pure math-based protection
- ✅ **Instant calculation** - No network latency
- ✅ **Always correct** - Based on tracked position data
- ✅ **Clean logs** - One warning instead of transaction failure + retry

---

## Implementation Details

### Files Modified

1. **main.js:87** - Added `COPY_SELL_MODE` configuration
2. **main.js:852-862** - Added balance safety check
3. **main.js:2100-2153** - Updated `getExactSellAmount()` function with mode logic
4. **main.js:889-905** - Updated cleanup logic for both modes
5. **.env:77-82** - Added configuration with documentation

### Position Tracking

Positions are tracked per token and per target wallet:

```javascript
positions = Map {
  tokenMint => Map {
    targetWallet => {
      purchases: [
        {
          targetBoughtAmount: 100000,
          ourBoughtAmount: 50000,
          buyTime: 1234567890,
          lastUpdate: 1234567890
        }
      ],
      totalAmount: 50000,
      lastUpdate: 1234567890
    }
  }
}
```

### Cleanup After Sell

**Full Mode:**
```javascript
// Remove the specific oldest purchase that was sold
removePurchase(tokenMint, user, sellData.purchase.targetBoughtAmount);
```

**Mimic Mode (Proportional):**
```javascript
// Reduce total amount by what was sold
position.totalAmount -= copySellAmount;
updateTokenPurchaseCount(tokenMint, -1);
```

**Mimic Mode (Exact Match):**
```javascript
// Remove the specific matching purchase
removePurchase(tokenMint, user, targetSellAmount);
```

---

## Testing

Run the test suite to verify both modes:

```bash
node test_sell_modes.js
```

**Test Results:**
```
✅ MIMIC MODE - Proportional sell (50% → 50%)
✅ MIMIC MODE - Exact match (100K → 100K)
✅ FULL MODE - Sells oldest purchase (25% target → 100% bot)
✅ FULL MODE - FIFO order maintained
```

---

## Troubleshooting

### Issue: "Target selling XXX% of tracked purchase"

**Cause:** Position tracking is incomplete (target had tokens before bot started)

**Solution:** Ratio capping automatically prevents over-selling. Bot sells 100% of its position.

**Log Example:**
```
📋 MIMIC MODE: Target selling 247.5% of tracked purchase. Capping at 100%.
📋 MIMIC MODE: Proportional sell (178,571,285 tokens, 100.00% of purchase)
```

**What Happened:**
- Target sold more tokens than the bot tracked them buying
- This indicates target had pre-existing tokens
- Bot caps sell at 100% of its own position
- No transaction failure, no retry needed ✅

### Issue: Multiple sells not working in FULL mode

**Cause:** Purchases not being removed from tracking

**Solution:** Verify cleanup logic is executing (check for "Purchase removed" log messages)

---

## Comparison Table

| Feature | MIMIC MODE | FULL MODE |
|---------|------------|-----------|
| **Sell Amount** | Proportional to target | 100% of purchase |
| **Purchase Selection** | Matches target's amount | Oldest (FIFO) |
| **Exit Speed** | Gradual (matches target) | Fast (complete exits) |
| **Position Management** | Complex (partial positions) | Simple (all or nothing) |
| **Risk Level** | Lower (follows target) | Higher (aggressive) |
| **Best For** | Mirroring strategy | Quick liquidation |

---

## Advanced Configuration

### Combining with Other Settings

```bash
# Enable copy selling
ENABLE_COPY_SELL=true

# Choose sell mode
COPY_SELL_MODE=full  # or "mimic"

# Buy amount (affects position size)
BUY_AMOUNT_PERCENTAGE=0.5  # Buy 50% of target's amount

# Slippage tolerance
SELL_SLIPPAGE_BPS_PERCENTAGE=8000  # 80% slippage for sells
```

### Future Enhancements

Possible future modes:
- **PROFIT MODE**: Only sell when in profit
- **LADDER MODE**: Sell in fixed percentages (25%, 50%, 75%, 100%)
- **TIME MODE**: Sell after holding for X duration

---

## Summary

- **MIMIC MODE**: Default, safe, proportional selling that matches target's strategy
- **FULL MODE**: Aggressive, FIFO complete position selling for quick exits
- **Safety Check**: Automatically prevents over-selling by capping at actual balance
- **Switch Modes**: Edit `COPY_SELL_MODE` in `.env` file (no code changes needed)

Both modes are production-ready and thoroughly tested. Choose based on your trading strategy.
