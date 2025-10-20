#!/bin/bash
# Pre-flight Checklist - Run this before starting the bot

echo "🚀 Copy Trading Bot - Pre-flight Checklist"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Check 1: Node.js version
echo "1. Checking Node.js version..."
NODE_VERSION=$(node --version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "   ✅ Node.js installed: $NODE_VERSION"
    MAJOR=$(echo $NODE_VERSION | cut -d. -f1 | sed 's/v//')
    if [ $MAJOR -lt 16 ]; then
        echo "   ⚠️  WARNING: Node.js 16+ recommended (you have v$MAJOR)"
    fi
else
    echo "   ❌ Node.js not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 2: Dependencies
echo "2. Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules exists"
else
    echo "   ❌ node_modules missing - run: npm install"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 3: .env file
echo "3. Checking .env configuration..."
if [ -f ".env" ]; then
    echo "   ✅ .env file exists"
    
    # Check required variables
    REQUIRED_VARS=("ENCODED_PRIVATE_KEY" "PUB_KEY" "COPY_WALLET" "RPC_URL" "GRPC_ENDPOINT" "GRPCTOKEN" "BUY_AMOUNT")
    
    for VAR in "${REQUIRED_VARS[@]}"; do
        VALUE=$(grep "^$VAR=" .env | cut -d= -f2-)
        if [ -z "$VALUE" ] || [ "$VALUE" = "<REPLACE_ME>" ]; then
            echo "   ❌ $VAR not set or still has placeholder"
            ERRORS=$((ERRORS + 1))
        else
            if [ "$VAR" = "COPY_WALLET" ]; then
                echo "   ✅ $VAR: ${VALUE:0:20}..."
            elif [ "$VAR" = "BUY_AMOUNT" ]; then
                echo "   ✅ $VAR: $VALUE SOL"
                # Warn if too high
                if (( $(echo "$VALUE > 0.1" | bc -l) )); then
                    echo "   ⚠️  WARNING: BUY_AMOUNT > 0.1 SOL - consider starting smaller"
                fi
            else
                echo "   ✅ $VAR: [SET]"
            fi
        fi
    done
else
    echo "   ❌ .env file not found - copy from .env.example"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 4: Buy filter settings
echo "4. Checking buy filter settings..."
FILTER_VARS=("MIN_HOLDERS" "MAX_HOLDERS" "MAX_TOP10_PERCENTAGE" "MIN_LIQUIDITY" "MAX_LIQUIDITY")
FILTER_MISSING=0

for VAR in "${FILTER_VARS[@]}"; do
    VALUE=$(grep "^$VAR=" .env 2>/dev/null | cut -d= -f2-)
    if [ -z "$VALUE" ]; then
        FILTER_MISSING=$((FILTER_MISSING + 1))
    else
        echo "   ✅ $VAR: $VALUE"
    fi
done

if [ $FILTER_MISSING -gt 0 ]; then
    echo "   ⚠️  WARNING: $FILTER_MISSING filter variable(s) not set (will use defaults)"
fi
echo ""

# Check 5: Syntax validation
echo "5. Running syntax checks..."
if node --check main.js 2>/dev/null; then
    echo "   ✅ main.js syntax OK"
else
    echo "   ❌ main.js has syntax errors"
    ERRORS=$((ERRORS + 1))
fi

if node --check alert.js 2>/dev/null; then
    echo "   ✅ alert.js syntax OK"
else
    echo "   ❌ alert.js has syntax errors"
    ERRORS=$((ERRORS + 1))
fi

if node --check swap.js 2>/dev/null; then
    echo "   ✅ swap.js syntax OK"
else
    echo "   ❌ swap.js has syntax errors"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 6: Test scripts
echo "6. Test scripts available..."
if [ -f "test_copy_logic.js" ]; then
    echo "   ✅ test_copy_logic.js exists"
else
    echo "   ⚠️  test_copy_logic.js not found"
fi

if [ -f "test_simulation.js" ]; then
    echo "   ✅ test_simulation.js exists"
else
    echo "   ⚠️  test_simulation.js not found"
fi
echo ""

# Summary
echo "=========================================="
if [ $ERRORS -eq 0 ]; then
    echo "✅ Pre-flight check PASSED - Ready to start!"
    echo ""
    echo "Next steps:"
    echo "  1. Run tests: node test_copy_logic.js"
    echo "  2. Simulate: node test_simulation.js"
    echo "  3. Start bot: npm start"
else
    echo "❌ Pre-flight check FAILED - $ERRORS error(s) found"
    echo ""
    echo "Please fix the errors above before starting the bot."
    exit 1
fi
echo "=========================================="
