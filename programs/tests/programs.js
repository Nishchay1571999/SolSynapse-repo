const anchor = require("@coral-xyz/anchor");

describe("programs", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  it("Is initialized!", async () => {
    // Add your test here.
    const program = anchor.workspace.programs;
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
