require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const GANACHE_RPC_URL = process.env.GANACHE_RPC_URL || "http://127.0.0.1:7545";
// Ganache's well-known deterministic demo mnemonic. Local test accounts only.
const GANACHE_MNEMONIC =
  process.env.GANACHE_MNEMONIC || "myth like bonus scare over problem client lizard pioneer submit female collect";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Target "paris": no PUSH0 / MCOPY, so the bytecode also runs on Ganache builds whose EVM predates Shanghai.
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    ganache: {
      url: GANACHE_RPC_URL,
      chainId: 1337,
      accounts: { mnemonic: GANACHE_MNEMONIC, count: 10 },
    },
  },
};
