use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

declare_id!("Vka2A2G6PpAgPxKdKRYyaZXaxLVY1prEN5PBtbTumrw");

#[program]
pub mod registry {
    use super::*;

    /// Register a node for the signer with a 32-byte metadata hash.
    /// Creates a PDA account at seeds ["node", owner_pubkey].
    pub fn register_node(ctx: Context<RegisterNode>, metadata_hash: [u8; 32]) -> Result<()> {
        let node = &mut ctx.accounts.node_account;
        node.owner = *ctx.accounts.owner.key;
        node.metadata_hash = metadata_hash;
        Ok(())
    }
}

#[account]
pub struct NodeAccount {
    pub owner: Pubkey,
    pub metadata_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(metadata_hash: [u8; 32])]
pub struct RegisterNode<'info> {
    /// PDA account to store node info
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32, // discriminator + Pubkey + [u8;32]
        seeds = [b"node", owner.key().as_ref()],
        bump
    )]
    pub node_account: Account<'info, NodeAccount>,

    /// The wallet registering the node
    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}
