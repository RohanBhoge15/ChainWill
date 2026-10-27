const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const Status = { ACTIVE: 0n, ELIGIBLE: 1n, ACTIVATED: 2n, REVOKED: 3n };
const Phase = { NONE: 0n, ACTIVE: 1n, MISSED: 2n, ELIGIBLE: 3n, ACTIVATED: 4n, REVOKED: 5n };
const AssetType = { ETH: 0, ERC20: 1, ERC721: 2, DOCUMENT: 3 };

const INTERVAL = 120;
const GRACE = 60;
const ZERO = ethers.ZeroAddress;
const DOC_HASH = "a".repeat(64);
const DOC_CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const eth = (n) => ethers.parseEther(String(n));

async function deployFixture() {
  const [alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
  const manager = await (await ethers.getContractFactory("WillManager")).deploy();
  const token = await (await ethers.getContractFactory("DemoToken")).deploy();
  const nft = await (await ethers.getContractFactory("DemoNFT")).deploy();
  return { manager, token, nft, alice, bob, carol, dave, eve, frank };
}

/** Alice's will: Bob executor, Carol 60 / Dave 40. No assets yet. */
async function willFixture() {
  const ctx = await deployFixture();
  const { manager, alice, bob, carol, dave } = ctx;
  await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
  await manager.connect(alice).addBeneficiary(carol.address, 60);
  await manager.connect(alice).addBeneficiary(dave.address, 40);
  return ctx;
}

/** The viva demo will: 10 ETH + 1000 CWT (split), deed NFT → Carol, car NFT + document → Dave. */
async function fundedFixture() {
  const ctx = await willFixture();
  const { manager, token, nft, alice, carol, dave } = ctx;
  const managerAddr = await manager.getAddress();
  const tokenAddr = await token.getAddress();
  const nftAddr = await nft.getAddress();

  await manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, eth(10), { value: eth(10) }); // 0
  await token.mint(alice.address, eth(1000));
  await token.connect(alice).approve(managerAddr, eth(1000));
  await manager.connect(alice).registerFungibleAsset(AssetType.ERC20, tokenAddr, eth(1000)); // 1
  await nft.mint(alice.address, "Property Deed", "PROPERTY"); // id 1
  await nft.mint(alice.address, "Car Title", "VEHICLE"); // id 2
  await nft.connect(alice).setApprovalForAll(managerAddr, true);
  await manager.connect(alice).registerWholeAsset(AssetType.ERC721, nftAddr, 1, "", "", carol.address); // 2
  await manager.connect(alice).registerWholeAsset(AssetType.ERC721, nftAddr, 2, "", "", dave.address); // 3
  await manager.connect(alice).registerWholeAsset(AssetType.DOCUMENT, ZERO, 0, DOC_HASH, DOC_CID, dave.address); // 4
  return { ...ctx, managerAddr, tokenAddr, nftAddr };
}

async function activatedFixture() {
  const ctx = await fundedFixture();
  await time.increase(INTERVAL + GRACE + 1);
  await ctx.manager.connect(ctx.bob).activateInheritance(ctx.alice.address);
  return ctx;
}

