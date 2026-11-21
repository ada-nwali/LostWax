// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {LostWaxHook} from "../src/LostWaxHook.sol";
import {ILostWax} from "../src/interfaces/ILostWax.sol";
import {TestToken} from "../src/testnet/TestToken.sol";
import {Faucet} from "../src/testnet/Faucet.sol";
import {Config} from "./Config.sol";

/// @notice Full testnet stack: tokens, faucet, routers, hook, pools, base liquidity, seed trials.
contract Deploy is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    address constant UNICHAIN_SEPOLIA_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 constant DEPTH_PER_SIDE = 1_000_000e18; // quote units

    IPoolManager manager;
    TestToken[5] tokens;
    Faucet faucet;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    LostWaxHook hook;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint64 trial = uint64(vm.envOr("TRIAL_DURATION", uint256(30 minutes)));
        uint64 snap = uint64(vm.envOr("SNAPSHOT_INTERVAL", uint256(2 minutes)));
        bool seed = vm.envOr("SEED_TRIALS", true);

        vm.startBroadcast(pk);

        manager = block.chainid == 31337
            ? IPoolManager(address(new PoolManager(deployer)))
            : IPoolManager(vm.envOr("POOL_MANAGER", UNICHAIN_SEPOLIA_POOL_MANAGER));

        _deployTokens(deployer);
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i].approve(address(swapRouter), type(uint256).max);
            tokens[i].approve(address(lpRouter), type(uint256).max);
        }

        hook = _deployHook(trial, snap);

        Config.PoolCfg[4] memory cfgs = Config.pools();
        PoolKey[4] memory keys;
        for (uint256 i; i < cfgs.length; ++i) {
            keys[i] = _initPool(cfgs[i]);
        }
        if (seed) _seed(keys);

        vm.stopBroadcast();
        _write(trial);

        console2.log("LostWax hook", address(hook));
        console2.log("Faucet", address(faucet));
    }

    function _deployTokens(address deployer) internal {
        faucet = new Faucet();
        Config.TokenCfg[5] memory cfg = Config.tokens();
        for (uint256 i; i < cfg.length; ++i) {
            tokens[i] = new TestToken(cfg[i].name, cfg[i].symbol, address(faucet));
            faucet.addToken(tokens[i], cfg[i].drip);
            faucet.mintTo(tokens[i], deployer, 1e30);
        }
    }

    /// @dev Hook permissions live in the address bits, so mine a CREATE2 salt.
    function _deployHook(uint64 trial, uint64 snap) internal returns (LostWaxHook) {
        bytes memory args = abi.encode(manager, trial, snap);
        bytes32 initHash = keccak256(abi.encodePacked(type(LostWaxHook).creationCode, args));
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG);

        for (uint256 salt; salt < 500_000; ++salt) {
            address predicted = vm.computeCreate2Address(bytes32(salt), initHash, CREATE2_DEPLOYER);
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags && predicted.code.length == 0) {
                LostWaxHook deployed = new LostWaxHook{salt: bytes32(salt)}(manager, trial, snap);
                require(address(deployed) == predicted, "Deploy: hook address mismatch");
                return deployed;
            }
        }
        revert("Deploy: no salt found");
    }

    function _initPool(Config.PoolCfg memory cfg) internal returns (PoolKey memory key) {
        address base = address(tokens[cfg.base]);
        address quote = address(tokens[cfg.quote]);
        key = Config.key(base, quote, cfg, address(hook));
        uint160 sqrtP = Config.sqrtPrice(base, quote, cfg.price);
        manager.initialize(key, sqrtP);

        uint256 baseAmt = DEPTH_PER_SIDE / cfg.price;
        (uint256 a0, uint256 a1) = base < quote ? (baseAmt, DEPTH_PER_SIDE) : (DEPTH_PER_SIDE, baseAmt);
        int24 lo = TickMath.minUsableTick(cfg.spacing);
        int24 hi = TickMath.maxUsableTick(cfg.spacing);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), a0, a1
        );
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams(lo, hi, int256(uint256(liq)), 0), "");
    }

    function _seed(PoolKey[4] memory keys) internal {
        _sculpt(keys[0], "Ember Narrow", 600, ILostWax.Rule.OutOfRange, 10 minutes, 600);
        _sculpt(keys[0], "Wide Crucible", 3000, ILostWax.Rule.Edge80, 10 minutes, 1200);
        _sculpt(keys[1], "Quick Mould", 1200, ILostWax.Rule.OutOfRange, 10 minutes, 600);
        _sculpt(keys[3], "Steady Pour", 20, ILostWax.Rule.OutOfRange, 10 minutes, 40);
    }

    function _sculpt(
        PoolKey memory key,
        string memory name,
        int24 half,
        ILostWax.Rule rule,
        uint32 cooldown,
        int24 maxMove
    ) internal {
        (, int24 tick,,) = manager.getSlot0(key.toId());
        int24 sp = key.tickSpacing;
        int24 center = tick / sp * sp;
        hook.sculpt(
            key,
            name,
            center - half,
            center + half,
            ILostWax.Mandate({rule: rule, cooldown: cooldown, maxTickMove: maxMove, alphaFeeBps: 2000})
        );
    }

    function _write(uint64 trial) internal {
        Config.TokenCfg[5] memory cfg = Config.tokens();
        string memory tokensJson;
        for (uint256 i; i < cfg.length; ++i) {
            tokensJson = vm.serializeAddress("tokens", cfg[i].symbol, address(tokens[i]));
        }

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployBlock", block.number);
        vm.serializeUint(o, "trialDuration", trial);
        vm.serializeAddress(o, "poolManager", address(manager));
        vm.serializeAddress(o, "hook", address(hook));
        vm.serializeAddress(o, "faucet", address(faucet));
        vm.serializeAddress(o, "swapRouter", address(swapRouter));
        vm.serializeAddress(o, "liquidityRouter", address(lpRouter));
        string memory json = vm.serializeString(o, "tokens", tokensJson);

        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        if (block.chainid != 31337) vm.writeJson(json, "../frontend/src/config/deployment.json");
    }
}
