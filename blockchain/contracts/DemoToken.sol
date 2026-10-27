// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title  DemoToken (CWT)
 * @notice Open-faucet ERC20 used to mint "fake inheritance coins" for the demo.
 *         Anyone may mint to anyone — this token has no value by design.
 */
contract DemoToken is ERC20 {
    uint256 public constant MAX_MINT_PER_CALL = 1_000_000 ether;

    constructor() ERC20("ChainWill Demo Token", "CWT") {}

    function mint(address to, uint256 amount) external {
        require(amount > 0 && amount <= MAX_MINT_PER_CALL, "Mint amount out of range");
        _mint(to, amount);
    }
}
