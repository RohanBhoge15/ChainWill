// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

/**
 * @title  WillManager — ChainWill digital will & inheritance escrow
 * @notice One will per owner address. The contract never decides that somebody
 *         is "dead": it only measures the time since the owner's last
 *         proof-of-life (`checkIn`). Once interval + grace have elapsed the will
 *         is ELIGIBLE and the executor — the human trust point — may activate it.
 *
 *         Two asset models (see §5.1 of the design):
 *           - fungible (ETH / ERC20)  → split by beneficiary percentage, claimed
 *             with `claimInheritance`
 *           - whole (ERC721 / DOCUMENT) → pre-assigned to exactly one
 *             beneficiary, claimed with `claimAsset`
 *
 *         Everything the will promises is held in escrow by this contract, so a
 *         claim can never fail because the owner moved the asset afterwards.
 */
contract WillManager is ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    // ───────────────────────────── Types ─────────────────────────────

    /// @dev Only ACTIVE / ACTIVATED / REVOKED are ever written to storage.
    ///      ELIGIBLE is derived from block.timestamp inside `getStatus`.
    enum Status { ACTIVE, ELIGIBLE, ACTIVATED, REVOKED }

    /// @dev Finer-grained, purely derived view of the lifecycle (adds the soft
    ///      MISSED state). Never stored.
    enum Phase { NONE, ACTIVE, MISSED, ELIGIBLE, ACTIVATED, REVOKED }

    enum AssetType { ETH, ERC20, ERC721, DOCUMENT }

    struct Beneficiary {
        address wallet;
        uint8 percentage;   // share of FUNGIBLE assets only (ETH/ERC20); sum <= 100
        bool hasClaimed;    // set when the beneficiary claims their fungible share
    }

    struct Asset {
        AssetType assetType;
        address tokenAddress; // 0x0 for ETH / DOCUMENT
        uint256 amountOrId;   // amount for ETH/ERC20, tokenId for ERC721, 0 for DOCUMENT
        string docHash;       // sha256 (hex) of the plaintext document
        string storageCID;    // IPFS / local-storage pointer of the encrypted blob
        address assignedTo;   // ERC721/DOCUMENT: the ONE beneficiary who inherits it whole
        bool isClaimed;
        bool removed;         // withdrawn by the owner (or returned on revoke); index stays stable
    }

    struct Will {
        address owner;
        address executor;
        uint256 lastCheckIn;
        uint256 checkInInterval;
        uint256 gracePeriod;
        Status status;
        Beneficiary[] beneficiaries;
        Asset[] assets;
        uint16 totalPercentage;
        bool activated;
        uint256 createdAt;
        uint256 activatedAt;
    }

    /// @dev Flat, array-free snapshot returned by `getWill` for the UI/backend.
    struct WillView {
        address owner;
        address executor;
        uint256 lastCheckIn;
        uint256 checkInInterval;
        uint256 gracePeriod;
        Status status;          // computed (may be ELIGIBLE)
        Phase phase;            // computed (may be MISSED)
        uint16 totalPercentage;
        bool activated;
        uint256 createdAt;
        uint256 activatedAt;
        uint256 checkInDeadline; // lastCheckIn + interval
        uint256 graceDeadline;   // lastCheckIn + interval + grace
        uint256 ethEscrow;       // ETH currently held for this will
        uint256 ethSnapshot;     // ETH held at activation (basis for % payouts)
        uint256 beneficiaryCount;
        uint256 assetCount;
        uint256 chainTime;       // block.timestamp the answer was computed at
    }

    // ─────────────────────────── Constants ───────────────────────────

    uint256 public constant MIN_PERIOD = 10 seconds;
    uint256 public constant MAX_PERIOD = 3650 days;
    /// @dev Hard caps keep every loop bounded so no will can be gas-griefed
    ///      into an unclaimable / unrevokable state.
    uint256 public constant MAX_BENEFICIARIES = 20;
    uint256 public constant MAX_ASSETS = 50;
    /// @dev `assetIndex` value used in AssetClaimed for percentage payouts.
    uint256 public constant FUNGIBLE_SHARE = type(uint256).max;

    // ──────────────────────────── Storage ────────────────────────────

    mapping(address => Will) public wills;         // ownerAddress => Will (one will per owner)
    mapping(address => uint256) public ethEscrow;  // ETH deposited for a will
    mapping(address => uint256) public ethSnapshot; // ethEscrow frozen at activation
    mapping(address => mapping(address => uint256)) public tokenEscrow;   // owner => token => amount
    mapping(address => mapping(address => uint256)) public tokenSnapshot; // owner => token => amount at activation

    address[] private _willOwners;                                    // enumeration for dashboards
    mapping(address => address[]) private _willTokens;                // owner => distinct ERC20s
    mapping(address => mapping(address => bool)) private _tokenListed;
    mapping(address => mapping(address => uint256)) private _beneficiaryIndex; // owner => wallet => index+1

    // ──────────────────────────── Events ─────────────────────────────

    event WillCreated(address indexed owner, address indexed executor, uint256 checkInInterval, uint256 gracePeriod);
    event BeneficiaryAdded(address indexed owner, address indexed beneficiary, uint8 pct);
    event BeneficiaryRemoved(address indexed owner, address indexed beneficiary, uint8 pct);
    event AssetRegistered(
        address indexed owner,
        uint256 indexed assetIndex,
        AssetType t,
        address token,
        uint256 amountOrId,
        string docHash,
        string storageCID,
        address assignedTo
    );
    event AssetAssigned(address indexed owner, address indexed beneficiary, uint256 assetIndex);
    event AssetRemoved(address indexed owner, uint256 indexed assetIndex, AssetType t, address token, uint256 amountOrId);
    event CheckInPerformed(address indexed owner, uint256 timestamp);
    event ScheduleUpdated(address indexed owner, uint256 checkInInterval, uint256 gracePeriod);
    event ExecutorChanged(address indexed owner, address indexed previousExecutor, address indexed newExecutor);
    event InheritanceActivated(address indexed owner, address indexed executor, uint256 timestamp);
    /// @param amount     wei / token units for fungible payouts, tokenId for NFTs, 0 for documents
    /// @param assetIndex index into the will's asset list, or FUNGIBLE_SHARE for percentage payouts
    event AssetClaimed(
        address indexed owner,
        address indexed beneficiary,
        AssetType t,
        address token,
        uint256 amount,
        uint256 assetIndex
    );
    event WillRevoked(address indexed owner, uint256 ethRefunded);

    // ─────────────────────────── Modifiers ───────────────────────────

    /// @dev Caller owns a will that is still editable (not activated, not revoked).
    ///      An owner who is alive can always act — even after the deadline has
    ///      lapsed — as long as the executor has not activated the will yet.
    modifier onlyOwnerOfWill() {
        Will storage w = wills[msg.sender];
        require(w.owner == msg.sender, "No will found for caller");
        require(w.status == Status.ACTIVE, "Will is no longer active");
        _;
    }

    modifier onlyExecutor(address owner) {
        require(wills[owner].owner != address(0), "Will does not exist");
        require(msg.sender == wills[owner].executor, "Not authorized executor");
        _;
    }

    modifier onlyBeneficiary(address owner) {
        require(wills[owner].owner != address(0), "Will does not exist");
        require(_beneficiaryIndex[owner][msg.sender] != 0, "Not a beneficiary");
        _;
    }

    // ───────────────────────── Owner: set-up ─────────────────────────

    /// @notice Create the caller's will. A previously revoked will may be replaced.
    function createWill(address executor, uint256 interval, uint256 grace) external {
        Will storage w = wills[msg.sender];
        require(w.owner == address(0) || w.status == Status.REVOKED, "Will already exists");
        require(executor != address(0), "Executor is the zero address");
        require(executor != msg.sender, "Owner cannot be the executor");
        _requireValidSchedule(interval, grace);

        if (w.owner == address(0)) {
            _willOwners.push(msg.sender);
        } else {
            _clearRevokedWill(w);
        }

        w.owner = msg.sender;
        w.executor = executor;
        w.lastCheckIn = block.timestamp;
        w.checkInInterval = interval;
        w.gracePeriod = grace;
        w.status = Status.ACTIVE;
        w.totalPercentage = 0;
        w.activated = false;
        w.createdAt = block.timestamp;
        w.activatedAt = 0;

        emit WillCreated(msg.sender, executor, interval, grace);
        emit CheckInPerformed(msg.sender, block.timestamp);
    }

    function addBeneficiary(address wallet, uint8 pct) external onlyOwnerOfWill {
        Will storage w = wills[msg.sender];
        require(wallet != address(0), "Beneficiary is the zero address");
        require(wallet != msg.sender, "Owner cannot be a beneficiary");
        require(pct > 0, "Percentage must be greater than 0");
        require(_beneficiaryIndex[msg.sender][wallet] == 0, "Beneficiary already added");
        require(w.totalPercentage + pct <= 100, "Total percentage exceeds 100");
        require(w.beneficiaries.length < MAX_BENEFICIARIES, "Too many beneficiaries");

        w.beneficiaries.push(Beneficiary({wallet: wallet, percentage: pct, hasClaimed: false}));
        _beneficiaryIndex[msg.sender][wallet] = w.beneficiaries.length;
        w.totalPercentage += pct;

        emit BeneficiaryAdded(msg.sender, wallet, pct);
    }

    /// @notice Remove a beneficiary and free up their percentage, so a typo can
    ///         never permanently burn part of the will.
    function removeBeneficiary(address wallet) external onlyOwnerOfWill {
        Will storage w = wills[msg.sender];
        uint256 pos = _beneficiaryIndex[msg.sender][wallet];
        require(pos != 0, "Not a beneficiary");

        uint256 assetCount = w.assets.length;
        for (uint256 i = 0; i < assetCount; i++) {
            Asset storage a = w.assets[i];
            require(a.removed || a.assignedTo != wallet, "Beneficiary still has assigned assets");
        }

        uint256 index = pos - 1;
        uint256 last = w.beneficiaries.length - 1;
        uint8 pct = w.beneficiaries[index].percentage;
        if (index != last) {
            Beneficiary storage moved = w.beneficiaries[last];
            w.beneficiaries[index] = moved;
            _beneficiaryIndex[msg.sender][moved.wallet] = pos;
        }
        w.beneficiaries.pop();
        delete _beneficiaryIndex[msg.sender][wallet];
        w.totalPercentage -= pct;

        emit BeneficiaryRemoved(msg.sender, wallet, pct);
    }

    /// @notice Escrow ETH or ERC20 tokens to be split by percentage.
    ///         For ERC20 the caller must `approve` this contract first.
    function registerFungibleAsset(AssetType t, address token, uint256 amount)
        external
        payable
        nonReentrant
        onlyOwnerOfWill
    {
        Will storage w = wills[msg.sender];
        require(w.assets.length < MAX_ASSETS, "Too many assets");
        require(amount > 0, "Amount must be greater than 0");

        uint256 received = amount;
        if (t == AssetType.ETH) {
            require(token == address(0), "Token must be zero for ETH");
            require(msg.value == amount, "ETH sent does not match amount");
            ethEscrow[msg.sender] += amount;
        } else if (t == AssetType.ERC20) {
            require(msg.value == 0, "Do not send ETH with an ERC20 deposit");
            require(token != address(0), "Token is the zero address");
            IERC20 erc20 = IERC20(token);
            uint256 balanceBefore = erc20.balanceOf(address(this));
            erc20.safeTransferFrom(msg.sender, address(this), amount);
            received = erc20.balanceOf(address(this)) - balanceBefore; // honest for fee-on-transfer tokens
            require(received > 0, "No tokens received");
            tokenEscrow[msg.sender][token] += received;
            if (!_tokenListed[msg.sender][token]) {
                _tokenListed[msg.sender][token] = true;
                _willTokens[msg.sender].push(token);
            }
        } else {
            revert("Not a fungible asset type");
        }

        w.assets.push(
            Asset({
                assetType: t,
                tokenAddress: token,
                amountOrId: received,
                docHash: "",
                storageCID: "",
                assignedTo: address(0),
                isClaimed: false,
                removed: false
            })
        );
        emit AssetRegistered(msg.sender, w.assets.length - 1, t, token, received, "", "", address(0));
    }

    /// @notice Register an NFT (escrowed here) or a document fingerprint, assigned
    ///         whole to ONE beneficiary. For ERC721 the caller must `approve` first.
    function registerWholeAsset(
        AssetType t,
        address token,
        uint256 amountOrId,
        string calldata hash,
        string calldata cid,
        address assignedTo
    ) external nonReentrant onlyOwnerOfWill {
        Will storage w = wills[msg.sender];
        require(w.assets.length < MAX_ASSETS, "Too many assets");
        require(_beneficiaryIndex[msg.sender][assignedTo] != 0, "Assignee is not a beneficiary");

        if (t == AssetType.ERC721) {
            require(token != address(0), "Token is the zero address");
            require(IERC721(token).ownerOf(amountOrId) == msg.sender, "Caller does not own this NFT");
            IERC721(token).transferFrom(msg.sender, address(this), amountOrId);
        } else if (t == AssetType.DOCUMENT) {
            require(token == address(0) && amountOrId == 0, "Documents carry no token data");
            require(bytes(hash).length == 64, "Document hash must be a sha256 hex string");
            require(bytes(cid).length > 0, "Storage CID required");
        } else {
            revert("Not a whole asset type");
        }

        w.assets.push(
            Asset({
                assetType: t,
                tokenAddress: token,
                amountOrId: amountOrId,
                docHash: hash,
                storageCID: cid,
                assignedTo: assignedTo,
                isClaimed: false,
                removed: false
            })
        );
        uint256 index = w.assets.length - 1;
        emit AssetRegistered(msg.sender, index, t, token, amountOrId, hash, cid, assignedTo);
        emit AssetAssigned(msg.sender, assignedTo, index);
    }

    /// @notice Hand a whole asset (NFT/document) to a different beneficiary.
    function reassignAsset(uint256 assetIndex, address newAssignee) external onlyOwnerOfWill {
        Will storage w = wills[msg.sender];
        require(assetIndex < w.assets.length, "Invalid asset index");
        Asset storage a = w.assets[assetIndex];
        require(!a.removed, "Asset was removed");
        require(a.assetType == AssetType.ERC721 || a.assetType == AssetType.DOCUMENT, "Only whole assets are assigned");
        require(_beneficiaryIndex[msg.sender][newAssignee] != 0, "Assignee is not a beneficiary");

        a.assignedTo = newAssignee;
        emit AssetAssigned(msg.sender, newAssignee, assetIndex);
    }

    /// @notice Take an asset back out of the will. ETH / tokens / NFT return to the owner.
    function removeAsset(uint256 assetIndex) external nonReentrant onlyOwnerOfWill {
        Will storage w = wills[msg.sender];
        require(assetIndex < w.assets.length, "Invalid asset index");
        Asset storage a = w.assets[assetIndex];
        require(!a.removed, "Asset was removed");

        // effects
        a.removed = true;
        AssetType t = a.assetType;
        address token = a.tokenAddress;
        uint256 amountOrId = a.amountOrId;
        if (t == AssetType.ETH) {
            ethEscrow[msg.sender] -= amountOrId;
        } else if (t == AssetType.ERC20) {
            tokenEscrow[msg.sender][token] -= amountOrId;
        }
        emit AssetRemoved(msg.sender, assetIndex, t, token, amountOrId);

        // interactions
        if (t == AssetType.ETH) {
            _sendEth(msg.sender, amountOrId);
        } else if (t == AssetType.ERC20) {
            IERC20(token).safeTransfer(msg.sender, amountOrId);
        } else if (t == AssetType.ERC721) {
            IERC721(token).transferFrom(address(this), msg.sender, amountOrId);
        }
    }

    // ──────────────────────── Owner: lifecycle ───────────────────────

    /// @notice Proof-of-life. Resets the timer back to a full interval.
    function checkIn() external onlyOwnerOfWill {
        wills[msg.sender].lastCheckIn = block.timestamp;
        emit CheckInPerformed(msg.sender, block.timestamp);
    }

    /// @notice Change interval / grace. Signing this is itself a proof-of-life,
    ///         so the timer restarts under the new schedule.
    function updateSchedule(uint256 interval, uint256 grace) external onlyOwnerOfWill {
        _requireValidSchedule(interval, grace);
        Will storage w = wills[msg.sender];
        w.checkInInterval = interval;
        w.gracePeriod = grace;
        w.lastCheckIn = block.timestamp;
        emit ScheduleUpdated(msg.sender, interval, grace);
        emit CheckInPerformed(msg.sender, block.timestamp);
    }

    function updateExecutor(address newExecutor) external onlyOwnerOfWill {
        require(newExecutor != address(0), "Executor is the zero address");
        require(newExecutor != msg.sender, "Owner cannot be the executor");
        Will storage w = wills[msg.sender];
        address previous = w.executor;
        require(newExecutor != previous, "Already the executor");
        w.executor = newExecutor;
        emit ExecutorChanged(msg.sender, previous, newExecutor);
    }

    /// @notice Cancel the will and return every escrowed asset to the owner.
    function revokeWill() external nonReentrant onlyOwnerOfWill {
        Will storage w = wills[msg.sender];

        // effects
        w.status = Status.REVOKED;
        uint256 ethRefund = ethEscrow[msg.sender];
        ethEscrow[msg.sender] = 0;

        address[] storage tokens = _willTokens[msg.sender];
        uint256 tokenCount = tokens.length;
        uint256[] memory tokenRefunds = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            tokenRefunds[i] = tokenEscrow[msg.sender][tokens[i]];
            tokenEscrow[msg.sender][tokens[i]] = 0;
        }

        uint256 assetCount = w.assets.length;
        bool[] memory returnNft = new bool[](assetCount);
        for (uint256 i = 0; i < assetCount; i++) {
            Asset storage a = w.assets[i];
            if (!a.removed) {
                a.removed = true;
                returnNft[i] = a.assetType == AssetType.ERC721;
            }
        }
        emit WillRevoked(msg.sender, ethRefund);

        // interactions
        for (uint256 i = 0; i < tokenCount; i++) {
            if (tokenRefunds[i] > 0) IERC20(tokens[i]).safeTransfer(msg.sender, tokenRefunds[i]);
        }
        for (uint256 i = 0; i < assetCount; i++) {
            if (returnNft[i]) {
                Asset storage a = w.assets[i];
                IERC721(a.tokenAddress).transferFrom(address(this), msg.sender, a.amountOrId);
            }
        }
        if (ethRefund > 0) _sendEth(msg.sender, ethRefund);
    }

    // ─────────────────────────── Executor ────────────────────────────

    /// @notice Executor pulls the trigger once interval + grace have elapsed
    ///         without a check-in. Freezes the escrow balances that the
    ///         percentage payouts are computed from.
    function activateInheritance(address owner) external onlyExecutor(owner) {
        Will storage w = wills[owner];
        require(getStatus(owner) == Status.ELIGIBLE, "Will is not eligible for inheritance");
        require(w.totalPercentage > 0, "Will has no beneficiaries");

        w.status = Status.ACTIVATED;
        w.activated = true;
        w.activatedAt = block.timestamp;

        ethSnapshot[owner] = ethEscrow[owner];
        address[] storage tokens = _willTokens[owner];
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenSnapshot[owner][tokens[i]] = tokenEscrow[owner][tokens[i]];
        }

        emit InheritanceActivated(owner, msg.sender, block.timestamp);
    }

    // ────────────────────────── Beneficiary ──────────────────────────

    /// @notice Claim the caller's percentage of all fungible assets (ETH + ERC20).
    function claimInheritance(address owner) external nonReentrant onlyBeneficiary(owner) {
        Will storage w = wills[owner];
        require(w.activated, "Inheritance has not been activated");

        Beneficiary storage b = w.beneficiaries[_beneficiaryIndex[owner][msg.sender] - 1];
        require(!b.hasClaimed, "Already claimed");

        // effects
        b.hasClaimed = true;
        uint256 pct = b.percentage;

        uint256 ethShare = (ethSnapshot[owner] * pct) / 100;
        ethEscrow[owner] -= ethShare;

        address[] storage tokens = _willTokens[owner];
        uint256 tokenCount = tokens.length;
        uint256[] memory tokenShares = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            uint256 share = (tokenSnapshot[owner][tokens[i]] * pct) / 100; // dust stays in escrow
            tokenShares[i] = share;
            tokenEscrow[owner][tokens[i]] -= share;
        }

        // interactions
        for (uint256 i = 0; i < tokenCount; i++) {
            if (tokenShares[i] > 0) {
                IERC20(tokens[i]).safeTransfer(msg.sender, tokenShares[i]);
                emit AssetClaimed(owner, msg.sender, AssetType.ERC20, tokens[i], tokenShares[i], FUNGIBLE_SHARE);
            }
        }
        emit AssetClaimed(owner, msg.sender, AssetType.ETH, address(0), ethShare, FUNGIBLE_SHARE);
        if (ethShare > 0) _sendEth(msg.sender, ethShare);
    }

    /// @notice Claim one whole asset (NFT or document) assigned to the caller.
    ///         For documents the contract only flips `isClaimed`; the backend
    ///         reads that flag before it releases the decrypted file.
    function claimAsset(address owner, uint256 assetIndex) external nonReentrant {
        Will storage w = wills[owner];
        require(w.owner != address(0), "Will does not exist");
        require(w.activated, "Inheritance has not been activated");
        require(assetIndex < w.assets.length, "Invalid asset index");

        Asset storage a = w.assets[assetIndex];
        require(!a.removed, "Asset was removed");
        require(
            a.assetType == AssetType.ERC721 || a.assetType == AssetType.DOCUMENT,
            "Fungible assets are claimed with claimInheritance"
        );
        require(a.assignedTo == msg.sender, "Not the assigned beneficiary");
        require(!a.isClaimed, "Already claimed");

        // effects
        a.isClaimed = true;
        emit AssetClaimed(owner, msg.sender, a.assetType, a.tokenAddress, a.amountOrId, assetIndex);

        // interactions
        if (a.assetType == AssetType.ERC721) {
            IERC721(a.tokenAddress).safeTransferFrom(address(this), msg.sender, a.amountOrId);
        }
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Lifecycle status computed from timestamps — nobody can set it by hand.
    function getStatus(address owner) public view returns (Status) {
        Will storage w = wills[owner];
        require(w.owner != address(0), "Will does not exist");
        if (w.status == Status.REVOKED) return Status.REVOKED;
        if (w.activated) return Status.ACTIVATED;
        if (block.timestamp > w.lastCheckIn + w.checkInInterval + w.gracePeriod) return Status.ELIGIBLE;
        return Status.ACTIVE;
    }

    /// @notice Like `getStatus` but also exposes the soft MISSED state and
    ///         returns NONE (instead of reverting) when there is no will.
    function getPhase(address owner) public view returns (Phase) {
        Will storage w = wills[owner];
        if (w.owner == address(0)) return Phase.NONE;
        if (w.status == Status.REVOKED) return Phase.REVOKED;
        if (w.activated) return Phase.ACTIVATED;
        uint256 deadline = w.lastCheckIn + w.checkInInterval;
        if (block.timestamp > deadline + w.gracePeriod) return Phase.ELIGIBLE;
        if (block.timestamp > deadline) return Phase.MISSED;
        return Phase.ACTIVE;
    }

    function hasWill(address owner) external view returns (bool) {
        return wills[owner].owner != address(0);
    }

    function getWill(address owner) external view returns (WillView memory v) {
        Will storage w = wills[owner];
        require(w.owner != address(0), "Will does not exist");
        v.owner = w.owner;
        v.executor = w.executor;
        v.lastCheckIn = w.lastCheckIn;
        v.checkInInterval = w.checkInInterval;
        v.gracePeriod = w.gracePeriod;
        v.status = getStatus(owner);
        v.phase = getPhase(owner);
        v.totalPercentage = w.totalPercentage;
        v.activated = w.activated;
        v.createdAt = w.createdAt;
        v.activatedAt = w.activatedAt;
        v.checkInDeadline = w.lastCheckIn + w.checkInInterval;
        v.graceDeadline = v.checkInDeadline + w.gracePeriod;
        v.ethEscrow = ethEscrow[owner];
        v.ethSnapshot = ethSnapshot[owner];
        v.beneficiaryCount = w.beneficiaries.length;
        v.assetCount = w.assets.length;
        v.chainTime = block.timestamp;
    }

    function getBeneficiaries(address owner) external view returns (Beneficiary[] memory) {
        return wills[owner].beneficiaries;
    }

    function getAssets(address owner) external view returns (Asset[] memory) {
        return wills[owner].assets;
    }

    function isBeneficiary(address owner, address wallet) external view returns (bool) {
        return _beneficiaryIndex[owner][wallet] != 0;
    }

    /// @notice ERC20s escrowed for a will, with live and at-activation balances.
    function getTokens(address owner)
        external
        view
        returns (address[] memory tokens, uint256[] memory escrowed, uint256[] memory snapshot)
    {
        tokens = _willTokens[owner];
        escrowed = new uint256[](tokens.length);
        snapshot = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            escrowed[i] = tokenEscrow[owner][tokens[i]];
            snapshot[i] = tokenSnapshot[owner][tokens[i]];
        }
    }

    /// @notice What `claimInheritance` would pay this beneficiary right now.
    ///         Before activation this is a projection from the live escrow.
    function previewClaim(address owner, address wallet)
        external
        view
        returns (uint256 ethAmount, address[] memory tokens, uint256[] memory tokenAmounts)
    {
        Will storage w = wills[owner];
        tokens = _willTokens[owner];
        tokenAmounts = new uint256[](tokens.length);
        uint256 pos = _beneficiaryIndex[owner][wallet];
        if (pos == 0) return (0, tokens, tokenAmounts);

        Beneficiary storage b = w.beneficiaries[pos - 1];
        if (b.hasClaimed) return (0, tokens, tokenAmounts);

        uint256 pct = b.percentage;
        bool frozen = w.activated;
        ethAmount = ((frozen ? ethSnapshot[owner] : ethEscrow[owner]) * pct) / 100;
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 basis = frozen ? tokenSnapshot[owner][tokens[i]] : tokenEscrow[owner][tokens[i]];
            tokenAmounts[i] = (basis * pct) / 100;
        }
    }

    function willCount() external view returns (uint256) {
        return _willOwners.length;
    }

    function getWillOwners() external view returns (address[] memory) {
        return _willOwners;
    }

    /// @notice The timestamp the node would stamp on the next block — the
    ///         clock every deadline in this contract is measured against.
    function chainTime() external view returns (uint256) {
        return block.timestamp;
    }

    // ─────────────────────────── Internals ───────────────────────────

    function _requireValidSchedule(uint256 interval, uint256 grace) private pure {
        require(interval >= MIN_PERIOD && interval <= MAX_PERIOD, "Check-in interval out of range");
        require(grace >= MIN_PERIOD && grace <= MAX_PERIOD, "Grace period out of range");
    }

    /// @dev Wipes the leftovers of a REVOKED will so the owner can start afresh.
    ///      Escrow balances were already zeroed by `revokeWill`.
    function _clearRevokedWill(Will storage w) private {
        address owner = w.owner;
        uint256 n = w.beneficiaries.length;
        for (uint256 i = 0; i < n; i++) {
            delete _beneficiaryIndex[owner][w.beneficiaries[i].wallet];
        }
        delete w.beneficiaries;
        delete w.assets;

        address[] storage tokens = _willTokens[owner];
        for (uint256 i = 0; i < tokens.length; i++) {
            delete _tokenListed[owner][tokens[i]];
            delete tokenSnapshot[owner][tokens[i]];
        }
        delete _willTokens[owner];
        delete ethSnapshot[owner];
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }
}
