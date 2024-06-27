import { expect } from "chai";
import { encodeBytes32String, ZeroAddress } from "ethers";
import { ethers } from "hardhat";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
  ACL,
  Kernel,
  Lido,
  LidoLocator,
  LidoLocator__factory,
  NodeOperatorsRegistry__MockForFlow,
  NodeOperatorsRegistry__MockForFlow__factory,
} from "typechain-types";

import { addNodeOperator,certainAddress, ether, NodeOperatorConfig, prepIdsCountsPayload } from "lib";

import { addAragonApp, deployLidoDao } from "test/deploy";
import { Snapshot } from "test/suite";

describe("NodeOperatorsRegistry", () => {
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  let limitsManager: HardhatEthersSigner;
  let nodeOperatorsManager: HardhatEthersSigner;
  let signingKeysManager: HardhatEthersSigner;
  let stakingRouter: HardhatEthersSigner;
  let lido: Lido;
  let dao: Kernel;
  let acl: ACL;
  let locator: LidoLocator;

  let impl: NodeOperatorsRegistry__MockForFlow;
  let nor: NodeOperatorsRegistry__MockForFlow;

  let originalState: string;

  const NODE_OPERATORS: NodeOperatorConfig[] = [
    {
      name: "foo",
      rewardAddress: certainAddress("node-operator-1"),
      totalSigningKeysCount: 10n,
      depositedSigningKeysCount: 5n,
      exitedSigningKeysCount: 1n,
      vettedSigningKeysCount: 6n,
      stuckValidatorsCount: 0n,
      refundedValidatorsCount: 0n,
      stuckPenaltyEndAt: 0n,
    },
    {
      name: " bar",
      rewardAddress: certainAddress("node-operator-2"),
      totalSigningKeysCount: 15n,
      depositedSigningKeysCount: 7n,
      exitedSigningKeysCount: 0n,
      vettedSigningKeysCount: 10n,
      stuckValidatorsCount: 0n,
      refundedValidatorsCount: 0n,
      stuckPenaltyEndAt: 0n,
    },
    {
      name: "deactivated",
      isActive: false,
      rewardAddress: certainAddress("node-operator-3"),
      totalSigningKeysCount: 10n,
      depositedSigningKeysCount: 0n,
      exitedSigningKeysCount: 0n,
      vettedSigningKeysCount: 5n,
      stuckValidatorsCount: 0n,
      refundedValidatorsCount: 0n,
      stuckPenaltyEndAt: 0n,
    },
  ];

  const moduleType = encodeBytes32String("curated-onchain-v1");
  const penaltyDelay = 86400n;
  const contractVersion = 2n;

  before(async () => {
    [deployer, user, stakingRouter, nodeOperatorsManager, signingKeysManager, limitsManager, stranger] =
      await ethers.getSigners();

    ({ lido, dao, acl } = await deployLidoDao({
      rootAccount: deployer,
      initialized: true,
      locatorConfig: {
        stakingRouter,
      },
    }));

    impl = await new NodeOperatorsRegistry__MockForFlow__factory(deployer).deploy();
    const appProxy = await addAragonApp({
      dao,
      name: "node-operators-registry",
      impl,
      rootAccount: deployer,
    });

    nor = NodeOperatorsRegistry__MockForFlow__factory.connect(appProxy, deployer);

    await acl.createPermission(user, lido, await lido.RESUME_ROLE(), deployer);

    await acl.createPermission(stakingRouter, nor, await nor.STAKING_ROUTER_ROLE(), deployer);
    await acl.createPermission(signingKeysManager, nor, await nor.MANAGE_SIGNING_KEYS(), deployer);
    await acl.createPermission(nodeOperatorsManager, nor, await nor.MANAGE_NODE_OPERATOR_ROLE(), deployer);
    await acl.createPermission(limitsManager, nor, await nor.SET_NODE_OPERATOR_LIMIT_ROLE(), deployer);

    // grant role to nor itself cause it uses solidity's call method to itself
    // inside the testing_requestValidatorsKeysForDeposits() method
    await acl.grantPermission(nor, nor, await nor.STAKING_ROUTER_ROLE());

    locator = LidoLocator__factory.connect(await lido.getLidoLocator(), user);

    // Initialize the nor's proxy.
    await expect(nor.initialize(locator, moduleType, penaltyDelay))
      .to.emit(nor, "ContractVersionSet")
      .withArgs(contractVersion)
      .and.to.emit(nor, "LocatorContractSet")
      .withArgs(locator)
      .and.to.emit(nor, "StakingModuleTypeSet")
      .withArgs(moduleType);

    nor = nor.connect(user);
  });

  beforeEach(async () => (originalState = await Snapshot.take()));

  afterEach(async () => await Snapshot.restore(originalState));

  context("onRewardsMinted", () => {
    beforeEach(async () => {
      await nor.connect(nodeOperatorsManager).addNodeOperator("abcdef", certainAddress("node-operator-0"));
      expect(await nor.getNodeOperatorIsActive(0n)).to.be.true;
    });

    it("Reverts if has no STAKING_ROUTER_ROLE assigned", async () => {
      await expect(nor.onRewardsMinted(10n)).to.be.revertedWith("APP_AUTH_FAILED");
    });

    it("Does nothing yet if called by StakingRouter", async () => {
      await nor.connect(stakingRouter).onRewardsMinted(10n);
    });
  });

  context("updateStuckValidatorsCount", () => {
    const firstNodeOperatorId = 0;
    const secondNodeOperatorId = 1;
    const thirdNodeOperatorId = 2;

    beforeEach(async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[firstNodeOperatorId])).to.be.equal(
        firstNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[secondNodeOperatorId])).to.be.equal(
        secondNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[thirdNodeOperatorId])).to.be.equal(
        thirdNodeOperatorId,
      );

      await nor.connect(nodeOperatorsManager).setStuckPenaltyDelay(86400n);
    });

    it("Reverts if has no STAKING_ROUTER_ROLE assigned", async () => {
      const idsPayload = prepIdsCountsPayload([], []);
      await expect(nor.updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts)).to.be.revertedWith(
        "APP_AUTH_FAILED",
      );
    });

    it("Allows calling with zero length data", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([], []);
      await expect(nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts))
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.not.emit(nor, "StuckPenaltyStateChanged");
    });

    it("Allows updating a single NO", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [2n]);
      await expect(nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts))
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 2n, 0n, 0n);
    });

    it("Allows updating a group of NOs", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId), BigInt(secondNodeOperatorId)], [2n, 3n]);
      await expect(nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts))
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 2n, 0n, 0n)
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(secondNodeOperatorId, 3n, 0n, 0n);
    });

    it("Does nothing if stuck keys haven't changed", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [2n]);
      await expect(nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts))
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 2n, 0n, 0n);

      await expect(nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts))
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 2n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 2n)
        .to.not.emit(nor, "StuckPenaltyStateChanged");
    });

    it("Allows setting stuck count to zero after all", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [2n]);

      await expect(nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts))
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 2n, 0n, 0n);

      const idsPayloadZero = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [0n]);

      const timestamp = BigInt(await time.latest());
      await expect(
        nor.connect(stakingRouter).updateStuckValidatorsCount(idsPayloadZero.operatorIds, idsPayloadZero.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 2n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 2n)
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 0n, 0n, timestamp + 86400n + 1n);
    });
  });

  context("updateExitedValidatorsCount", () => {
    const firstNodeOperatorId = 0;
    const secondNodeOperatorId = 1;
    const thirdNodeOperatorId = 2;

    beforeEach(async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[firstNodeOperatorId])).to.be.equal(
        firstNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[secondNodeOperatorId])).to.be.equal(
        secondNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[thirdNodeOperatorId])).to.be.equal(
        thirdNodeOperatorId,
      );

      await nor.connect(nodeOperatorsManager).setStuckPenaltyDelay(86400n);
    });

    it("Reverts if has no STAKING_ROUTER_ROLE assigned", async () => {
      const idsPayload = prepIdsCountsPayload([], []);
      await expect(nor.updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts)).to.be.revertedWith(
        "APP_AUTH_FAILED",
      );
    });

    it("Allows calling with zero length data", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([], []);
      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.not.emit(nor, "ExitedSigningKeysCountChanged");
    });

    it("Allows updating exited keys for a single NO", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [2n]);
      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "ExitedSigningKeysCountChanged")
        .withArgs(firstNodeOperatorId, 2n);
    });

    it("Allows updating exited keys for a group of NOs", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId), BigInt(secondNodeOperatorId)], [2n, 3n]);
      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "ExitedSigningKeysCountChanged")
        .withArgs(firstNodeOperatorId, 2n)
        .to.emit(nor, "ExitedSigningKeysCountChanged")
        .withArgs(secondNodeOperatorId, 3n);
    });

    it("Does nothing if exited keys haven't changed", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [2n]);
      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "ExitedSigningKeysCountChanged")
        .withArgs(firstNodeOperatorId, 2n);

      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 2n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 2n)
        .to.not.emit(nor, "ExitedSigningKeysCountChanged");
    });

    it("Reverts on attemp to decrease exited keys count", async () => {
      const nonce = await nor.getNonce();
      const idsPayload = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [2n]);

      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayload.operatorIds, idsPayload.keysCounts),
      )
        .to.emit(nor, "KeysOpIndexSet")
        .withArgs(nonce + 1n)
        .to.emit(nor, "NonceChanged")
        .withArgs(nonce + 1n)
        .to.emit(nor, "ExitedSigningKeysCountChanged")
        .withArgs(firstNodeOperatorId, 2n);

      const idsPayloadZero = prepIdsCountsPayload([BigInt(firstNodeOperatorId)], [0n]);

      await expect(
        nor.connect(stakingRouter).updateExitedValidatorsCount(idsPayloadZero.operatorIds, idsPayloadZero.keysCounts),
      ).to.revertedWith("EXITED_VALIDATORS_COUNT_DECREASED");
    });
  });

  context("updateRefundedValidatorsCount", () => {
    const firstNodeOperatorId = 0;
    const secondNodeOperatorId = 1;
    const thirdNodeOperatorId = 2;

    beforeEach(async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[firstNodeOperatorId])).to.be.equal(
        firstNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[secondNodeOperatorId])).to.be.equal(
        secondNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[thirdNodeOperatorId])).to.be.equal(
        thirdNodeOperatorId,
      );

      await nor.connect(nodeOperatorsManager).setStuckPenaltyDelay(86400n);
    });

    it("Revers if no such an operator exists", async () => {
      await expect(nor.updateRefundedValidatorsCount(4n, 0n)).to.be.revertedWith("OUT_OF_RANGE");
    });

    it("Reverts if has no STAKING_ROUTER_ROLE assigned", async () => {
      await expect(nor.updateRefundedValidatorsCount(firstNodeOperatorId, 0n)).to.be.revertedWith("APP_AUTH_FAILED");
    });

    it("Allows updating a single NO", async () => {
      await expect(nor.connect(stakingRouter).updateRefundedValidatorsCount(firstNodeOperatorId, 1n))
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 0n, 1n, 0n)
        .to.not.emit(nor, "KeysOpIndexSet")
        .to.not.emit(nor, "NonceChanged");
    });

    it("Does nothing if refunded keys haven't changed", async () => {
      await expect(nor.connect(stakingRouter).updateRefundedValidatorsCount(firstNodeOperatorId, 1n))
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 0n, 1n, 0n)
        .to.not.emit(nor, "KeysOpIndexSet")
        .to.not.emit(nor, "NonceChanged");

      await expect(nor.connect(stakingRouter).updateRefundedValidatorsCount(firstNodeOperatorId, 1n))
        .to.not.emit(nor, "KeysOpIndexSet")
        .to.not.emit(nor, "NonceChanged")
        .to.not.emit(nor, "StuckPenaltyStateChanged");
    });

    it("Allows setting refunded count to zero after all", async () => {
      await expect(nor.connect(stakingRouter).updateRefundedValidatorsCount(firstNodeOperatorId, 1n))
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 0n, 1n, 0n)
        .to.not.emit(nor, "KeysOpIndexSet")
        .to.not.emit(nor, "NonceChanged");

      await expect(nor.connect(stakingRouter).updateRefundedValidatorsCount(firstNodeOperatorId, 0n))
        .to.emit(nor, "StuckPenaltyStateChanged")
        .withArgs(firstNodeOperatorId, 0n, 0n, 0n)
        .to.not.emit(nor, "KeysOpIndexSet")
        .to.not.emit(nor, "NonceChanged");
    });
  });

  context("onExitedAndStuckValidatorsCountsUpdated", () => {
    const firstNodeOperatorId = 0;
    const secondNodeOperatorId = 1;

    beforeEach(async () => {
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[firstNodeOperatorId])).to.be.equal(
        firstNodeOperatorId,
      );
      expect(await addNodeOperator(nor, nodeOperatorsManager, NODE_OPERATORS[secondNodeOperatorId])).to.be.equal(
        secondNodeOperatorId,
      );
    });

    it("Reverts if has no STAKING_ROUTER_ROLE assigned", async () => {
      expect(await acl["hasPermission(address,address,bytes32)"](stranger, nor, await nor.STAKING_ROUTER_ROLE())).to.be
        .false;

      await expect(nor.connect(stranger).onExitedAndStuckValidatorsCountsUpdated()).to.be.revertedWith(
        "APP_AUTH_FAILED",
      );
    });

    it("Performs rewards distribution when called by StakingRouter", async () => {
      expect(await acl["hasPermission(address,address,bytes32)"](stakingRouter, nor, await nor.STAKING_ROUTER_ROLE()))
        .to.be.true;

      await lido.connect(user).resume();
      await user.sendTransaction({ to: await lido.getAddress(), value: ether("1.0") });
      await lido.connect(user).transfer(await nor.getAddress(), await lido.balanceOf(user));

      await expect(nor.connect(stakingRouter).onExitedAndStuckValidatorsCountsUpdated()).to.emit(
        nor,
        "RewardsDistributed",
      );
    });
  });

  context("isOperatorPenalized", () => {});

  context("isOperatorPenaltyCleared", () => {});

  context("clearNodeOperatorPenalty", () => {});

  context("_distributeRewards()", () => {
    it("TODO", async () => {});
  });
});
