// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Activity} from "../script/Activity.s.sol";
import {LostWaxHook} from "../src/LostWaxHook.sol";
import {ILostWax} from "../src/interfaces/ILostWax.sol";

/// @notice Runs the real deploy + keeper scripts on a local chain.
contract ScriptsTest is Test {
    function test_deployThenActivity() public {
        vm.setEnv("PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcaf784d7bf4f2ff80");
        vm.setEnv("TRIAL_DURATION", "60");
        vm.setEnv("SNAPSHOT_INTERVAL", "30");
        vm.setEnv("ROUNDS", "3");

        new Deploy().run();
        string memory json = vm.readFile("./deployments/31337.json");
        LostWaxHook hook = LostWaxHook(vm.parseJsonAddress(json, ".hook"));
        assertEq(hook.strategyCount(), 4);

        vm.warp(vm.getBlockTimestamp() + 120);
        new Activity().run();

        uint256 bronze;
        for (uint256 i; i < 4; ++i) {
            ILostWax.StrategyView memory v = hook.getStrategy(i);
            if (v.stage == ILostWax.Stage.Bronze) {
                bronze++;
                assertGt(v.totalShares, 0, "keeper seeds a first deposit");
                assertGt(v.tvl, 0);
            }
            assertGt(hook.getHistory(i).length, 0);
        }
        assertGt(bronze, 0);
    }
}
