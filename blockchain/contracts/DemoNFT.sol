// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/**
 * @title  DemoNFT (CWDEED)
 * @notice Open-mint ERC721 standing in for real-world titles in the demo
 *         ("Property Deed", "Car Title", ...). Name and kind live on-chain so
 *         dashboards need no metadata server.
 */
contract DemoNFT is ERC721Enumerable {
    struct Deed {
        string name; // e.g. "Property Deed - 12 Park Street"
        string kind; // e.g. "PROPERTY" | "VEHICLE" | "OTHER"
    }

    uint256 private _nextTokenId = 1;
    mapping(uint256 => Deed) private _deeds;

    event DeedMinted(address indexed to, uint256 indexed tokenId, string name, string kind);

    constructor() ERC721("ChainWill Deed", "CWDEED") {}

    function mint(address to, string calldata name_, string calldata kind_) external returns (uint256 tokenId) {
        require(bytes(name_).length > 0 && bytes(name_).length <= 64, "Name must be 1-64 bytes");
        require(bytes(kind_).length <= 32, "Kind too long");
        tokenId = _nextTokenId++;
        _deeds[tokenId] = Deed({name: name_, kind: kind_});
        _safeMint(to, tokenId);
        emit DeedMinted(to, tokenId, name_, kind_);
    }

    function deedOf(uint256 tokenId) external view returns (string memory name_, string memory kind_, address holder) {
        holder = ownerOf(tokenId); // reverts for unknown ids
        Deed storage d = _deeds[tokenId];
        return (d.name, d.kind, holder);
    }

    function tokensOfOwner(address holder) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(holder);
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = tokenOfOwnerByIndex(holder, i);
        }
    }
}
