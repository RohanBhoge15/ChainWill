/**
 * Deploys WillManager + DemoToken + DemoNFT and writes a single self-contained
 * manifest (addresses + ABIs) to <repo>/deployments/ganache.json, which is the
 * only thing the backend needs to talk to the chain.
 *
 * Idempotent: if the manifest already points at live contracts on this chain,
 * nothing is redeployed (pass --force / FORCE_DEPLOY=1 to override).
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const OUT_DIR = path.resolve(__dirname, "..", "..", "deployments");
const OUT_FILE = path.join(OUT_DIR, `${hre.network.name}.json`);
const CONTRACTS = ["WillManager", "DemoToken", "DemoNFT"];
const FORCE = process.env.FORCE_DEPLOY === "1";

async function alreadyDeployed(chainId) {
  if (FORCE || !fs.existsSync(OUT_FILE)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    if (manifest.chainId !== chainId) return false;
    for (const name of CONTRACTS) {
      const code = await hre.ethers.provider.getCode(manifest.contracts[name].address);
      if (code === "0x") return false;
      // a rebuilt contract must be redeployed, not silently reused with a stale ABI
      const artifact = await hre.artifacts.readArtifact(name);
      if (code !== artifact.deployedBytecode) return false;
    }
    return manifest;
  } catch {
    return false;
  }
}

async function main() {
  const { chainId } = await hre.ethers.provider.getNetwork();
  const existing = await alreadyDeployed(Number(chainId));
  if (existing) {
    console.log(`[deploy] contracts already live on chain ${chainId} — reusing ${path.relative(process.cwd(), OUT_FILE)}`);
    for (const name of CONTRACTS) console.log(`  ${name.padEnd(12)} ${existing.contracts[name].address}`);
    return;
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`[deploy] network=${hre.network.name} chainId=${chainId} deployer=${deployer.address}`);

  const contracts = {};
  let deployBlock = null;
  for (const name of CONTRACTS) {
    const contract = await hre.ethers.deployContract(name);
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction().wait();
    deployBlock = deployBlock ?? receipt.blockNumber;
    const artifact = await hre.artifacts.readArtifact(name);
    contracts[name] = {
      address: await contract.getAddress(),
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      abi: artifact.abi,
    };
    console.log(`  ${name.padEnd(12)} ${contracts[name].address}  (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);
  }

  const manifest = {
    network: hre.network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployBlock,
    deployedAt: new Date().toISOString(),
    contracts,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));
  console.log(`[deploy] manifest written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
