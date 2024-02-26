// SPDX-License-Identifier: UNLICENSED
// for testing purposes only
pragma solidity 0.8.9;

import "contracts/0.8.9/utils/PausableUntil.sol";


contract PausableUntilHarness is PausableUntil {
  function modifierWhenPaused() external view whenPaused {}

  function modifierWhenResumed() external view whenResumed {}

  function exposedPauseFor(uint256 _duration) external {
    _pauseFor(_duration);
  }

  function exposedPauseUntil(uint256 _pauseUntilInclusive) external {
    _pauseUntil(_pauseUntilInclusive);
  }

  function exposedResume() external {
    _resume();
  }

  function exposedSetPauseState(uint256 _resumeSince) external {
    _setPausedState(_resumeSince);
  }
}
