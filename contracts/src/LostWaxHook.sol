// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ILostWax} from "./interfaces/ILostWax.sol";
import {ShadowMath} from "./libraries/ShadowMath.sol";

/// @title LostWax
/// @notice Curated liquidity that has to prove itself first.
///         Wax: a strategy runs as a shadow position scored against a lazy full-range LP.
///         Bronze: once it beats the lazy LP over the trial, it becomes a real vault.
///         Curators are paid a cut of outperformance only, as diluting shares.
/// @dev Only afterInitialize and afterSwap are enabled in the address bits, so the PoolManager never calls
///      any other IHooks function; leaving them out (no fallback, so they revert) keeps us under EIP-170.
contract LostWaxHook is IUnlockCallback, ILostWax {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    uint256 public constant NOTIONAL = 1e24; // shadow size, token1 units
    uint256 public constant MAX_TRACKED = 16; // wax trials per pool, bounds afterSwap gas
    uint256 public constant MAX_VAULTS = 8; // bronze vaults per pool snapshotted from afterSwap
    uint256 public constant MAX_HISTORY = 96;
    uint16 public constant MAX_ALPHA_FEE_BPS = 3000;
    /// @notice Largest tick move inside one block before price-sensitive actions are refused.
    int24 public constant MAX_TICK_DEVIATION = 200;
    /// @notice Price limit on the vault's own rebalance swaps, in ticks from spot.
    int24 public constant MAX_SWAP_TICKS = 100;

    // keccak256("lostwax.lock"), transient storage
    bytes32 private constant LOCK_SLOT = 0x6581e56a9bfe44805841b02b0793a42a2139babd42bb8233e1089def82b6f6e6;

    uint8 private constant POKE = 0;
    uint8 private constant DEPOSIT = 1;
    uint8 private constant WITHDRAW = 2;
    uint8 private constant REBALANCE = 3;

    IPoolManager public immutable poolManager;
    uint64 public immutable trialDuration;
    uint64 public immutable snapshotInterval;

    struct PoolState {
        bool registered;
        int24 lastTick; // tick after the last swap seen
        int24 refTick; // tick at the start of refBlock, the same-block manipulation reference
        uint64 refBlock;
        uint256 lastGrowth0;
        uint256 lastGrowth1;
    }

    struct Strategy {
        PoolKey key;
        address curator;
        Stage stage;
        Mandate mandate;
        int24 tickLower;
        int24 tickUpper;
        uint64 createdAt;
        uint64 castAt;
        uint64 lastRebalance;
        uint64 lastSnapshot;
        // wax shadow
        uint128 waxLiquidity;
        uint256 waxFees0;
        uint256 waxFees1;
        // lazy LP benchmark: full range, never moves
        uint128 benchLiquidity;
        uint256 benchGrowth0;
        uint256 benchGrowth1;
        // bronze vault
        uint128 liquidity;
        uint256 idle0;
        uint256 idle1;
        uint256 totalShares;
        uint256 highWater; // excess share price over bench already charged
        int256 trialAlphaBps;
        string name;
    }

    struct CallbackData {
        uint8 action;
        uint256 id;
        address user;
        uint128 liquidity;
        int24 tickLower;
        int24 tickUpper;
    }

    mapping(PoolId => PoolState) public pools;
    mapping(PoolId => uint256[]) internal tracked; // wax trials
    mapping(PoolId => uint256[]) internal vaults; // bronze vaults with automatic snapshots
    Strategy[] internal strategies;
    mapping(uint256 => mapping(address => uint256)) public sharesOf;
    mapping(uint256 => mapping(address => uint256)) public costBasis;
    mapping(uint256 => Snapshot[]) internal history;
    mapping(uint256 => uint256) internal historyHead;

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @dev Transient lock. PoolManager.unlock already blocks nested unlocks; this also covers token callbacks.
    modifier nonReentrant() {
        _enter();
        _;
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 0)
        }
    }

    function _enter() private {
        bool locked;
        assembly ("memory-safe") {
            locked := tload(LOCK_SLOT)
        }
        if (locked) revert Reentrancy();
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 1)
        }
    }

    constructor(IPoolManager _poolManager, uint64 _trialDuration, uint64 _snapshotInterval) {
        poolManager = _poolManager;
        trialDuration = _trialDuration;
        snapshotInterval = _snapshotInterval;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: false,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ---------------------------------------------------------------
    // Hook callbacks
    // ---------------------------------------------------------------

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        onlyPoolManager
        returns (bytes4)
    {
        // Vault custody uses ERC20 transfers; pools with native ETH work as plain pools but are not registered.
        if (key.currency0.isAddressZero()) return IHooks.afterInitialize.selector;
        PoolId pid = key.toId();
        pools[pid] = PoolState({
            registered: true,
            lastTick: tick,
            refTick: tick,
            refBlock: uint64(block.number),
            lastGrowth0: 0,
            lastGrowth1: 0
        });
        emit PoolRegistered(PoolId.unwrap(pid));
        return IHooks.afterInitialize.selector;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        PoolId pid = key.toId();
        if (pools[pid].registered) _onSwap(pid, true);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev Shadows earn the pool's real fee growth for swaps they were in range for.
    ///      Also called after the hook's own swaps, which v4 does not report back to the hook.
    function _onSwap(PoolId pid, bool snapshots) internal {
        PoolState storage ps = pools[pid];
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(pid);
        (uint256 g0, uint256 g1) = poolManager.getFeeGrowthGlobals(pid);
        uint256 d0;
        uint256 d1;
        unchecked {
            d0 = g0 - ps.lastGrowth0;
            d1 = g1 - ps.lastGrowth1;
        }
        int24 prev = ps.lastTick;
        if (ps.refBlock != block.number) {
            ps.refBlock = uint64(block.number);
            ps.refTick = prev;
        }

        uint256[] storage ids = tracked[pid];
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            Strategy storage s = strategies[id];
            if (_inRange(s, prev) && _inRange(s, tick)) {
                s.waxFees0 += ShadowMath.feesFor(s.waxLiquidity, d0);
                s.waxFees1 += ShadowMath.feesFor(s.waxLiquidity, d1);
            }
            if (snapshots && block.timestamp >= s.lastSnapshot + snapshotInterval) _record(id, s, sqrtP, false);
        }
        if (snapshots) {
            ids = vaults[pid];
            for (uint256 i; i < ids.length; ++i) {
                Strategy storage s = strategies[ids[i]];
                if (block.timestamp >= s.lastSnapshot + snapshotInterval) _record(ids[i], s, sqrtP, false);
            }
        }

        ps.lastTick = tick;
        ps.lastGrowth0 = g0;
        ps.lastGrowth1 = g1;
    }

    // ---------------------------------------------------------------
    // Curator flow
    // ---------------------------------------------------------------

    /// @notice Start a wax trial. Costs gas only.
    function sculpt(
        PoolKey calldata key,
        string calldata name,
        int24 tickLower,
        int24 tickUpper,
        Mandate calldata mandate
    ) external returns (uint256 id) {
        PoolId pid = key.toId();
        if (!pools[pid].registered) revert UnknownPool();
        _checkRange(key.tickSpacing, tickLower, tickUpper);
        uint256 nameLen = bytes(name).length;
        if (mandate.maxTickMove <= 0 || mandate.alphaFeeBps > MAX_ALPHA_FEE_BPS || nameLen == 0 || nameLen > 32) {
            revert BadMandate();
        }
        if (tracked[pid].length >= MAX_TRACKED) revert TooManyStrategies();

        id = strategies.length;
        strategies.push();
        Strategy storage s = strategies[id];
        s.key = key;
        s.curator = msg.sender;
        s.stage = Stage.Wax;
        s.mandate = mandate;
        s.tickLower = tickLower;
        s.tickUpper = tickUpper;
        s.name = name;
        s.createdAt = uint64(block.timestamp);
        s.lastRebalance = uint64(block.timestamp);

        uint160 sqrtP = _guardedPrice(pid);
        s.waxLiquidity = ShadowMath.liquidityForValue(sqrtP, tickLower, tickUpper, NOTIONAL);
        _resetBench(s, sqrtP);
        tracked[pid].push(id);

        emit Sculpted(id, msg.sender, PoolId.unwrap(pid), name, tickLower, tickUpper);
        _record(id, s, sqrtP, false);
    }

    /// @notice Turn a qualified wax model into a live vault.
    function cast(uint256 id) external {
        Strategy storage s = strategies[id];
        if (s.stage != Stage.Wax) revert WrongStage();
        if (msg.sender != s.curator) revert NotCurator();
        if (block.timestamp < s.createdAt + trialDuration) revert TrialRunning();

        PoolId pid = s.key.toId();
        uint160 sqrtP = _guardedPrice(pid);
        (uint256 strat, uint256 bench) = _indices(id, s, sqrtP);
        if (strat <= bench) revert NotQualified();

        s.trialAlphaBps = _alphaBps(strat, bench);
        s.stage = Stage.Bronze;
        s.castAt = uint64(block.timestamp);
        s.waxLiquidity = 0;
        s.waxFees0 = 0;
        s.waxFees1 = 0;
        // free the wax slot; keep automatic snapshots while there is room
        _untrack(tracked[pid], id);
        if (vaults[pid].length < MAX_VAULTS) vaults[pid].push(id);
        emit Cast(id, s.trialAlphaBps);
    }

    /// @notice Close a wax model. Curator any time. Anyone once a trial ended behind the lazy LP,
    ///         or once a finished trial was left uncast for another full trial length (frees the slot).
    function retire(uint256 id) external {
        Strategy storage s = strategies[id];
        if (s.stage != Stage.Wax) revert WrongStage();
        PoolId pid = s.key.toId();
        if (msg.sender != s.curator) {
            if (block.timestamp < s.createdAt + trialDuration) revert TrialRunning();
            if (block.timestamp < s.createdAt + 2 * uint256(trialDuration)) {
                (uint256 strat, uint256 bench) = _indices(id, s, _guardedPrice(pid));
                if (strat > bench) revert NotCurator();
            }
        }
        s.stage = Stage.Retired;
        _untrack(tracked[pid], id);
        emit Retired(id);
    }

    /// @notice Curator move, bounded by the mandate.
    function rebalance(uint256 id, int24 tickLower, int24 tickUpper) external nonReentrant {
        Strategy storage s = _live(id);
        if (msg.sender != s.curator) revert NotCurator();
        _checkRange(s.key.tickSpacing, tickLower, tickUpper);
        int256 move = (int256(tickLower) + tickUpper) / 2 - (int256(s.tickLower) + s.tickUpper) / 2;
        if (_abs(move) > uint256(int256(s.mandate.maxTickMove))) revert MoveTooLarge();
        _checkCooldown(s);
        _guardedPrice(s.key.toId());
        _rebalance(id, s, tickLower, tickUpper, false);
    }

    /// @notice Permissionless recenter when the mandate's rule fires. Move is clamped to maxTickMove.
    function recenter(uint256 id) external nonReentrant {
        Strategy storage s = _live(id);
        _guardedPrice(s.key.toId());
        (bool ok, int24 lo, int24 hi) = _recenterTarget(s);
        if (!ok) revert NotTriggered();
        _checkCooldown(s);
        _rebalance(id, s, lo, hi, true);
    }

    /// @notice Record a history point. Rate limited.
    function checkpoint(uint256 id) external {
        Strategy storage s = _live(id);
        if (block.timestamp < s.lastSnapshot + snapshotInterval) revert Cooldown();
        (uint160 sqrtP,,,) = poolManager.getSlot0(s.key.toId());
        _record(id, s, sqrtP, false);
    }

    function _rebalance(uint256 id, Strategy storage s, int24 lo, int24 hi, bool automatic) internal {
        PoolId pid = s.key.toId();
        (uint160 sqrtP,,,) = poolManager.getSlot0(pid);

        if (s.stage == Stage.Wax) {
            // shadows convert at spot, no swap needed
            uint256 v = _waxValue(s, sqrtP);
            s.waxLiquidity = ShadowMath.liquidityForValue(sqrtP, lo, hi, v);
            s.waxFees0 = 0;
            s.waxFees1 = 0;
            s.tickLower = lo;
            s.tickUpper = hi;
        } else if (s.liquidity == 0 && s.idle0 == 0 && s.idle1 == 0) {
            s.tickLower = lo;
            s.tickUpper = hi;
        } else {
            poolManager.unlock(abi.encode(CallbackData(REBALANCE, id, address(0), 0, lo, hi)));
            (sqrtP,,,) = poolManager.getSlot0(pid);
        }

        s.lastRebalance = uint64(block.timestamp);
        emit Rebalanced(id, lo, hi, automatic);
        _record(id, s, sqrtP, true);
    }

    // ---------------------------------------------------------------
    // Depositor flow
    // ---------------------------------------------------------------

    /// @notice Add both tokens at the vault's ratio. Pulls at most the max amounts.
    function deposit(uint256 id, uint256 amount0Max, uint256 amount1Max, uint256 minShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        Strategy storage s = strategies[id];
        if (s.stage != Stage.Bronze) revert WrongStage();
        uint160 sqrtP = _guardedPrice(s.key.toId());
        _sync(id, s);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(s.tickLower),
            TickMath.getSqrtPriceAtTick(s.tickUpper),
            amount0Max,
            amount1Max
        );
        if (liq == 0) revert ZeroAmount();

        uint256 valueBefore = _vaultValue(id, s, sqrtP, false);
        uint256 supply = s.totalShares;

        (uint256 used0, uint256 used1) = abi.decode(
            poolManager.unlock(abi.encode(CallbackData(DEPOSIT, id, msg.sender, liq, 0, 0))), (uint256, uint256)
        );
        if (used0 > amount0Max || used1 > amount1Max) revert Slippage();
        uint256 v = ShadowMath.value(sqrtP, used0, used1);

        if (supply == 0) {
            // fresh vault: shares start at 1 per token1 of value, benchmark starts now
            shares = v;
            _resetBench(s, sqrtP);
            s.highWater = 0;
            delete history[id];
            historyHead[id] = 0;
        } else {
            shares = FullMath.mulDiv(v, supply, valueBefore);
        }
        if (shares == 0 || shares < minShares) revert Slippage();

        s.totalShares = supply + shares;
        sharesOf[id][msg.sender] += shares;
        costBasis[id][msg.sender] += v;

        emit Deposited(id, msg.sender, shares, used0, used1);
        _record(id, s, sqrtP, false);
    }

    /// @notice Exit any time, pro rata of liquidity and idle balances.
    function withdraw(uint256 id, uint256 shares, uint256 min0, uint256 min1)
        external
        nonReentrant
        returns (uint256 out0, uint256 out1)
    {
        Strategy storage s = strategies[id];
        if (s.stage != Stage.Bronze) revert WrongStage();
        uint256 owned = sharesOf[id][msg.sender];
        if (shares == 0 || shares > owned) revert ZeroAmount();
        _sync(id, s);

        uint256 supply = s.totalShares;
        uint128 liqOut = uint128(FullMath.mulDiv(s.liquidity, shares, supply));
        uint256 idleOut0 = FullMath.mulDiv(s.idle0, shares, supply);
        uint256 idleOut1 = FullMath.mulDiv(s.idle1, shares, supply);
        s.idle0 -= idleOut0;
        s.idle1 -= idleOut1;

        costBasis[id][msg.sender] -= FullMath.mulDiv(costBasis[id][msg.sender], shares, owned);
        sharesOf[id][msg.sender] = owned - shares;
        s.totalShares = supply - shares;

        if (liqOut > 0) {
            (out0, out1) = abi.decode(
                poolManager.unlock(abi.encode(CallbackData(WITHDRAW, id, msg.sender, liqOut, 0, 0))), (uint256, uint256)
            );
        }
        if (idleOut0 > 0) IERC20(Currency.unwrap(s.key.currency0)).safeTransfer(msg.sender, idleOut0);
        if (idleOut1 > 0) IERC20(Currency.unwrap(s.key.currency1)).safeTransfer(msg.sender, idleOut1);
        out0 += idleOut0;
        out1 += idleOut1;
        if (out0 < min0 || out1 < min1) revert Slippage();

        emit Withdrawn(id, msg.sender, shares, out0, out1);
        (uint160 sqrtP,,,) = poolManager.getSlot0(s.key.toId());
        _record(id, s, sqrtP, false);
    }

    /// @notice Collect fees and charge the alpha fee. Anyone can call.
    function harvest(uint256 id) external nonReentrant {
        Strategy storage s = strategies[id];
        if (s.stage != Stage.Bronze) revert WrongStage();
        _sync(id, s);
    }

    function _sync(uint256 id, Strategy storage s) internal {
        if (s.liquidity > 0) poolManager.unlock(abi.encode(CallbackData(POKE, id, address(0), 0, 0, 0)));
        _harvest(id, s);
    }

    /// @dev Fee only on new excess over the lazy LP, paid by minting shares.
    ///      Skipped (not reverted) while the price is off its block-start level, so exits never block.
    function _harvest(uint256 id, Strategy storage s) internal {
        uint256 supply = s.totalShares;
        if (supply == 0) return;
        PoolId pid = s.key.toId();
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(pid);
        if (!_priceSteady(pid, tick)) return;
        uint256 v = _vaultValue(id, s, sqrtP, false);
        (uint256 feeValue, uint256 excess, uint256 bench) = _alphaFee(s, sqrtP, v, supply);
        if (excess <= s.highWater) return;
        if (feeValue == 0 || feeValue >= v) {
            s.highWater = excess;
            return;
        }

        uint256 feeShares = FullMath.mulDiv(feeValue, supply, v - feeValue);
        s.totalShares = supply + feeShares;
        sharesOf[id][s.curator] += feeShares;
        uint256 price = FullMath.mulDiv(v, 1e18, s.totalShares);
        s.highWater = price > bench ? price - bench : 0;
        emit AlphaFee(id, s.curator, feeShares, feeValue);
    }

    function _alphaFee(Strategy storage s, uint160 sqrtP, uint256 v, uint256 supply)
        internal
        view
        returns (uint256 feeValue, uint256 excess, uint256 bench)
    {
        uint256 price = FullMath.mulDiv(v, 1e18, supply);
        bench = FullMath.mulDiv(_benchValue(s, sqrtP), 1e18, NOTIONAL);
        if (price <= bench) return (0, 0, bench);
        excess = price - bench;
        if (excess <= s.highWater) return (0, excess, bench);
        uint256 alphaValue = FullMath.mulDiv(excess - s.highWater, supply, 1e18);
        feeValue = alphaValue * s.mandate.alphaFeeBps / 10_000;
    }

    // ---------------------------------------------------------------
    // PoolManager unlock
    // ---------------------------------------------------------------

    function unlockCallback(bytes calldata raw) external onlyPoolManager returns (bytes memory) {
        CallbackData memory d = abi.decode(raw, (CallbackData));
        Strategy storage s = strategies[d.id];

        if (d.action == POKE) {
            _modify(s, d.id, s.tickLower, s.tickUpper, 0);
            _close(s);
            return "";
        }

        if (d.action == DEPOSIT) {
            BalanceDelta p = _modify(s, d.id, s.tickLower, s.tickUpper, int256(uint256(d.liquidity)));
            uint256 used0 = uint256(int256(-p.amount0()));
            uint256 used1 = uint256(int256(-p.amount1()));
            _pay(s.key.currency0, d.user, used0);
            _pay(s.key.currency1, d.user, used1);
            s.liquidity += d.liquidity;
            _close(s);
            return abi.encode(used0, used1);
        }

        if (d.action == WITHDRAW) {
            BalanceDelta p = _modify(s, d.id, s.tickLower, s.tickUpper, -int256(uint256(d.liquidity)));
            uint256 out0 = uint256(int256(p.amount0()));
            uint256 out1 = uint256(int256(p.amount1()));
            if (out0 > 0) poolManager.take(s.key.currency0, d.user, out0);
            if (out1 > 0) poolManager.take(s.key.currency1, d.user, out1);
            s.liquidity -= d.liquidity;
            _close(s);
            return abi.encode(out0, out1);
        }

        _rebalanceVault(d.id, s, d.tickLower, d.tickUpper);
        return "";
    }

    /// @dev Pull everything, swap toward the new range's ratio, redeploy. Leftovers stay idle.
    function _rebalanceVault(uint256 id, Strategy storage s, int24 lo, int24 hi) internal {
        PoolId pid = s.key.toId();
        if (s.liquidity > 0) {
            _modify(s, id, s.tickLower, s.tickUpper, -int256(uint256(s.liquidity)));
            s.liquidity = 0;
        }
        s.tickLower = lo;
        s.tickUpper = hi;

        (uint160 sqrtP,,,) = poolManager.getSlot0(pid);
        (uint256 a0, uint256 a1) = _available(s);
        _swapToRatio(s, sqrtP, a0, a1);

        (sqrtP,,,) = poolManager.getSlot0(pid);
        (a0, a1) = _available(s);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(lo),
            TickMath.getSqrtPriceAtTick(hi),
            a0 > 0 ? a0 - 1 : 0, // keep pool rounding on our side
            a1 > 0 ? a1 - 1 : 0
        );
        if (liq > 0) {
            _modify(s, id, lo, hi, int256(uint256(liq)));
            s.liquidity = liq;
        }
        _close(s);
    }

    function _swapToRatio(Strategy storage s, uint160 sqrtP, uint256 a0, uint256 a1) internal {
        uint256 total = ShadowMath.value(sqrtP, a0, a1);
        if (total == 0) return;
        (uint256 u0, uint256 u1) = ShadowMath.amountsFor(sqrtP, s.tickLower, s.tickUpper, ShadowMath.UNIT);
        uint256 unit0 = ShadowMath.value(sqrtP, u0, 0);
        uint256 target0 = FullMath.mulDiv(total, unit0, unit0 + u1);
        uint256 cur0 = ShadowMath.value(sqrtP, a0, 0);
        uint256 dust = total / 1000;

        if (cur0 > target0 + dust) {
            uint256 sell0 = ShadowMath.toToken0(sqrtP, cur0 - target0);
            _swap(s.key, true, sell0 > a0 ? a0 : sell0);
        } else if (target0 > cur0 + dust) {
            uint256 sell1 = target0 - cur0;
            _swap(s.key, false, sell1 > a1 ? a1 : sell1);
        }
    }

    /// @dev Exact-in swap capped at MAX_SWAP_TICKS of impact; any unfilled part stays idle.
    function _swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) internal {
        if (amountIn == 0) return;
        PoolId pid = key.toId();
        (, int24 tick,,) = poolManager.getSlot0(pid);
        int256 limit = zeroForOne ? int256(tick) - MAX_SWAP_TICKS : int256(tick) + MAX_SWAP_TICKS;
        if (limit <= TickMath.MIN_TICK) limit = TickMath.MIN_TICK + 1;
        if (limit >= TickMath.MAX_TICK) limit = TickMath.MAX_TICK - 1;
        poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(int24(limit))
            }),
            ""
        );
        // v4 skips hook callbacks for the hook's own swaps; keep shadow scoring and pool state exact
        _onSwap(pid, false);
    }

    function _modify(Strategy storage s, uint256 id, int24 lo, int24 hi, int256 liquidityDelta)
        internal
        returns (BalanceDelta principal)
    {
        (BalanceDelta callerDelta, BalanceDelta fees) = poolManager.modifyLiquidity(
            s.key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: liquidityDelta, salt: bytes32(id)}),
            ""
        );
        principal = callerDelta - fees;
    }

    function _available(Strategy storage s) internal view returns (uint256 a0, uint256 a1) {
        a0 = uint256(int256(s.idle0) + poolManager.currencyDelta(address(this), s.key.currency0));
        a1 = uint256(int256(s.idle1) + poolManager.currencyDelta(address(this), s.key.currency1));
    }

    function _pay(Currency c, address payer, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(c);
        IERC20(Currency.unwrap(c)).safeTransferFrom(payer, address(poolManager), amount);
        poolManager.settle();
    }

    /// @dev Settle whatever is left against the vault's idle balances.
    function _close(Strategy storage s) internal {
        s.idle0 = _closeOne(s.key.currency0, s.idle0);
        s.idle1 = _closeOne(s.key.currency1, s.idle1);
    }

    function _closeOne(Currency c, uint256 idle) internal returns (uint256) {
        int256 d = poolManager.currencyDelta(address(this), c);
        if (d > 0) {
            poolManager.take(c, address(this), uint256(d));
            return idle + uint256(d);
        }
        if (d < 0) {
            uint256 owed = uint256(-d);
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), owed);
            poolManager.settle();
            return idle - owed;
        }
        return idle;
    }

    // ---------------------------------------------------------------
    // Valuation
    // ---------------------------------------------------------------

    function _resetBench(Strategy storage s, uint160 sqrtP) internal {
        int24 sp = s.key.tickSpacing;
        s.benchLiquidity =
            ShadowMath.liquidityForValue(sqrtP, TickMath.minUsableTick(sp), TickMath.maxUsableTick(sp), NOTIONAL);
        (s.benchGrowth0, s.benchGrowth1) = poolManager.getFeeGrowthGlobals(s.key.toId());
    }

    function _benchValue(Strategy storage s, uint160 sqrtP) internal view returns (uint256) {
        int24 sp = s.key.tickSpacing;
        (uint256 g0, uint256 g1) = poolManager.getFeeGrowthGlobals(s.key.toId());
        uint256 f0;
        uint256 f1;
        unchecked {
            f0 = ShadowMath.feesFor(s.benchLiquidity, g0 - s.benchGrowth0);
            f1 = ShadowMath.feesFor(s.benchLiquidity, g1 - s.benchGrowth1);
        }
        return ShadowMath.positionValue(sqrtP, TickMath.minUsableTick(sp), TickMath.maxUsableTick(sp), s.benchLiquidity)
            + ShadowMath.value(sqrtP, f0, f1);
    }

    function _waxValue(Strategy storage s, uint160 sqrtP) internal view returns (uint256) {
        return ShadowMath.positionValue(sqrtP, s.tickLower, s.tickUpper, s.waxLiquidity)
            + ShadowMath.value(sqrtP, s.waxFees0, s.waxFees1);
    }

    function _vaultValue(uint256 id, Strategy storage s, uint160 sqrtP, bool withUncollected)
        internal
        view
        returns (uint256)
    {
        uint256 f0;
        uint256 f1;
        if (withUncollected) (f0, f1) = _uncollected(id, s);
        return ShadowMath.positionValue(sqrtP, s.tickLower, s.tickUpper, s.liquidity)
            + ShadowMath.value(sqrtP, s.idle0 + f0, s.idle1 + f1);
    }

    function _uncollected(uint256 id, Strategy storage s) internal view returns (uint256 f0, uint256 f1) {
        if (s.liquidity == 0) return (0, 0);
        PoolId pid = s.key.toId();
        (uint128 posLiq, uint256 last0, uint256 last1) =
            poolManager.getPositionInfo(pid, address(this), s.tickLower, s.tickUpper, bytes32(id));
        (uint256 in0, uint256 in1) = poolManager.getFeeGrowthInside(pid, s.tickLower, s.tickUpper);
        unchecked {
            f0 = ShadowMath.feesFor(posLiq, in0 - last0);
            f1 = ShadowMath.feesFor(posLiq, in1 - last1);
        }
    }

    /// @dev (strategy index, lazy LP index), both 1e18 at start.
    function _indices(uint256 id, Strategy storage s, uint160 sqrtP)
        internal
        view
        returns (uint256 strat, uint256 bench)
    {
        if (s.stage == Stage.Wax) {
            strat = FullMath.mulDiv(_waxValue(s, sqrtP), 1e18, NOTIONAL);
        } else if (s.stage == Stage.Bronze && s.totalShares > 0) {
            strat = FullMath.mulDiv(_vaultValue(id, s, sqrtP, true), 1e18, s.totalShares);
        } else {
            return (0, 0);
        }
        bench = FullMath.mulDiv(_benchValue(s, sqrtP), 1e18, NOTIONAL);
    }

    function _record(uint256 id, Strategy storage s, uint160 sqrtP, bool rebalanced) internal {
        s.lastSnapshot = uint64(block.timestamp);
        (uint256 strat, uint256 bench) = _indices(id, s, sqrtP);
        if (strat == 0) return;
        Snapshot memory snap = Snapshot(uint40(block.timestamp), _u104(strat), _u104(bench), rebalanced);
        Snapshot[] storage h = history[id];
        if (h.length < MAX_HISTORY) {
            h.push(snap);
        } else {
            uint256 head = historyHead[id];
            h[head] = snap;
            historyHead[id] = (head + 1) % MAX_HISTORY;
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _live(uint256 id) internal view returns (Strategy storage s) {
        s = strategies[id];
        if (s.stage != Stage.Wax && s.stage != Stage.Bronze) revert WrongStage();
    }

    function _recenterTarget(Strategy storage s) internal view returns (bool, int24, int24) {
        if (s.mandate.rule == Rule.Manual) return (false, 0, 0);
        (, int24 tick,,) = poolManager.getSlot0(s.key.toId());
        int256 lo = s.tickLower;
        int256 hi = s.tickUpper;
        int256 width = hi - lo;
        int256 center = (lo + hi) / 2;
        int256 half = width / 2;

        bool triggered = s.mandate.rule == Rule.OutOfRange
            ? (tick < lo || tick >= hi)
            : _abs(int256(tick) - center) * 10 > uint256(half) * 8;
        if (!triggered) return (false, 0, 0);

        int256 target = _clamp(tick, center, s.mandate.maxTickMove);
        int256 newLo = _place(s.key.tickSpacing, target - half, width);
        if (newLo == lo) return (false, 0, 0);
        return (true, int24(newLo), int24(newLo + width));
    }

    function _clamp(int256 tick, int256 center, int256 maxMove) internal pure returns (int256) {
        if (tick > center + maxMove) return center + maxMove;
        if (tick < center - maxMove) return center - maxMove;
        return tick;
    }

    /// @dev Align to spacing and keep the whole range inside usable ticks.
    function _place(int24 spacing, int256 lo, int256 width) internal pure returns (int256 newLo) {
        newLo = _floor(lo, spacing);
        int256 minT = TickMath.minUsableTick(spacing);
        int256 maxT = TickMath.maxUsableTick(spacing);
        if (newLo < minT) newLo = minT;
        if (newLo + width > maxT) newLo = maxT - width;
    }

    function _checkRange(int24 spacing, int24 lo, int24 hi) internal pure {
        if (
            lo >= hi || lo % spacing != 0 || hi % spacing != 0 || lo < TickMath.minUsableTick(spacing)
                || hi > TickMath.maxUsableTick(spacing)
        ) revert BadRange();
    }

    function _checkCooldown(Strategy storage s) internal view {
        if (block.timestamp < uint256(s.lastRebalance) + s.mandate.cooldown) revert Cooldown();
    }

    function _inRange(Strategy storage s, int24 tick) internal view returns (bool) {
        return tick >= s.tickLower && tick < s.tickUpper;
    }

    /// @dev Spot price, refused if the tick moved more than MAX_TICK_DEVIATION since the block started.
    ///      Not a TWAP: it blocks same-block (flash) manipulation; holding a price across blocks costs arbitrage.
    function _guardedPrice(PoolId pid) internal view returns (uint160 sqrtP) {
        int24 tick;
        (sqrtP, tick,,) = poolManager.getSlot0(pid);
        if (!_priceSteady(pid, tick)) revert PriceMoved();
    }

    function _priceSteady(PoolId pid, int24 tick) internal view returns (bool) {
        PoolState storage ps = pools[pid];
        // no swap yet this block means the tick is still where the block started
        int24 ref = ps.refBlock == block.number ? ps.refTick : ps.lastTick;
        return _abs(int256(tick) - ref) <= uint256(int256(MAX_TICK_DEVIATION));
    }

    function _untrack(uint256[] storage ids, uint256 id) internal {
        for (uint256 i; i < ids.length; ++i) {
            if (ids[i] == id) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                return;
            }
        }
    }

    function _alphaBps(uint256 strat, uint256 bench) internal pure returns (int256) {
        if (bench == 0) return 0;
        return (int256(strat) - int256(bench)) * 10_000 / int256(bench);
    }

    function _floor(int256 t, int256 sp) internal pure returns (int256) {
        int256 c = t / sp;
        if (t < 0 && t % sp != 0) c--;
        return c * sp;
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }

    function _u104(uint256 x) internal pure returns (uint104) {
        return x > type(uint104).max ? type(uint104).max : uint104(x);
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    function trackedIds(PoolKey calldata key) external view returns (uint256[] memory) {
        return tracked[key.toId()];
    }

    function getStrategy(uint256 id) public view returns (StrategyView memory v) {
        Strategy storage s = strategies[id];
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(s.key.toId());

        v.id = id;
        v.name = s.name;
        v.curator = s.curator;
        v.stage = s.stage;
        v.key = s.key;
        v.mandate = s.mandate;
        v.tickLower = s.tickLower;
        v.tickUpper = s.tickUpper;
        v.currentTick = tick;
        v.sqrtPriceX96 = sqrtP;
        v.createdAt = s.createdAt;
        v.trialEndsAt = s.createdAt + trialDuration;
        v.castAt = s.castAt;
        v.lastRebalance = s.lastRebalance;
        v.trialAlphaBps = s.trialAlphaBps;
        v.liquidity = s.liquidity;
        v.totalShares = s.totalShares;

        (v.strategyIndex, v.benchIndex) = _indices(id, s, sqrtP);
        v.alphaBps = _alphaBps(v.strategyIndex, v.benchIndex);
        v.qualified = s.stage == Stage.Wax && block.timestamp >= v.trialEndsAt && v.strategyIndex > v.benchIndex;

        if (s.stage == Stage.Wax || s.stage == Stage.Bronze) {
            (bool ok,,) = _recenterTarget(s);
            v.canRecenter = ok && block.timestamp >= uint256(s.lastRebalance) + s.mandate.cooldown;
        }
        if (s.stage == Stage.Bronze) {
            v.tvl = _vaultValue(id, s, sqrtP, true);
            if (s.totalShares > 0) (v.pendingFee,,) = _alphaFee(s, sqrtP, v.tvl, s.totalShares);
        }
    }

    function getStrategies(uint256 offset, uint256 limit) external view returns (StrategyView[] memory out) {
        uint256 n = strategies.length;
        if (offset >= n) return out;
        uint256 end = offset + limit > n ? n : offset + limit;
        out = new StrategyView[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = getStrategy(i);
        }
    }

    /// @notice History in time order.
    function getHistory(uint256 id) external view returns (Snapshot[] memory out) {
        Snapshot[] storage h = history[id];
        uint256 n = h.length;
        out = new Snapshot[](n);
        uint256 head = n < MAX_HISTORY ? 0 : historyHead[id];
        for (uint256 i; i < n; ++i) {
            out[i] = h[(head + i) % n];
        }
    }
}