describe("WillManager", function () {
  describe("createWill", function () {
    it("creates an ACTIVE will and emits WillCreated + CheckInPerformed", async function () {
      const { manager, alice, bob } = await loadFixture(deployFixture);
      const tx = manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await expect(tx).to.emit(manager, "WillCreated").withArgs(alice.address, bob.address, INTERVAL, GRACE);
      await expect(tx).to.emit(manager, "CheckInPerformed");

      const w = await manager.getWill(alice.address);
      expect(w.owner).to.equal(alice.address);
      expect(w.executor).to.equal(bob.address);
      expect(w.status).to.equal(Status.ACTIVE);
      expect(w.phase).to.equal(Phase.ACTIVE);
      expect(w.checkInDeadline).to.equal(w.lastCheckIn + BigInt(INTERVAL));
      expect(w.graceDeadline).to.equal(w.lastCheckIn + BigInt(INTERVAL + GRACE));
      expect(await manager.willCount()).to.equal(1n);
      expect(await manager.getWillOwners()).to.deep.equal([alice.address]);
      expect(await manager.hasWill(alice.address)).to.equal(true);
    });

    it("rejects a second will, a zero executor, self-executor and bad schedules", async function () {
      const { manager, alice, bob } = await loadFixture(deployFixture);
      await expect(manager.connect(alice).createWill(ZERO, INTERVAL, GRACE)).to.be.revertedWith(
        "Executor is the zero address"
      );
      await expect(manager.connect(alice).createWill(alice.address, INTERVAL, GRACE)).to.be.revertedWith(
        "Owner cannot be the executor"
      );
      await expect(manager.connect(alice).createWill(bob.address, 5, GRACE)).to.be.revertedWith(
        "Check-in interval out of range"
      );
      await expect(manager.connect(alice).createWill(bob.address, INTERVAL, 0)).to.be.revertedWith(
        "Grace period out of range"
      );
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await expect(manager.connect(alice).createWill(bob.address, INTERVAL, GRACE)).to.be.revertedWith(
        "Will already exists"
      );
    });

    it("reports NONE / reverts for an address without a will", async function () {
      const { manager, eve } = await loadFixture(deployFixture);
      expect(await manager.getPhase(eve.address)).to.equal(Phase.NONE);
      expect(await manager.hasWill(eve.address)).to.equal(false);
      await expect(manager.getStatus(eve.address)).to.be.revertedWith("Will does not exist");
      await expect(manager.connect(eve).checkIn()).to.be.revertedWith("No will found for caller");
    });
  });

  describe("beneficiaries", function () {
    it("adds beneficiaries and tracks the percentage total", async function () {
      const { manager, alice, bob, carol, dave } = await loadFixture(deployFixture);
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await expect(manager.connect(alice).addBeneficiary(carol.address, 60))
        .to.emit(manager, "BeneficiaryAdded")
        .withArgs(alice.address, carol.address, 60);
      await manager.connect(alice).addBeneficiary(dave.address, 40);

      const list = await manager.getBeneficiaries(alice.address);
      expect(list.map((b) => [b.wallet, b.percentage, b.hasClaimed])).to.deep.equal([
        [carol.address, 60n, false],
        [dave.address, 40n, false],
      ]);
      expect((await manager.getWill(alice.address)).totalPercentage).to.equal(100n);
      expect(await manager.isBeneficiary(alice.address, carol.address)).to.equal(true);
    });

    it("enforces total <= 100, no duplicates, no zero pct, no owner, no zero address", async function () {
      const { manager, alice, carol, eve } = await loadFixture(willFixture);
      await expect(manager.connect(alice).addBeneficiary(eve.address, 1)).to.be.revertedWith(
        "Total percentage exceeds 100"
      );
      await manager.connect(alice).removeBeneficiary(carol.address);
      await expect(manager.connect(alice).addBeneficiary(eve.address, 61)).to.be.revertedWith(
        "Total percentage exceeds 100"
      );
      await expect(manager.connect(alice).addBeneficiary(eve.address, 0)).to.be.revertedWith(
        "Percentage must be greater than 0"
      );
      await expect(manager.connect(alice).addBeneficiary(alice.address, 10)).to.be.revertedWith(
        "Owner cannot be a beneficiary"
      );
      await expect(manager.connect(alice).addBeneficiary(ZERO, 10)).to.be.revertedWith(
        "Beneficiary is the zero address"
      );
      await manager.connect(alice).addBeneficiary(eve.address, 60);
      await expect(manager.connect(alice).addBeneficiary(eve.address, 0)).to.be.reverted;
    });

    it("rejects a duplicate beneficiary", async function () {
      const { manager, alice, bob, carol } = await loadFixture(deployFixture);
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await manager.connect(alice).addBeneficiary(carol.address, 10);
      await expect(manager.connect(alice).addBeneficiary(carol.address, 10)).to.be.revertedWith(
        "Beneficiary already added"
      );
    });

    it("removeBeneficiary frees the percentage so a typo is fixable", async function () {
      const { manager, alice, bob, carol, dave, eve } = await loadFixture(deployFixture);
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await manager.connect(alice).addBeneficiary(carol.address, 90); // typo: meant 60
      await manager.connect(alice).addBeneficiary(eve.address, 5);
      await expect(manager.connect(alice).addBeneficiary(dave.address, 40)).to.be.revertedWith(
        "Total percentage exceeds 100"
      );

      await expect(manager.connect(alice).removeBeneficiary(carol.address))
        .to.emit(manager, "BeneficiaryRemoved")
        .withArgs(alice.address, carol.address, 90);
      expect((await manager.getWill(alice.address)).totalPercentage).to.equal(5n);
      expect(await manager.isBeneficiary(alice.address, carol.address)).to.equal(false);

      await manager.connect(alice).addBeneficiary(carol.address, 55);
      await manager.connect(alice).addBeneficiary(dave.address, 40);
      expect((await manager.getWill(alice.address)).totalPercentage).to.equal(100n);

      // swap-and-pop kept the index map consistent: every remaining wallet can still be removed
      await manager.connect(alice).removeBeneficiary(eve.address);
      await manager.connect(alice).removeBeneficiary(dave.address);
      await manager.connect(alice).removeBeneficiary(carol.address);
      expect(await manager.getBeneficiaries(alice.address)).to.have.lengthOf(0);
      expect((await manager.getWill(alice.address)).totalPercentage).to.equal(0n);
      await expect(manager.connect(alice).removeBeneficiary(carol.address)).to.be.revertedWith("Not a beneficiary");
    });

    it("refuses to remove a beneficiary who still has assigned assets", async function () {
      const { manager, alice, carol, dave } = await loadFixture(fundedFixture);
      await expect(manager.connect(alice).removeBeneficiary(carol.address)).to.be.revertedWith(
        "Beneficiary still has assigned assets"
      );
      await manager.connect(alice).reassignAsset(2, dave.address);
      await manager.connect(alice).removeBeneficiary(carol.address);
      expect(await manager.isBeneficiary(alice.address, carol.address)).to.equal(false);
    });

    it("caps the number of beneficiaries", async function () {
      const { manager, alice, bob } = await loadFixture(deployFixture);
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      for (let i = 0; i < 20; i++) {
        await manager.connect(alice).addBeneficiary(ethers.Wallet.createRandom().address, 1);
      }
      await expect(
        manager.connect(alice).addBeneficiary(ethers.Wallet.createRandom().address, 1)
      ).to.be.revertedWith("Too many beneficiaries");
    });

    it("only the will owner can edit their own will", async function () {
      const { manager, eve, carol } = await loadFixture(willFixture);
      await expect(manager.connect(eve).addBeneficiary(carol.address, 1)).to.be.revertedWith(
        "No will found for caller"
      );
      await expect(manager.connect(eve).removeBeneficiary(carol.address)).to.be.revertedWith(
        "No will found for caller"
      );
      await expect(manager.connect(eve).revokeWill()).to.be.revertedWith("No will found for caller");
    });
  });

  describe("assets", function () {
    it("escrows ETH and records it", async function () {
      const { manager, alice } = await loadFixture(willFixture);
      const managerAddr = await manager.getAddress();
      const tx = manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, eth(10), { value: eth(10) });
      await expect(tx).to.changeEtherBalances([alice, manager], [-eth(10), eth(10)]);
      await expect(tx)
        .to.emit(manager, "AssetRegistered")
        .withArgs(alice.address, 0, AssetType.ETH, ZERO, eth(10), "", "", ZERO);
      expect(await manager.ethEscrow(alice.address)).to.equal(eth(10));
      expect(await ethers.provider.getBalance(managerAddr)).to.equal(eth(10));
      const [asset] = await manager.getAssets(alice.address);
      expect(asset.assetType).to.equal(BigInt(AssetType.ETH));
      expect(asset.amountOrId).to.equal(eth(10));
    });

    it("rejects malformed fungible deposits", async function () {
      const { manager, token, nft, alice } = await loadFixture(willFixture);
      const tokenAddr = await token.getAddress();
      await expect(
        manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, eth(1), { value: eth(2) })
      ).to.be.revertedWith("ETH sent does not match amount");
      await expect(manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, 0)).to.be.revertedWith(
        "Amount must be greater than 0"
      );
      await expect(
        manager.connect(alice).registerFungibleAsset(AssetType.ETH, tokenAddr, eth(1), { value: eth(1) })
      ).to.be.revertedWith("Token must be zero for ETH");
      await expect(
        manager.connect(alice).registerFungibleAsset(AssetType.ERC20, tokenAddr, eth(1), { value: eth(1) })
      ).to.be.revertedWith("Do not send ETH with an ERC20 deposit");
      await expect(
        manager.connect(alice).registerFungibleAsset(AssetType.ERC721, await nft.getAddress(), 1)
      ).to.be.revertedWith("Not a fungible asset type");
      // no allowance → the token itself refuses
      await token.mint(alice.address, eth(5));
      await expect(manager.connect(alice).registerFungibleAsset(AssetType.ERC20, tokenAddr, eth(5))).to.be.reverted;
    });

    it("escrows ERC20 tokens", async function () {
      const { manager, token, alice, managerAddr, tokenAddr } = await loadFixture(fundedFixture);
      expect(await token.balanceOf(managerAddr)).to.equal(eth(1000));
      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await manager.tokenEscrow(alice.address, tokenAddr)).to.equal(eth(1000));
      const [tokens, escrowed, snapshot] = await manager.getTokens(alice.address);
      expect(tokens).to.deep.equal([tokenAddr]);
      expect(escrowed).to.deep.equal([eth(1000)]);
      expect(snapshot).to.deep.equal([0n]);
    });

    it("escrows NFTs, assigned whole to one beneficiary", async function () {
      const { manager, nft, alice, carol, managerAddr, nftAddr } = await loadFixture(fundedFixture);
      expect(await nft.ownerOf(1)).to.equal(managerAddr);
      const assets = await manager.getAssets(alice.address);
      expect(assets[2].assetType).to.equal(BigInt(AssetType.ERC721));
      expect(assets[2].tokenAddress).to.equal(nftAddr);
      expect(assets[2].amountOrId).to.equal(1n);
      expect(assets[2].assignedTo).to.equal(carol.address);
      expect(assets[2].isClaimed).to.equal(false);
    });

    it("refuses an NFT the caller does not hold, or one not approved", async function () {
      const { manager, nft, alice, carol, eve } = await loadFixture(willFixture);
      const nftAddr = await nft.getAddress();
      await nft.mint(eve.address, "Eve's Yacht", "OTHER"); // id 1, not Alice's
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.ERC721, nftAddr, 1, "", "", carol.address)
      ).to.be.revertedWith("Caller does not own this NFT");

      await nft.mint(alice.address, "Property Deed", "PROPERTY"); // id 2, no approval given
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.ERC721, nftAddr, 2, "", "", carol.address)
      ).to.be.reverted;
    });

    it("requires the assignee to be a beneficiary and validates documents", async function () {
      const { manager, token, alice, carol, eve } = await loadFixture(willFixture);
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.DOCUMENT, ZERO, 0, DOC_HASH, DOC_CID, eve.address)
      ).to.be.revertedWith("Assignee is not a beneficiary");
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.DOCUMENT, ZERO, 0, "abc", DOC_CID, carol.address)
      ).to.be.revertedWith("Document hash must be a sha256 hex string");
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.DOCUMENT, ZERO, 0, DOC_HASH, "", carol.address)
      ).to.be.revertedWith("Storage CID required");
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.DOCUMENT, ZERO, 7, DOC_HASH, DOC_CID, carol.address)
      ).to.be.revertedWith("Documents carry no token data");
      await expect(
        manager.connect(alice).registerWholeAsset(AssetType.ERC20, await token.getAddress(), 1, "", "", carol.address)
      ).to.be.revertedWith("Not a whole asset type");
    });

    it("registers a document fingerprint and emits AssetRegistered + AssetAssigned", async function () {
      const { manager, alice, dave } = await loadFixture(willFixture);
      const tx = manager.connect(alice).registerWholeAsset(AssetType.DOCUMENT, ZERO, 0, DOC_HASH, DOC_CID, dave.address);
      await expect(tx)
        .to.emit(manager, "AssetRegistered")
        .withArgs(alice.address, 0, AssetType.DOCUMENT, ZERO, 0, DOC_HASH, DOC_CID, dave.address);
      await expect(tx).to.emit(manager, "AssetAssigned").withArgs(alice.address, dave.address, 0);
    });

    it("reassignAsset moves a whole asset to another beneficiary only", async function () {
      const { manager, alice, carol, dave, eve } = await loadFixture(fundedFixture);
      await expect(manager.connect(alice).reassignAsset(4, carol.address))
        .to.emit(manager, "AssetAssigned")
        .withArgs(alice.address, carol.address, 4);
      expect((await manager.getAssets(alice.address))[4].assignedTo).to.equal(carol.address);
      await expect(manager.connect(alice).reassignAsset(4, eve.address)).to.be.revertedWith(
        "Assignee is not a beneficiary"
      );
      await expect(manager.connect(alice).reassignAsset(0, dave.address)).to.be.revertedWith(
        "Only whole assets are assigned"
      );
      await expect(manager.connect(alice).reassignAsset(99, dave.address)).to.be.revertedWith("Invalid asset index");
    });

    it("removeAsset returns ETH, tokens and NFTs to the owner and keeps indexes stable", async function () {
      const { manager, token, nft, alice, tokenAddr } = await loadFixture(fundedFixture);

      await expect(manager.connect(alice).removeAsset(0)).to.changeEtherBalances([alice, manager], [eth(10), -eth(10)]);
      expect(await manager.ethEscrow(alice.address)).to.equal(0n);

      await expect(manager.connect(alice).removeAsset(1)).to.changeTokenBalances(
        token,
        [alice, manager],
        [eth(1000), -eth(1000)]
      );
      expect(await manager.tokenEscrow(alice.address, tokenAddr)).to.equal(0n);

      await expect(manager.connect(alice).removeAsset(2)).to.emit(manager, "AssetRemoved");
      expect(await nft.ownerOf(1)).to.equal(alice.address);

      const assets = await manager.getAssets(alice.address);
      expect(assets).to.have.lengthOf(5);
      expect(assets.map((a) => a.removed)).to.deep.equal([true, true, true, false, false]);
      await expect(manager.connect(alice).removeAsset(2)).to.be.revertedWith("Asset was removed");
      await expect(manager.connect(alice).reassignAsset(2, alice.address)).to.be.revertedWith("Asset was removed");
    });

    it("caps the number of assets", async function () {
      const { manager, alice } = await loadFixture(willFixture);
      for (let i = 0; i < 50; i++) {
        await manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, 1, { value: 1 });
      }
      await expect(
        manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, 1, { value: 1 })
      ).to.be.revertedWith("Too many assets");
    });
  });

  describe("check-in & status (computed from block.timestamp)", function () {
    it("walks ACTIVE → MISSED → ELIGIBLE purely with the passage of time", async function () {
      const { manager, alice } = await loadFixture(willFixture);
      const { lastCheckIn } = await manager.getWill(alice.address);

      await time.increaseTo(lastCheckIn + BigInt(INTERVAL));
      expect(await manager.getPhase(alice.address)).to.equal(Phase.ACTIVE);
      expect(await manager.getStatus(alice.address)).to.equal(Status.ACTIVE);

      await time.increaseTo(lastCheckIn + BigInt(INTERVAL) + 1n);
      expect(await manager.getPhase(alice.address)).to.equal(Phase.MISSED);
      expect(await manager.getStatus(alice.address)).to.equal(Status.ACTIVE); // MISSED is a soft state

      await time.increaseTo(lastCheckIn + BigInt(INTERVAL + GRACE));
      expect(await manager.getPhase(alice.address)).to.equal(Phase.MISSED);

      await time.increaseTo(lastCheckIn + BigInt(INTERVAL + GRACE) + 1n);
      expect(await manager.getPhase(alice.address)).to.equal(Phase.ELIGIBLE);
      expect(await manager.getStatus(alice.address)).to.equal(Status.ELIGIBLE);
      // nothing was written: the stored status is still ACTIVE
      expect((await manager.wills(alice.address)).status).to.equal(Status.ACTIVE);
    });

    it("checkIn resets the timer — even from MISSED or ELIGIBLE", async function () {
      const { manager, alice, bob } = await loadFixture(willFixture);
      await time.increase(INTERVAL + 10);
      expect(await manager.getPhase(alice.address)).to.equal(Phase.MISSED);
      await expect(manager.connect(alice).checkIn()).to.emit(manager, "CheckInPerformed");
      expect(await manager.getPhase(alice.address)).to.equal(Phase.ACTIVE);

      await time.increase(INTERVAL + GRACE + 10);
      expect(await manager.getStatus(alice.address)).to.equal(Status.ELIGIBLE);
      await manager.connect(alice).checkIn(); // the owner is alive: proof-of-life wins
      expect(await manager.getStatus(alice.address)).to.equal(Status.ACTIVE);
      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Will is not eligible for inheritance"
      );
    });

    it("only the owner's own will is checked in", async function () {
      const { manager, bob } = await loadFixture(willFixture);
      await expect(manager.connect(bob).checkIn()).to.be.revertedWith("No will found for caller");
    });

    it("updateSchedule changes the timing and restarts the timer", async function () {
      const { manager, alice } = await loadFixture(willFixture);
      await time.increase(INTERVAL + 10);
      const tx = manager.connect(alice).updateSchedule(3600, 600);
      await expect(tx).to.emit(manager, "ScheduleUpdated").withArgs(alice.address, 3600, 600);
      await expect(tx).to.emit(manager, "CheckInPerformed");
      const w = await manager.getWill(alice.address);
      expect(w.checkInInterval).to.equal(3600n);
      expect(w.gracePeriod).to.equal(600n);
      expect(w.phase).to.equal(Phase.ACTIVE);
      await expect(manager.connect(alice).updateSchedule(1, 600)).to.be.revertedWith(
        "Check-in interval out of range"
      );
    });

    it("updateExecutor hands the trigger to someone else", async function () {
      const { manager, alice, bob, eve } = await loadFixture(willFixture);
      await expect(manager.connect(alice).updateExecutor(eve.address))
        .to.emit(manager, "ExecutorChanged")
        .withArgs(alice.address, bob.address, eve.address);
      await time.increase(INTERVAL + GRACE + 1);
      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Not authorized executor"
      );
      await manager.connect(eve).activateInheritance(alice.address);
      await expect(manager.connect(alice).updateExecutor(bob.address)).to.be.revertedWith("Will is no longer active");
    });
  });

  describe("activateInheritance", function () {
    it("reverts for anyone who is not the executor", async function () {
      const { manager, alice, carol, eve } = await loadFixture(fundedFixture);
      await time.increase(INTERVAL + GRACE + 1);
      await expect(manager.connect(eve).activateInheritance(alice.address)).to.be.revertedWith(
        "Not authorized executor"
      );
      await expect(manager.connect(carol).activateInheritance(alice.address)).to.be.revertedWith(
        "Not authorized executor"
      );
      await expect(manager.connect(alice).activateInheritance(alice.address)).to.be.revertedWith(
        "Not authorized executor"
      );
      await expect(manager.connect(eve).activateInheritance(eve.address)).to.be.revertedWith("Will does not exist");
    });

    it("reverts before the deadline and during the grace period", async function () {
      const { manager, alice, bob } = await loadFixture(fundedFixture);
      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Will is not eligible for inheritance"
      );
      await time.increase(INTERVAL + 5); // grace period
      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Will is not eligible for inheritance"
      );
    });

    it("reverts when the will has no beneficiaries", async function () {
      const { manager, alice, bob } = await loadFixture(deployFixture);
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await time.increase(INTERVAL + GRACE + 1);
      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Will has no beneficiaries"
      );
    });

    it("activates once eligible, snapshots the escrow and locks the owner out", async function () {
      const { manager, alice, bob, carol, tokenAddr } = await loadFixture(fundedFixture);
      await time.increase(INTERVAL + GRACE + 1);
      await expect(manager.connect(bob).activateInheritance(alice.address))
        .to.emit(manager, "InheritanceActivated")
        .withArgs(alice.address, bob.address, (ts) => ts > 0n);

      const w = await manager.getWill(alice.address);
      expect(w.status).to.equal(Status.ACTIVATED);
      expect(w.phase).to.equal(Phase.ACTIVATED);
      expect(w.activated).to.equal(true);
      expect(w.ethSnapshot).to.equal(eth(10));
      expect(await manager.tokenSnapshot(alice.address, tokenAddr)).to.equal(eth(1000));

      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Will is not eligible for inheritance"
      );
      const lockedOut = [
        () => manager.connect(alice).checkIn(),
        () => manager.connect(alice).revokeWill(),
        () => manager.connect(alice).addBeneficiary(bob.address, 1),
        () => manager.connect(alice).removeBeneficiary(carol.address),
        () => manager.connect(alice).removeAsset(0),
        () => manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, 1, { value: 1 }),
        () => manager.connect(alice).updateSchedule(INTERVAL, GRACE),
      ];
      for (const call of lockedOut) {
        await expect(call()).to.be.revertedWith("Will is no longer active");
      }
    });
  });

  describe("claimInheritance (fungible: percentage split)", function () {
    it("cannot be claimed before activation", async function () {
      const { manager, alice, carol } = await loadFixture(fundedFixture);
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.be.revertedWith(
        "Inheritance has not been activated"
      );
      await time.increase(INTERVAL + GRACE + 1); // eligible but executor has not acted
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.be.revertedWith(
        "Inheritance has not been activated"
      );
    });

    it("pays 60% / 40% of ETH and tokens, in any claim order", async function () {
      const { manager, token, alice, carol, dave, tokenAddr } = await loadFixture(activatedFixture);
      const FUNGIBLE = await manager.FUNGIBLE_SHARE();

      const [previewEth, , previewTokens] = await manager.previewClaim(alice.address, dave.address);
      expect(previewEth).to.equal(eth(4));
      expect(previewTokens).to.deep.equal([eth(400)]);

      // Dave (40%) first: his share must be 40% of the ORIGINAL pot …
      const daveTx = manager.connect(dave).claimInheritance(alice.address);
      await expect(daveTx).to.changeEtherBalances([dave, manager], [eth(4), -eth(4)]);
      await expect(daveTx).to.changeTokenBalance(token, dave, eth(400));
      await expect(daveTx)
        .to.emit(manager, "AssetClaimed")
        .withArgs(alice.address, dave.address, AssetType.ETH, ZERO, eth(4), FUNGIBLE);
      await expect(daveTx)
        .to.emit(manager, "AssetClaimed")
        .withArgs(alice.address, dave.address, AssetType.ERC20, tokenAddr, eth(400), FUNGIBLE);

      // … and Carol still gets 60% of the original pot, not 60% of what is left.
      const carolTx = manager.connect(carol).claimInheritance(alice.address);
      await expect(carolTx).to.changeEtherBalances([carol, manager], [eth(6), -eth(6)]);
      await expect(carolTx).to.changeTokenBalance(token, carol, eth(600));

      expect(await manager.ethEscrow(alice.address)).to.equal(0n);
      expect(await manager.tokenEscrow(alice.address, tokenAddr)).to.equal(0n);
      const list = await manager.getBeneficiaries(alice.address);
      expect(list.map((b) => b.hasClaimed)).to.deep.equal([true, true]);
      expect((await manager.previewClaim(alice.address, dave.address))[0]).to.equal(0n);
    });

    it("blocks a double claim", async function () {
      const { manager, alice, carol } = await loadFixture(activatedFixture);
      await manager.connect(carol).claimInheritance(alice.address);
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.be.revertedWith("Already claimed");
    });

    it("blocks non-beneficiaries (including the executor and the owner)", async function () {
      const { manager, alice, bob, eve } = await loadFixture(activatedFixture);
      for (const signer of [eve, bob, alice]) {
        await expect(manager.connect(signer).claimInheritance(alice.address)).to.be.revertedWith("Not a beneficiary");
      }
      await expect(manager.connect(eve).claimInheritance(eve.address)).to.be.revertedWith("Will does not exist");
    });

    it("leaves the unallocated remainder in escrow when percentages sum below 100", async function () {
      const { manager, alice, bob, carol } = await loadFixture(deployFixture);
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await manager.connect(alice).addBeneficiary(carol.address, 30);
      await manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, eth(10), { value: eth(10) });
      await time.increase(INTERVAL + GRACE + 1);
      await manager.connect(bob).activateInheritance(alice.address);
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.changeEtherBalance(carol, eth(3));
      expect(await manager.ethEscrow(alice.address)).to.equal(eth(7));
    });

    it("rounds token shares down and keeps the dust in escrow", async function () {
      const { manager, token, alice, bob, carol, dave, eve } = await loadFixture(deployFixture);
      const managerAddr = await manager.getAddress();
      const tokenAddr = await token.getAddress();
      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await manager.connect(alice).addBeneficiary(carol.address, 33);
      await manager.connect(alice).addBeneficiary(dave.address, 33);
      await manager.connect(alice).addBeneficiary(eve.address, 34);
      await token.mint(alice.address, 101);
      await token.connect(alice).approve(managerAddr, 101);
      await manager.connect(alice).registerFungibleAsset(AssetType.ERC20, tokenAddr, 101);
      await time.increase(INTERVAL + GRACE + 1);
      await manager.connect(bob).activateInheritance(alice.address);

      await manager.connect(carol).claimInheritance(alice.address);
      await manager.connect(dave).claimInheritance(alice.address);
      await manager.connect(eve).claimInheritance(alice.address);
      expect(await token.balanceOf(carol.address)).to.equal(33n);
      expect(await token.balanceOf(dave.address)).to.equal(33n);
      expect(await token.balanceOf(eve.address)).to.equal(34n);
      expect(await manager.tokenEscrow(alice.address, tokenAddr)).to.equal(1n); // dust
    });

    it("keeps separate wills' escrow separate", async function () {
      const { manager, alice, bob, carol, dave } = await loadFixture(fundedFixture);
      // Bob has his own will with Carol as executor and Dave as sole heir
      await manager.connect(bob).createWill(carol.address, INTERVAL, GRACE);
      await manager.connect(bob).addBeneficiary(dave.address, 100);
      await manager.connect(bob).registerFungibleAsset(AssetType.ETH, ZERO, eth(3), { value: eth(3) });

      await time.increase(INTERVAL + GRACE + 1);
      await manager.connect(carol).activateInheritance(bob.address);
      await expect(manager.connect(dave).claimInheritance(bob.address)).to.changeEtherBalance(dave, eth(3));
      // Alice's 10 ETH is untouched and her will is still only ELIGIBLE
      expect(await manager.ethEscrow(alice.address)).to.equal(eth(10));
      expect(await manager.getStatus(alice.address)).to.equal(Status.ELIGIBLE);
    });
  });

  describe("claimAsset (whole: NFT / document)", function () {
    it("transfers the NFT to its assigned beneficiary exactly once", async function () {
      const { manager, nft, alice, carol, nftAddr } = await loadFixture(activatedFixture);
      await expect(manager.connect(carol).claimAsset(alice.address, 2))
        .to.emit(manager, "AssetClaimed")
        .withArgs(alice.address, carol.address, AssetType.ERC721, nftAddr, 1, 2);
      expect(await nft.ownerOf(1)).to.equal(carol.address);
      expect((await manager.getAssets(alice.address))[2].isClaimed).to.equal(true);
      await expect(manager.connect(carol).claimAsset(alice.address, 2)).to.be.revertedWith("Already claimed");
    });

    it("rejects a beneficiary claiming someone else's asset", async function () {
      const { manager, nft, alice, carol, dave, managerAddr } = await loadFixture(activatedFixture);
      await expect(manager.connect(dave).claimAsset(alice.address, 2)).to.be.revertedWith(
        "Not the assigned beneficiary"
      );
      expect(await nft.ownerOf(1)).to.equal(managerAddr);
      // still rejected with the same reason after the rightful heir has claimed it
      await manager.connect(carol).claimAsset(alice.address, 2);
      await expect(manager.connect(dave).claimAsset(alice.address, 2)).to.be.revertedWith(
        "Not the assigned beneficiary"
      );
    });

    it("flips the document flag; a fungible claim alone unlocks nothing", async function () {
      const { manager, alice, dave } = await loadFixture(activatedFixture);
      await manager.connect(dave).claimInheritance(alice.address);
      expect((await manager.getAssets(alice.address))[4].isClaimed).to.equal(false);

      await expect(manager.connect(dave).claimAsset(alice.address, 4))
        .to.emit(manager, "AssetClaimed")
        .withArgs(alice.address, dave.address, AssetType.DOCUMENT, ZERO, 0, 4);
      expect((await manager.getAssets(alice.address))[4].isClaimed).to.equal(true);
    });

    it("rejects claims before activation, on fungible assets, removed assets and bad indexes", async function () {
      const { manager, alice, bob, carol } = await loadFixture(fundedFixture);
      await expect(manager.connect(carol).claimAsset(alice.address, 2)).to.be.revertedWith(
        "Inheritance has not been activated"
      );
      await manager.connect(alice).removeAsset(3); // car NFT back to Alice
      await time.increase(INTERVAL + GRACE + 1);
      await manager.connect(bob).activateInheritance(alice.address);

      await expect(manager.connect(carol).claimAsset(alice.address, 0)).to.be.revertedWith(
        "Fungible assets are claimed with claimInheritance"
      );
      await expect(manager.connect(carol).claimAsset(alice.address, 3)).to.be.revertedWith("Asset was removed");
      await expect(manager.connect(carol).claimAsset(alice.address, 99)).to.be.revertedWith("Invalid asset index");
      await expect(manager.connect(carol).claimAsset(bob.address, 0)).to.be.revertedWith("Will does not exist");
    });
  });

  describe("revokeWill", function () {
    it("returns every escrowed asset to the owner and freezes the will", async function () {
      const { manager, token, nft, alice, bob, carol, tokenAddr } = await loadFixture(fundedFixture);
      const tx = manager.connect(alice).revokeWill();
      await expect(tx).to.changeEtherBalances([alice, manager], [eth(10), -eth(10)]);
      await expect(tx).to.changeTokenBalance(token, alice, eth(1000));
      await expect(tx).to.emit(manager, "WillRevoked").withArgs(alice.address, eth(10));

      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.ownerOf(2)).to.equal(alice.address);
      expect(await manager.ethEscrow(alice.address)).to.equal(0n);
      expect(await manager.tokenEscrow(alice.address, tokenAddr)).to.equal(0n);
      expect(await manager.getStatus(alice.address)).to.equal(Status.REVOKED);
      expect(await manager.getPhase(alice.address)).to.equal(Phase.REVOKED);

      await time.increase(INTERVAL + GRACE + 1);
      expect(await manager.getStatus(alice.address)).to.equal(Status.REVOKED); // never drifts to ELIGIBLE
      await expect(manager.connect(bob).activateInheritance(alice.address)).to.be.revertedWith(
        "Will is not eligible for inheritance"
      );
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.be.revertedWith(
        "Inheritance has not been activated"
      );
      await expect(manager.connect(alice).checkIn()).to.be.revertedWith("Will is no longer active");
    });

    it("lets the owner start a fresh will afterwards with no leftovers", async function () {
      const { manager, alice, carol, dave, eve } = await loadFixture(fundedFixture);
      await manager.connect(alice).revokeWill();
      await manager.connect(alice).createWill(eve.address, 300, 100);

      const w = await manager.getWill(alice.address);
      expect(w.executor).to.equal(eve.address);
      expect(w.status).to.equal(Status.ACTIVE);
      expect(w.totalPercentage).to.equal(0n);
      expect(w.beneficiaryCount).to.equal(0n);
      expect(w.assetCount).to.equal(0n);
      expect(await manager.isBeneficiary(alice.address, carol.address)).to.equal(false);
      expect((await manager.getTokens(alice.address))[0]).to.have.lengthOf(0);
      expect(await manager.willCount()).to.equal(1n); // same owner, not double-listed

      await manager.connect(alice).addBeneficiary(dave.address, 100);
      await manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, eth(1), { value: eth(1) });
      await time.increase(401);
      await manager.connect(eve).activateInheritance(alice.address);
      await expect(manager.connect(dave).claimInheritance(alice.address)).to.changeEtherBalance(dave, eth(1));
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.be.revertedWith("Not a beneficiary");
    });
  });

  describe("reentrancy", function () {
    it("a malicious beneficiary contract cannot re-enter claimInheritance", async function () {
      const { manager, alice, bob, carol } = await loadFixture(deployFixture);
      const managerAddr = await manager.getAddress();
      const attacker = await (await ethers.getContractFactory("ReentrantClaimer")).deploy(managerAddr);
      const attackerAddr = await attacker.getAddress();

      await manager.connect(alice).createWill(bob.address, INTERVAL, GRACE);
      await manager.connect(alice).addBeneficiary(attackerAddr, 50);
      await manager.connect(alice).addBeneficiary(carol.address, 50);
      await manager.connect(alice).registerFungibleAsset(AssetType.ETH, ZERO, eth(10), { value: eth(10) });
      await time.increase(INTERVAL + GRACE + 1);
      await manager.connect(bob).activateInheritance(alice.address);

      await attacker.attack(alice.address);

      expect(await attacker.reentryAttempts()).to.equal(1n);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      // the nested call died on OpenZeppelin's ReentrancyGuard
      const guardError = manager.interface.getError("ReentrancyGuardReentrantCall").selector;
      expect(await attacker.lastRevertData()).to.equal(guardError);
      // attacker got exactly its 50%, and Carol's half is intact
      expect(await ethers.provider.getBalance(attackerAddr)).to.equal(eth(5));
      expect(await manager.ethEscrow(alice.address)).to.equal(eth(5));
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.changeEtherBalance(carol, eth(5));
    });
  });

  describe("full demo script", function () {
    it("runs the viva scenario end to end", async function () {
      const { manager, token, nft, alice, bob, carol, dave, eve } = await loadFixture(fundedFixture);

      await time.increase(60);
      await manager.connect(alice).checkIn(); // step 4
      expect(await manager.getPhase(alice.address)).to.equal(Phase.ACTIVE);

      await time.increase(INTERVAL + 1); // step 5
      expect(await manager.getPhase(alice.address)).to.equal(Phase.MISSED);
      await time.increase(GRACE); // step 6
      expect(await manager.getPhase(alice.address)).to.equal(Phase.ELIGIBLE);
      await manager.connect(bob).activateInheritance(alice.address);

      // step 7
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.changeEtherBalance(carol, eth(6));
      await manager.connect(carol).claimAsset(alice.address, 2);
      expect(await nft.ownerOf(1)).to.equal(carol.address);
      expect(await token.balanceOf(carol.address)).to.equal(eth(600));

      // step 8
      await expect(manager.connect(dave).claimInheritance(alice.address)).to.changeEtherBalance(dave, eth(4));
      await manager.connect(dave).claimAsset(alice.address, 3);
      await manager.connect(dave).claimAsset(alice.address, 4);
      expect(await nft.ownerOf(2)).to.equal(dave.address);

      // step 9
      await expect(manager.connect(carol).claimInheritance(alice.address)).to.be.revertedWith("Already claimed");
      await expect(manager.connect(eve).activateInheritance(alice.address)).to.be.revertedWith(
        "Not authorized executor"
      );
      await expect(manager.connect(dave).claimAsset(alice.address, 2)).to.be.revertedWith(
        "Not the assigned beneficiary"
      );

      expect(await ethers.provider.getBalance(await manager.getAddress())).to.equal(0n);
      const assets = await manager.getAssets(alice.address);
      expect(assets.slice(2).every((a) => a.isClaimed)).to.equal(true);
    });
  });
});

