// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWillManagerClaims {
    function claimInheritance(address owner) external;
}

/**
 * @dev TEST ONLY. A malicious beneficiary contract that tries to re-enter
 *      `claimInheritance` from its receive() hook to be paid twice.
 */
contract ReentrantClaimer {
    IWillManagerClaims public immutable manager;
    address public target;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;
    bytes public lastRevertData;

    constructor(address manager_) {
        manager = IWillManagerClaims(manager_);
    }

    function attack(address willOwner) external {
        target = willOwner;
        manager.claimInheritance(willOwner);
    }

    receive() external payable {
        if (reentryAttempts == 0) {
            reentryAttempts++;
            try manager.claimInheritance(target) {
                reentrySucceeded = true;
            } catch (bytes memory reason) {
                lastRevertData = reason;
            }
        }
    }
}
