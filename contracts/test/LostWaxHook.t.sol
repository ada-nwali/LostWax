// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {LostWaxHook} from "../src/LostWaxHook.sol";
import {ILostWax} from "../src/interfaces/ILostWax.sol";

contract LostWaxHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for *;

    LostWaxHook hook;
    address curator = makeAddr("curator");
    address alice = makeAddr("alice");

    uint64 constant TRIAL = 1 hours;
    uint64 constant SNAP = 5 minutes;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        address flags = address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG) ^ (0x4444 << 144));
        deployCodeTo("LostWaxHook.sol:LostWaxHook", abi.encode(manager, TRIAL, SNAP), flags);
        hook = LostWaxHook(flags);

        (key,) = initPool(currency0, currency1, IHooks(flags), 3000, SQRT_PRICE_1_1);
        _addBase(TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 1_000e18);
        _addBase(-600, 600, 1_000e18);

        _fund(alice);
    }

    // --- wax ---

    function test_sculpt_startsLevelWithLazyLP() public {
        uint256 id = _sculpt(-120, 120);
        ILostWax.StrategyView memory v = hook.getStrategy(id);
        assertEq(uint8(v.stage), uint8(ILostWax.Stage.Wax));
        assertApproxEqRel(v.strategyIndex, 1e18, 1e12);
        assertApproxEqRel(v.benchIndex, 1e18, 1e12);
        assertEq(hook.getHistory(id).length, 1);
    }

    function test_wax_concentratedRangeBeatsLazyLP() public {
        uint256 id = _sculpt(-120, 120);
        _churn(20, 2e18);
        ILostWax.StrategyView memory v = hook.getStrategy(id);
        assertGt(v.strategyIndex, v.benchIndex);
        assertGt(v.alphaBps, 0);
    }

    function test_wax_outOfRangeEarnsNothing() public {
        uint256 id = _sculpt(1200, 1800);
        _churn(10, 2e18);
        ILostWax.StrategyView memory v = hook.getStrategy(id);
        assertLt(v.strategyIndex, v.benchIndex);
    }

    function test_cast_afterTrialWhenAhead() public {
        uint256 id = _sculpt(-120, 120);
        _churn(20, 2e18);
        vm.warp(vm.getBlockTimestamp() + TRIAL);

        vm.prank(curator);
        hook.cast(id);

        ILostWax.StrategyView memory v = hook.getStrategy(id);
        assertEq(uint8(v.stage), uint8(ILostWax.Stage.Bronze));
        assertGt(v.trialAlphaBps, 0);
    }

    function test_cast_revertsDuringTrial() public {
        uint256 id = _sculpt(-120, 120);
        _churn(5, 2e18);
        vm.prank(curator);
        vm.expectRevert(ILostWax.TrialRunning.selector);
        hook.cast(id);
    }

    function test_cast_revertsWhenBehind() public {
        uint256 id = _sculpt(1200, 1800);
        _churn(10, 2e18);
        vm.warp(vm.getBlockTimestamp() + TRIAL);
        vm.prank(curator);
        vm.expectRevert(ILostWax.NotQualified.selector);
        hook.cast(id);
    }

    function test_retire_anyoneAfterFailedTrial() public {
        uint256 id = _sculpt(1200, 1800);
        _churn(5, 2e18);
        vm.warp(vm.getBlockTimestamp() + TRIAL);
        hook.retire(id);
        assertEq(uint8(hook.getStrategy(id).stage), uint8(ILostWax.Stage.Retired));
        assertEq(hook.trackedIds(key).length, 0);
    }

    // --- mandate ---

    function test_rebalance_onlyCurator() public {
        uint256 id = _sculpt(-120, 120);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(ILostWax.NotCurator.selector);
        hook.rebalance(id, -60, 180);
    }

    function test_rebalance_respectsMaxMoveAndCooldown() public {
        uint256 id = _sculpt(-120, 120);
        vm.warp(vm.getBlockTimestamp() + 1 hours);

        vm.startPrank(curator);
        vm.expectRevert(ILostWax.MoveTooLarge.selector);
        hook.rebalance(id, 1200, 1440);

        hook.rebalance(id, -60, 180);
        vm.expectRevert(ILostWax.Cooldown.selector);
        hook.rebalance(id, 0, 240);
        vm.stopPrank();
    }

    function test_rebalance_waxKeepsValue() public {
        uint256 id = _sculpt(-120, 120);
        _churn(5, 2e18);
        uint256 before = hook.getStrategy(id).strategyIndex;
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.prank(curator);
        hook.rebalance(id, -60, 180);
        assertApproxEqRel(hook.getStrategy(id).strategyIndex, before, 1e12);
    }

    // --- bronze ---

    function test_depositWithdraw_roundTrip() public {
        uint256 id = _castOne();
        uint256 b0 = _bal0(alice);
        uint256 b1 = _bal1(alice);

        vm.prank(alice);
        uint256 shares = hook.deposit(id, 10e18, 10e18, 0);
        assertGt(shares, 0);
        assertEq(hook.sharesOf(id, alice), shares);
        assertGt(hook.getStrategy(id).tvl, 0);

        vm.prank(alice);
        hook.withdraw(id, shares, 0, 0);

        assertApproxEqAbs(_bal0(alice), b0, 10);
        assertApproxEqAbs(_bal1(alice), b1, 10);
        assertEq(hook.sharesOf(id, alice), 0);
    }

    function test_deposit_revertsOnWax() public {
        uint256 id = _sculpt(-120, 120);
        vm.prank(alice);
        vm.expectRevert(ILostWax.WrongStage.selector);
        hook.deposit(id, 1e18, 1e18, 0);
    }

    function test_withdraw_partialIsProRata() public {
        uint256 id = _castOne();
        vm.prank(alice);
        uint256 shares = hook.deposit(id, 10e18, 10e18, 0);
        uint256 cost = hook.costBasis(id, alice);

        vm.prank(alice);
        hook.withdraw(id, shares / 2, 0, 0);
        assertApproxEqRel(hook.costBasis(id, alice), cost / 2, 1e12);
        assertEq(hook.sharesOf(id, alice), shares - shares / 2);
    }

    function test_recenter_movesVaultAndKeepsValue() public {
        uint256 id = _castOne();
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);

        // push price below the range and let it settle into later blocks
        swap(key, true, -40e18, ZERO_BYTES);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.roll(vm.getBlockNumber() + 1);

        ILostWax.StrategyView memory before = hook.getStrategy(id);
        assertTrue(before.canRecenter);
        assertLt(before.currentTick, before.tickLower);

        hook.recenter(id);

        ILostWax.StrategyView memory afterR = hook.getStrategy(id);
        assertLt(afterR.tickLower, before.tickLower);
        assertGt(afterR.liquidity, 0);
        assertLe(uint256(int256(before.tickLower - afterR.tickLower)), 600);
        // swap fee and impact only
        assertApproxEqRel(afterR.tvl, before.tvl, 0.02e18);
        assertEq(hook.getHistory(id)[hook.getHistory(id).length - 1].rebalanced, true);
    }

    function test_recenter_revertsWhenInRange() public {
        uint256 id = _sculpt(-120, 120);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(ILostWax.NotTriggered.selector);
        hook.recenter(id);
    }

    function test_alphaFee_paidOnlyOnOutperformance() public {
        uint256 id = _castOne();
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);
        assertEq(hook.sharesOf(id, curator), 0);

        _churn(20, 2e18);
        assertGt(hook.getStrategy(id).pendingFee, 0);

        hook.harvest(id);
        uint256 fee = hook.sharesOf(id, curator);
        assertGt(fee, 0);

        // nothing new to charge right after
        hook.harvest(id);
        assertEq(hook.sharesOf(id, curator), fee);
    }

    function test_alphaFee_noneWhenBehind() public {
        uint256 id = _castOne();
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);

        // one-way move: the narrow vault takes the IL hit
        swap(key, true, -30e18, ZERO_BYTES);
        vm.roll(vm.getBlockNumber() + 1);
        hook.harvest(id);
        assertEq(hook.sharesOf(id, curator), 0);
    }

    // --- hardening ---

    function test_priceGuard_blocksSameBlockManipulation() public {
        uint256 id = _castOne();
        vm.prank(alice);
        uint256 shares = hook.deposit(id, 10e18, 10e18, 0);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.roll(vm.getBlockNumber() + 1);

        // flash-style push out of range: price-sensitive actions refuse in this block
        swap(key, true, -40e18, ZERO_BYTES);
        vm.expectRevert(ILostWax.PriceMoved.selector);
        hook.recenter(id);
        vm.prank(alice);
        vm.expectRevert(ILostWax.PriceMoved.selector);
        hook.deposit(id, 1e18, 1e18, 0);

        // exits never block
        vm.prank(alice);
        hook.withdraw(id, shares / 2, 0, 0);

        // once the move survives into a new block it is the market price
        vm.roll(vm.getBlockNumber() + 1);
        hook.recenter(id);
    }

    function test_priceGuard_sculptAndCast() public {
        uint256 id = _sculpt(-120, 120);
        _churn(20, 2e18);
        vm.warp(vm.getBlockTimestamp() + TRIAL);

        swap(key, true, -40e18, ZERO_BYTES);
        vm.prank(curator);
        vm.expectRevert(ILostWax.PriceMoved.selector);
        hook.cast(id);
        vm.prank(curator);
        vm.expectRevert(ILostWax.PriceMoved.selector);
        hook.sculpt(key, "Late", -120, 120, _mandate());
    }

    function test_harvest_skipsFeeWhilePriceManipulated() public {
        uint256 id = _castOne();
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);
        _churn(20, 2e18);
        assertGt(hook.getStrategy(id).pendingFee, 0);

        swap(key, true, -40e18, ZERO_BYTES);
        hook.harvest(id);
        assertEq(hook.sharesOf(id, curator), 0, "no fee at a manipulated price");

        // reverse inside the same block: back near the block-start tick, fee is charged
        swap(key, false, 40e18, ZERO_BYTES);
        hook.harvest(id);
        assertGt(hook.sharesOf(id, curator), 0);
    }

    function test_ownSwaps_keepPoolStateInSync() public {
        uint256 id = _castOne();
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);
        swap(key, true, -40e18, ZERO_BYTES);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.roll(vm.getBlockNumber() + 1);

        hook.recenter(id); // swaps through the pool from inside the hook

        PoolId pid = key.toId();
        (, int24 lastTick,,, uint256 g0, uint256 g1) = hook.pools(pid);
        (, int24 tick,,) = manager.getSlot0(pid);
        (uint256 m0, uint256 m1) = manager.getFeeGrowthGlobals(pid);
        assertEq(lastTick, tick);
        assertEq(g0, m0);
        assertEq(g1, m1);
    }

    function test_vaultSwap_impactIsCapped() public {
        uint256 id = _castOne();
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);
        swap(key, true, -40e18, ZERO_BYTES);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.roll(vm.getBlockNumber() + 1);

        (, int24 before,,) = manager.getSlot0(key.toId());
        hook.recenter(id);
        (, int24 afterT,,) = manager.getSlot0(key.toId());
        assertLe(_absDiff(afterT, before), uint256(int256(hook.MAX_SWAP_TICKS())) + 1);
    }

    function test_cast_freesWaxSlot() public {
        uint256 id = _castOne();
        assertEq(hook.trackedIds(key).length, 0);

        // the vault still gets automatic snapshots from outside swaps
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0); // first deposit restarts the record: one point
        assertEq(hook.getHistory(id).length, 1);
        vm.warp(vm.getBlockTimestamp() + SNAP);
        vm.roll(vm.getBlockNumber() + 1);
        swap(key, true, -1e18, ZERO_BYTES);
        assertEq(hook.getHistory(id).length, 2);
    }

    function test_sculpt_poolFullAtMaxTracked() public {
        for (uint256 i; i < hook.MAX_TRACKED(); ++i) {
            _sculpt(-120, 120);
        }
        vm.prank(curator);
        vm.expectRevert(ILostWax.TooManyStrategies.selector);
        hook.sculpt(key, "One too many", -120, 120, _mandate());
    }

    function test_retire_anyoneAfterStaleUncastTrial() public {
        uint256 id = _sculpt(-120, 120);
        _churn(20, 2e18);
        vm.warp(vm.getBlockTimestamp() + TRIAL);
        assertTrue(hook.getStrategy(id).qualified);

        // qualified and still within the cast window: only the curator decides
        vm.expectRevert(ILostWax.NotCurator.selector);
        hook.retire(id);

        vm.warp(vm.getBlockTimestamp() + TRIAL);
        hook.retire(id);
        assertEq(uint8(hook.getStrategy(id).stage), uint8(ILostWax.Stage.Retired));
    }

    function test_nativePool_notRegistered() public {
        (PoolKey memory nativeKey,) =
            initPool(CurrencyLibrary.ADDRESS_ZERO, currency1, IHooks(address(hook)), 3000, SQRT_PRICE_1_1);
        (bool registered,,,,,) = hook.pools(nativeKey.toId());
        assertFalse(registered);
        vm.prank(curator);
        vm.expectRevert(ILostWax.UnknownPool.selector);
        hook.sculpt(nativeKey, "Native", -120, 120, _mandate());
    }

    function test_deposit_respectsMaxAmounts() public {
        uint256 id = _castOne();
        uint256 b0 = _bal0(alice);
        uint256 b1 = _bal1(alice);
        vm.prank(alice);
        hook.deposit(id, 3e18, 7e18, 0);
        assertLe(b0 - _bal0(alice), 3e18);
        assertLe(b1 - _bal1(alice), 7e18);
    }

    function test_deposit_minSharesEnforced() public {
        uint256 id = _castOne();
        vm.prank(alice);
        vm.expectRevert(ILostWax.Slippage.selector);
        hook.deposit(id, 1e18, 1e18, type(uint256).max);
    }

    function test_secondDepositorIsNotDiluted() public {
        uint256 id = _castOne();
        address bob = makeAddr("bob");
        _fund(bob);
        vm.prank(alice);
        hook.deposit(id, 10e18, 10e18, 0);
        _churn(5, 2e18); // vault earns fees, held partly as idle balances

        (uint160 sqrtP,,,) = manager.getSlot0(key.toId());
        uint256 before = _value(bob, sqrtP);
        vm.prank(bob);
        uint256 shares = hook.deposit(id, 10e18, 10e18, 0);
        vm.prank(bob);
        hook.withdraw(id, shares, 0, 0);

        // the token mix can differ (pro-rata idle), the value must not grow and must not leak
        uint256 afterV = _value(bob, sqrtP);
        assertLe(afterV, before);
        assertApproxEqRel(afterV, before, 1e12);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_depositWithdraw_neverPaysOutMore(uint96 a0, uint96 a1) public {
        uint256 amt0 = bound(uint256(a0), 1e9, 100e18);
        uint256 amt1 = bound(uint256(a1), 1e9, 100e18);
        uint256 id = _castOne();
        uint256 b0 = _bal0(alice);
        uint256 b1 = _bal1(alice);

        vm.prank(alice);
        uint256 shares = hook.deposit(id, amt0, amt1, 0);
        vm.prank(alice);
        hook.withdraw(id, shares, 0, 0);

        assertLe(_bal0(alice), b0);
        assertLe(_bal1(alice), b1);
    }

    // --- helpers ---

    function _sculpt(int24 lo, int24 hi) internal returns (uint256 id) {
        vm.prank(curator);
        id = hook.sculpt(key, "Ember Narrow", lo, hi, _mandate());
    }

    function _mandate() internal pure returns (ILostWax.Mandate memory) {
        return
            ILostWax.Mandate({rule: ILostWax.Rule.OutOfRange, cooldown: 1 hours, maxTickMove: 600, alphaFeeBps: 2000});
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint256) {
        int256 d = int256(a) - int256(b);
        return uint256(d >= 0 ? d : -d);
    }

    function _castOne() internal returns (uint256 id) {
        id = _sculpt(-120, 120);
        _churn(20, 2e18);
        vm.warp(vm.getBlockTimestamp() + TRIAL);
        vm.prank(curator);
        hook.cast(id);
    }

    function _churn(uint256 rounds, uint256 amount) internal {
        for (uint256 i; i < rounds; ++i) {
            swap(key, true, -int256(amount), ZERO_BYTES);
            swap(key, false, -int256(amount), ZERO_BYTES);
            vm.warp(vm.getBlockTimestamp() + 1 minutes);
            vm.roll(vm.getBlockNumber() + 1);
        }
    }

    function _addBase(int24 lo, int24 hi, int256 liq) internal {
        modifyLiquidityRouter.modifyLiquidity(key, ModifyLiquidityParams(lo, hi, liq, 0), ZERO_BYTES);
    }

    function _fund(address who) internal {
        MockERC20(Currency.unwrap(currency0)).transfer(who, 1_000e18);
        MockERC20(Currency.unwrap(currency1)).transfer(who, 1_000e18);
        vm.startPrank(who);
        MockERC20(Currency.unwrap(currency0)).approve(address(hook), type(uint256).max);
        MockERC20(Currency.unwrap(currency1)).approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev wallet value in token1 at a fixed price
    function _value(address who, uint160 sqrtP) internal view returns (uint256) {
        uint256 p = uint256(sqrtP) * uint256(sqrtP) >> 96;
        return _bal0(who) * p / (1 << 96) + _bal1(who);
    }

    function _bal0(address who) internal view returns (uint256) {
        return MockERC20(Currency.unwrap(currency0)).balanceOf(who);
    }

    function _bal1(address who) internal view returns (uint256) {
        return MockERC20(Currency.unwrap(currency1)).balanceOf(who);
    }
}