describe("Demo assets", function () {
  it("DemoToken is an open faucet with a per-call cap", async function () {
    const { token, eve } = await loadFixture(deployFixture);
    await token.connect(eve).mint(eve.address, eth(500));
    expect(await token.balanceOf(eve.address)).to.equal(eth(500));
    expect(await token.symbol()).to.equal("CWT");
    await expect(token.mint(eve.address, eth(1_000_001))).to.be.revertedWith("Mint amount out of range");
    await expect(token.mint(eve.address, 0)).to.be.revertedWith("Mint amount out of range");
  });

  it("DemoNFT mints named deeds and lists them per holder", async function () {
    const { nft, alice, eve } = await loadFixture(deployFixture);
    await expect(nft.mint(alice.address, "Property Deed", "PROPERTY"))
      .to.emit(nft, "DeedMinted")
      .withArgs(alice.address, 1, "Property Deed", "PROPERTY");
    await nft.mint(eve.address, "Eve's Yacht", "OTHER");
    await nft.mint(alice.address, "Car Title", "VEHICLE");

    expect(await nft.tokensOfOwner(alice.address)).to.deep.equal([1n, 3n]);
    const [name, kind, holder] = await nft.deedOf(3);
    expect([name, kind, holder]).to.deep.equal(["Car Title", "VEHICLE", alice.address]);
    await expect(nft.mint(alice.address, "", "X")).to.be.revertedWith("Name must be 1-64 bytes");
    await expect(nft.deedOf(99)).to.be.reverted;
  });
});
