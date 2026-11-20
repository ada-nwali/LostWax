// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestToken} from "./TestToken.sol";

/// @notice One click: a drip of every test token.
contract Faucet {
    uint256 public constant COOLDOWN = 5 minutes;

    address public immutable owner;
    TestToken[] public tokens;
    uint256[] public amounts;
    mapping(address => uint256) public lastDrip;

    event Dripped(address indexed to);

    constructor() {
        owner = msg.sender;
    }

    function addToken(TestToken token, uint256 dripAmount) external {
        require(msg.sender == owner, "Faucet: not owner");
        tokens.push(token);
        amounts.push(dripAmount);
    }

    function mintTo(TestToken token, address to, uint256 amount) external {
        require(msg.sender == owner, "Faucet: not owner");
        token.mint(to, amount);
    }

    function drip() external {
        require(block.timestamp >= lastDrip[msg.sender] + COOLDOWN, "Faucet: cooldown");
        lastDrip[msg.sender] = block.timestamp;
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i].mint(msg.sender, amounts[i]);
        }
        emit Dripped(msg.sender);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }
}
