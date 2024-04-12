import { bigintToHex, bufToHex } from "bigint-conversion";
import { expect } from "chai";
import { hexlify, randomBytes } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  BeaconChainDepositor__factory,
  DepositContract__MockForBeaconChainDepositor__factory,
  StakingModule__Mock,
  StakingModule__Mock__factory,
  StakingRouter,
  StakingRouter__factory,
} from "typechain-types";

import { certainAddress, getNextBlock, proxify } from "lib";

describe("StakingRouter:module-sync", () => {
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  let stakingRouter: StakingRouter;
  let stakingModule: StakingModule__Mock;

  let moduleId: bigint;
  let stakingModuleAddress: string;
  let lastDepositAt: bigint;
  let lastDepositBlock: bigint;

  // module params
  const name = "myStakingModule";
  const stakingModuleFee = 5_00n;
  const treasuryFee = 5_00n;
  const targetShare = 1_00n;

  beforeEach(async () => {
    [deployer, admin, user] = await ethers.getSigners();

    const depositContract = await new DepositContract__MockForBeaconChainDepositor__factory(deployer).deploy();
    const beaconChainDepositor = await new BeaconChainDepositor__factory(deployer).deploy(depositContract);
    const impl = await new StakingRouter__factory(deployer).deploy(beaconChainDepositor);

    [stakingRouter] = await proxify({ impl, admin });

    // initialize staking router
    await stakingRouter.initialize(
      admin,
      certainAddress("test:staking-router-modules:lido"), // mock lido address
      hexlify(randomBytes(32)), // mock withdrawal credentials
    );

    // grant roles

    await Promise.all([
      stakingRouter.grantRole(await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(), admin),
      stakingRouter.grantRole(await stakingRouter.STAKING_MODULE_MANAGE_ROLE(), admin),
      stakingRouter.grantRole(await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE(), admin),
      stakingRouter.grantRole(await stakingRouter.UNSAFE_SET_EXITED_VALIDATORS_ROLE(), admin),
      stakingRouter.grantRole(await stakingRouter.REPORT_REWARDS_MINTED_ROLE(), admin),
    ]);

    // add staking module
    stakingModule = await new StakingModule__Mock__factory(deployer).deploy();
    stakingModuleAddress = await stakingModule.getAddress();
    const { timestamp, number } = await getNextBlock();
    lastDepositAt = timestamp;
    lastDepositBlock = number;

    await stakingRouter.addStakingModule(name, stakingModuleAddress, targetShare, stakingModuleFee, treasuryFee);

    moduleId = await stakingRouter.getStakingModulesCount();
  });

  context("Getters", () => {
    let stakingModuleInfo: [bigint, string, bigint, bigint, bigint, bigint, string, bigint, bigint, bigint];

    // module mock state
    const stakingModuleSummary: Parameters<StakingModule__Mock["mock__getStakingModuleSummary"]> = [
      100n, // exitedValidators
      1000, // depositedValidators
      200, // depositableValidators
    ];

    const nodeOperatorSummary: Parameters<StakingModule__Mock["mock__getNodeOperatorSummary"]> = [
      true, // isTargetLimitActive
      100n, // targetValidatorsCount
      1n, // stuckValidatorsCount
      5n, // refundedValidatorsCount
      0n, // stuckPenaltyEndTimestamp
      50, // totalExitedValidators
      1000n, // totalDepositedValidators
      200n, // depositableValidatorsCount
    ];

    const nodeOperatorsCounts: Parameters<StakingModule__Mock["mock__nodeOperatorsCount"]> = [
      100n, // nodeOperatorsCount
      95n, // activeNodeOperatorsCount
    ];

    const nodeOperatorsIds = [0n];

    beforeEach(async () => {
      stakingModuleInfo = [
        moduleId,
        stakingModuleAddress,
        stakingModuleFee,
        treasuryFee,
        targetShare,
        0n, // status
        name,
        lastDepositAt,
        lastDepositBlock,
        0n, // exitedValidatorsCount
      ];

      // mocking module state
      await stakingModule.mock__getStakingModuleSummary(...stakingModuleSummary);
      await stakingModule.mock__getNodeOperatorSummary(...nodeOperatorSummary);
      await stakingModule.mock__nodeOperatorsCount(...nodeOperatorsCounts);
      await stakingModule.mock__getNodeOperatorIds(nodeOperatorsIds);
    });

    context("getStakingModules", () => {
      it("Returns an array of staking module structs", async () => {
        expect(await stakingRouter.getStakingModules()).to.deep.equal([stakingModuleInfo]);
      });
    });

    context("getStakingModuleIds", () => {
      it("Returns an array of staking module ids", async () => {
        expect(await stakingRouter.getStakingModuleIds()).to.deep.equal([moduleId]);
      });
    });

    context("getStakingModule", () => {
      it("Returns the staking module struct by its id", async () => {
        expect(await stakingRouter.getStakingModule(moduleId)).to.deep.equal(stakingModuleInfo);
      });
    });

    context("getStakingModulesCount", () => {
      it("Returns the number of staking modules registered", async () => {
        expect(await stakingRouter.getStakingModulesCount()).to.deep.equal(1n);
      });
    });

    context("hasStakingModule", () => {
      it("Returns true if a staking module with a given id exists", async () => {
        expect(await stakingRouter.hasStakingModule(moduleId)).to.equal(true);
      });

      it("Returns false if a staking module with a given id does not exist", async () => {
        expect(await stakingRouter.hasStakingModule(moduleId + 1n)).to.equal(false);
      });
    });

    context("getStakingModuleStatus", () => {
      it("Returns the status of the staking module", async () => {
        expect(await stakingRouter.getStakingModuleStatus(moduleId)).to.equal(0n);
      });
    });

    context("getStakingModuleSummary", () => {
      it("Returns the staking module summary", async () => {
        expect(await stakingRouter.getStakingModuleSummary(moduleId)).to.deep.equal(stakingModuleSummary);
      });
    });

    context("getNodeOperatorSummary", () => {
      it("Returns the node operator summary", async () => {
        expect(await stakingRouter.getNodeOperatorSummary(moduleId, 1n)).to.deep.equal(nodeOperatorSummary);
      });
    });

    context("getAllStakingModuleDigests", () => {
      it("Returns the digests of the specified staking modules", async () => {
        expect(await stakingRouter.getAllStakingModuleDigests()).to.deep.equal([
          [...nodeOperatorsCounts, stakingModuleInfo, stakingModuleSummary],
        ]);
      });
    });

    context("getStakingModuleDigests", () => {
      it("Returns the digests of the specified staking modules", async () => {
        expect(await stakingRouter.getStakingModuleDigests([moduleId])).to.deep.equal([
          [...nodeOperatorsCounts, stakingModuleInfo, stakingModuleSummary],
        ]);
      });
    });

    context("getAllNodeOperatorDigests", () => {
      it("Returns all node operator digests", async () => {
        expect(await stakingRouter.getAllNodeOperatorDigests(moduleId)).to.deep.equal([
          [0n, true, nodeOperatorSummary],
        ]);
      });
    });

    context("getNodeOperatorDigests (by offset)", () => {
      it("Returns node operator digests by offset and limit", async () => {
        expect(await stakingRouter["getNodeOperatorDigests(uint256,uint256,uint256)"](moduleId, 0n, 1n)).to.deep.equal([
          [0n, true, nodeOperatorSummary],
        ]);
      });
    });

    context("getNodeOperatorDigests (by ids)", () => {
      it("Returns node operator digests by ids", async () => {
        expect(await stakingRouter["getNodeOperatorDigests(uint256,uint256[])"](moduleId, [0n])).to.deep.equal([
          [0n, true, nodeOperatorSummary],
        ]);
      });
    });

    context("getStakingModuleNonce", () => {
      it("Returns 0 initially", async () => {
        expect(await stakingRouter.getStakingModuleNonce(moduleId)).to.equal(0n);
      });

      it("Returns the updated nonce", async () => {
        await stakingModule.mock__getNonce(1n);

        expect(await stakingRouter.getStakingModuleNonce(moduleId)).to.equal(1n);
      });
    });

    context("getStakingModuleLastDepositBlock", () => {
      it("Returns initially the register block number", async () => {
        expect(await stakingRouter.getStakingModuleLastDepositBlock(moduleId)).to.equal(lastDepositBlock);
      });
    });

    context("getStakingModuleActiveValidatorsCount", () => {
      it("Returns the number of active validators in the module", async () => {
        const [exitedValidators, depositedValidators] = stakingModuleSummary;

        expect(await stakingRouter.getStakingModuleActiveValidatorsCount(moduleId)).to.equal(
          Number(depositedValidators) - Number(exitedValidators),
        );
      });
    });
  });

  context("setWithdrawalCredentials", () => {
    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).setWithdrawalCredentials(hexlify(randomBytes(32))),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE());
    });

    it("Set new withdrawal credentials and informs modules", async () => {
      const newWithdrawalCredentials = hexlify(randomBytes(32));

      await expect(stakingRouter.setWithdrawalCredentials(newWithdrawalCredentials))
        .to.emit(stakingRouter, "WithdrawalCredentialsSet")
        .withArgs(newWithdrawalCredentials, admin.address)
        .and.to.emit(stakingModule, "Mock__WithdrawalCredentialsChanged");
    });

    it("Reverts if the hook fails without revert data", async () => {
      await stakingModule.mock__onWithdrawalCredentialsChanged(true, "");

      await expect(stakingRouter.setWithdrawalCredentials(hexlify(randomBytes(32)))).to.be.revertedWithCustomError(
        stakingRouter,
        "UnrecoverableModuleError",
      );
    });

    it("Logs the revert data if the hook fails", async () => {
      // TODO
    });
  });

  context("updateTargetValidatorsLimits", () => {
    const NODE_OPERATOR_ID = 0n;
    const IS_TARGET_LIMIT_ACTIVE = true;
    const TARGET_LIMIT = 100n;

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter
          .connect(user)
          .updateTargetValidatorsLimits(moduleId, NODE_OPERATOR_ID, IS_TARGET_LIMIT_ACTIVE, TARGET_LIMIT),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.STAKING_MODULE_MANAGE_ROLE());
    });

    it("Redirects the call to the staking module", async () => {
      await expect(
        stakingRouter.updateTargetValidatorsLimits(moduleId, NODE_OPERATOR_ID, IS_TARGET_LIMIT_ACTIVE, TARGET_LIMIT),
      )
        .to.emit(stakingModule, "Mock__TargetValidatorsLimitsUpdated")
        .withArgs(NODE_OPERATOR_ID, IS_TARGET_LIMIT_ACTIVE, TARGET_LIMIT);
    });
  });

  context("updateRefundedValidatorsCount", () => {
    const NODE_OPERATOR_ID = 0n;
    const REFUNDED_VALIDATORS_COUNT = 10n;

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter
          .connect(user)
          .updateRefundedValidatorsCount(moduleId, NODE_OPERATOR_ID, REFUNDED_VALIDATORS_COUNT),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.STAKING_MODULE_MANAGE_ROLE());
    });

    it("Redirects the call to the staking module", async () => {
      await expect(stakingRouter.updateRefundedValidatorsCount(moduleId, NODE_OPERATOR_ID, REFUNDED_VALIDATORS_COUNT))
        .to.emit(stakingModule, "Mock__RefundedValidatorsCountUpdated")
        .withArgs(NODE_OPERATOR_ID, REFUNDED_VALIDATORS_COUNT);
    });
  });

  context("reportRewardsMinted", () => {
    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).reportRewardsMinted([moduleId], [0n]),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_REWARDS_MINTED_ROLE());
    });

    it("Reverts if the arrays have different lengths", async () => {
      await expect(stakingRouter.reportRewardsMinted([moduleId], [0n, 1n]))
        .to.be.revertedWithCustomError(stakingRouter, "ArraysLengthMismatch")
        .withArgs(1n, 2n);
    });

    it("Does nothing if the total shares is 0", async () => {
      await expect(stakingRouter.reportRewardsMinted([moduleId], [0n])).not.to.emit(
        stakingModule,
        "Mock__OnRewardsMinted",
      );
    });

    it("Does nothing if the total shares is 0", async () => {
      await expect(stakingRouter.reportRewardsMinted([moduleId], [0n])).not.to.emit(
        stakingModule,
        "Mock__OnRewardsMinted",
      );
    });

    it("Calls the hook on the staking module if the total shares is greater than 0", async () => {
      await expect(stakingRouter.reportRewardsMinted([moduleId], [1n]))
        .to.emit(stakingModule, "Mock__OnRewardsMinted")
        .withArgs(1n);
    });

    it("Reverts if the hook fails without revert data", async () => {
      await stakingModule.mock__revertOnRewardsMinted(true, "");

      await expect(stakingRouter.reportRewardsMinted([moduleId], [1n])).to.be.revertedWithCustomError(
        stakingRouter,
        "UnrecoverableModuleError",
      );
    });

    it("Logs the revert data if the hook fails", async () => {
      // TODO
    });
  });

  context("updateExitedValidatorsCountByStakingModule", () => {
    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).updateExitedValidatorsCountByStakingModule([moduleId], [0n]),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the array lengths are different", async () => {
      await expect(stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [0n, 1n]))
        .to.be.revertedWithCustomError(stakingRouter, "ArraysLengthMismatch")
        .withArgs(1n, 2n);
    });

    it("Reverts if the new number of exited validators is less than the previous one", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      await stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [totalExitedValidators]);

      await expect(
        stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [totalExitedValidators - 1n]),
      ).to.be.revertedWithCustomError(stakingRouter, "ExitedValidatorsCountCannotDecrease");
    });

    it("Reverts if the new number of exited validators exceeds the number of deposited", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      await stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [totalExitedValidators]);

      const newExitedValidatorsExceedingDeposited = totalDepositedValidators + 1n;
      await expect(
        stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [newExitedValidatorsExceedingDeposited]),
      )
        .to.be.revertedWithCustomError(stakingRouter, "ReportedExitedValidatorsExceedDeposited")
        .withArgs(newExitedValidatorsExceedingDeposited, totalDepositedValidators);
    });

    it("Logs an event if the total exited validators is less than the previously reported number", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      const previouslyReportedTotalExitedValidators = totalExitedValidators + 1n;
      await stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [totalExitedValidators + 1n]);

      const newTotalExitedValidators = totalExitedValidators + 1n;

      await expect(stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [newTotalExitedValidators]))
        .to.be.emit(stakingRouter, "StakingModuleExitedValidatorsIncompleteReporting")
        .withArgs(moduleId, previouslyReportedTotalExitedValidators - totalExitedValidators);
    });

    it("Logs an event if the total exited validators is less than the previously reported number", async () => {
      const totalExitedValidators = 5n;
      const totalDepositedValidators = 10n;
      const depositableValidatorsCount = 2n;

      await stakingModule.mock__getStakingModuleSummary(
        totalExitedValidators,
        totalDepositedValidators,
        depositableValidatorsCount,
      );

      await stakingRouter.updateExitedValidatorsCountByStakingModule([moduleId], [totalExitedValidators]);

      const newTotalExitedValidators = totalExitedValidators + 1n;

      const newlyExitedValidatorsCount = await stakingRouter.updateExitedValidatorsCountByStakingModule.staticCall(
        [moduleId],
        [newTotalExitedValidators],
      );

      expect(newlyExitedValidatorsCount).to.equal(1n);
    });
  });

  context("reportStakingModuleExitedValidatorsCountByNodeOperator", () => {
    const NODE_OPERATOR_IDS = bigintToHex(1n, true, 8);
    const VALIDATORS_COUNTS = bigintToHex(100n, true, 16);

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter
          .connect(user)
          .reportStakingModuleExitedValidatorsCountByNodeOperator(moduleId, NODE_OPERATOR_IDS, VALIDATORS_COUNTS),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the node operators ids are packed incorrectly", async () => {
      const incorrectlyPackedNodeOperatorIds = bufToHex(new Uint8Array([1]), true, 7);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          incorrectlyPackedNodeOperatorIds,
          VALIDATORS_COUNTS,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(3n);
    });

    it("Reverts if the validator counts are packed incorrectly", async () => {
      const incorrectlyPackedValidatorCounts = bufToHex(new Uint8Array([100]), true, 15);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          incorrectlyPackedValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(3n);
    });

    it("Reverts if the number of node operators does not match validator counts", async () => {
      const tooManyValidatorCounts = VALIDATORS_COUNTS + bigintToHex(101n, false, 16);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          tooManyValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(2n);
    });

    it("Reverts if the number of node operators does not match validator counts", async () => {
      const tooManyValidatorCounts = VALIDATORS_COUNTS + bigintToHex(101n, false, 16);

      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          tooManyValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(2n);
    });

    it("Reverts if the node operators ids is empty", async () => {
      await expect(stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(moduleId, "0x", "0x"))
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(1n);
    });

    it("Updates exited validator count on the module", async () => {
      await expect(
        stakingRouter.reportStakingModuleExitedValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          VALIDATORS_COUNTS,
        ),
      )
        .to.emit(stakingModule, "Mock__ExitedValidatorsCountUpdated")
        .withArgs(NODE_OPERATOR_IDS, VALIDATORS_COUNTS);
    });
  });

  context("unsafeSetExitedValidatorsCount", () => {
    const nodeOperatorId = 1n;

    const correction: StakingRouter.ValidatorsCountsCorrectionStruct = {
      currentModuleExitedValidatorsCount: 0n,
      currentNodeOperatorExitedValidatorsCount: 0n,
      currentNodeOperatorStuckValidatorsCount: 0n,
      newModuleExitedValidatorsCount: 1n,
      newNodeOperatorExitedValidatorsCount: 2n,
      newNodeOperatorStuckValidatorsCount: 3n,
    };

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, correction),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.UNSAFE_SET_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the number of exited validators in the module does not match what is stored on the contract", async () => {
      await expect(
        stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, {
          ...correction,
          currentModuleExitedValidatorsCount: 1n,
        }),
      )
        .to.be.revertedWithCustomError(stakingRouter, "UnexpectedCurrentValidatorsCount")
        .withArgs(0n, 0n, 0n);
    });

    it("Reverts if the number of exited validators of the operator does not match what is stored on the contract", async () => {
      await expect(
        stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, {
          ...correction,
          currentNodeOperatorExitedValidatorsCount: 1n,
        }),
      )
        .to.be.revertedWithCustomError(stakingRouter, "UnexpectedCurrentValidatorsCount")
        .withArgs(0n, 0n, 0n);
    });

    it("Reverts if the number of stuck validators of the operator does not match what is stored on the contract", async () => {
      await expect(
        stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, {
          ...correction,
          currentNodeOperatorStuckValidatorsCount: 1n,
        }),
      )
        .to.be.revertedWithCustomError(stakingRouter, "UnexpectedCurrentValidatorsCount")
        .withArgs(0n, 0n, 0n);
    });

    it("Update unsafely the number of exited validators on the staking module", async () => {
      await expect(stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, true, correction))
        .to.be.emit(stakingModule, "Mock__ValidatorsCountUnsafelyUpdated")
        .withArgs(
          moduleId,
          correction.newNodeOperatorExitedValidatorsCount,
          correction.newNodeOperatorStuckValidatorsCount,
        )
        .and.to.emit(stakingModule, "Mock__onExitedAndStuckValidatorsCountsUpdated");
    });

    it("Update unsafely the number of exited validators on the staking module", async () => {
      const triggerHook = false;

      await expect(
        stakingRouter.unsafeSetExitedValidatorsCount(moduleId, nodeOperatorId, triggerHook, correction),
      ).not.to.emit(stakingModule, "Mock__onExitedAndStuckValidatorsCountsUpdated");
    });
  });

  context("reportStakingModuleStuckValidatorsCountByNodeOperator", () => {
    const NODE_OPERATOR_IDS = bigintToHex(1n, true, 8);
    const STUCK_VALIDATOR_COUNTS = bigintToHex(100n, true, 16);

    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter
          .connect(user)
          .reportStakingModuleStuckValidatorsCountByNodeOperator(moduleId, NODE_OPERATOR_IDS, STUCK_VALIDATOR_COUNTS),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE());
    });

    it("Reverts if the node operators ids are packed incorrectly", async () => {
      const incorrectlyPackedNodeOperatorIds = bufToHex(new Uint8Array([1]), true, 7);

      await expect(
        stakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator(
          moduleId,
          incorrectlyPackedNodeOperatorIds,
          STUCK_VALIDATOR_COUNTS,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(3n);
    });

    it("Reverts if the validator counts are packed incorrectly", async () => {
      const incorrectlyPackedValidatorCounts = bufToHex(new Uint8Array([100]), true, 15);

      await expect(
        stakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          incorrectlyPackedValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(3n);
    });

    it("Reverts if the number of node operators does not match validator counts", async () => {
      const tooManyValidatorCounts = STUCK_VALIDATOR_COUNTS + bigintToHex(101n, false, 16);

      await expect(
        stakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          tooManyValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(2n);
    });

    it("Reverts if the number of node operators does not match validator counts", async () => {
      const tooManyValidatorCounts = STUCK_VALIDATOR_COUNTS + bigintToHex(101n, false, 16);

      await expect(
        stakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          tooManyValidatorCounts,
        ),
      )
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(2n);
    });

    it("Reverts if the node operators ids is empty", async () => {
      await expect(stakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator(moduleId, "0x", "0x"))
        .to.be.revertedWithCustomError(stakingRouter, "InvalidReportData")
        .withArgs(1n);
    });

    it("Updates stuck validators count on the module", async () => {
      await expect(
        stakingRouter.reportStakingModuleStuckValidatorsCountByNodeOperator(
          moduleId,
          NODE_OPERATOR_IDS,
          STUCK_VALIDATOR_COUNTS,
        ),
      )
        .to.emit(stakingModule, "Mock__StuckValidatorsCountUpdated")
        .withArgs(NODE_OPERATOR_IDS, STUCK_VALIDATOR_COUNTS);
    });
  });

  context("onValidatorsCountsByNodeOperatorReportingFinished", () => {
    it("Reverts if the caller does not have the role", async () => {
      await expect(
        stakingRouter.connect(user).onValidatorsCountsByNodeOperatorReportingFinished(),
      ).to.be.revertedWithOZAccessControlError(user.address, await stakingRouter.REPORT_EXITED_VALIDATORS_ROLE());
    });

    it("Calls the hook on the staking module", async () => {
      await expect(stakingRouter.onValidatorsCountsByNodeOperatorReportingFinished()).to.emit(
        stakingModule,
        "Mock__onExitedAndStuckValidatorsCountsUpdated",
      );
    });

    it("Does nothing if there is a mismatch between exited validators count on the module and the router cache", async () => {
      await stakingModule.mock__getStakingModuleSummary(1n, 0n, 0n);

      await expect(stakingRouter.onValidatorsCountsByNodeOperatorReportingFinished()).not.to.emit(
        stakingModule,
        "Mock__onExitedAndStuckValidatorsCountsUpdated",
      );
    });

    it("Reverts if the hook fails without revert data", async () => {
      await stakingModule.mock__onExitedAndStuckValidatorsCountsUpdated(true, "");

      await expect(stakingRouter.onValidatorsCountsByNodeOperatorReportingFinished()).to.be.revertedWithCustomError(
        stakingRouter,
        "UnrecoverableModuleError",
      );
    });

    it("Logs the revert data if the hook fails", async () => {
      // TODO
    });
  });
});
