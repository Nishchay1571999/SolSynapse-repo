use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

declare_id!("EBZZtxXYjmWM7qRXrVDAh7BPDe38NhQiEnScFLUMQ9PE");

#[program]
pub mod escrow {
    use super::*;

    /// Create an intent PDA and move `amount` lamports into it.
    /// `expiry` is unix timestamp (i64). `payload_hash` is 32-byte hash of payload.
    pub fn create_intent(
        ctx: Context<CreateIntent>,
        amount: u64,
        payload_hash: [u8; 32],
        expiry: i64,
    ) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        intent.sender = *ctx.accounts.sender.key;
        intent.receiver = *ctx.accounts.receiver.key;
        intent.amount = amount;
        intent.payload_hash = payload_hash;
        intent.expiry = expiry;
        intent.finalized = false;

        // Transfer the escrow amount from sender to the intent account.
        // Sender must be a signer; this instruction is signed by sender.
        let ix = system_instruction::transfer(
            ctx.accounts.sender.key,
            ctx.accounts.intent.to_account_info().key,
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.sender.to_account_info(),
                ctx.accounts.intent.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        Ok(())
    }

    /// Finalize the intent. Only the `receiver` (signer) can finalize.
    /// Closing the intent account (close = receiver) will transfer all lamports to receiver.
    pub fn finalize_intent(ctx: Context<FinalizeIntent>, _proof: [u8; 32]) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        require!(!intent.finalized, EscrowError::AlreadyFinalized);

        // Optionally verify _proof against intent.payload_hash here.

        intent.finalized = true;
        // The `close = receiver` on the account will move lamports to receiver at the end of the instruction.
        Ok(())
    }

    /// Refund an expired intent to the sender. Only the `sender` (signer) may call after expiry.
    /// Closing the intent account (close = sender) will transfer lamports to sender.
    pub fn refund_intent(ctx: Context<RefundIntent>) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > intent.expiry,
            EscrowError::NotExpired
        );
        require!(!intent.finalized, EscrowError::AlreadyFinalized);

        // Close attribute will refund all lamports to sender.
        Ok(())
    }
}

#[account]
pub struct Intent {
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub amount: u64,
    pub payload_hash: [u8; 32],
    pub expiry: i64,
    pub finalized: bool,
}

#[derive(Accounts)]
#[instruction(amount: u64, payload_hash: [u8;32], expiry: i64)]
pub struct CreateIntent<'info> {
    /// Intent PDA (will be funded by the sender)
    #[account(
        init,
        payer = sender,
        space = 8 + 32 + 32 + 8 + 32 + 8 + 1,
        seeds = [b"intent", sender.key().as_ref(), receiver.key().as_ref(), &expiry.to_le_bytes()],
        bump
    )]
    pub intent: Account<'info, Intent>,

    /// The payer and signer (who funds the intent)
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: The receiver's pubkey is stored in the intent. We don't deserialize
    /// or access its data here. It is later validated when the receiver signs
    /// to finalize the intent.
    pub receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeIntent<'info> {
    /// Intent PDA; close to receiver when instruction ends
    #[account(
        mut,
        seeds = [b"intent", intent.sender.as_ref(), intent.receiver.as_ref(), &intent.expiry.to_le_bytes()],
        bump,
        close = receiver
    )]
    pub intent: Account<'info, Intent>,

    /// CHECK: The receiver must sign and its address is verified against intent.receiver
    #[account(mut, address = intent.receiver)]
    pub receiver: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundIntent<'info> {
    /// Intent PDA; close to sender when instruction ends
    #[account(
        mut,
        seeds = [b"intent", intent.sender.as_ref(), intent.receiver.as_ref(), &intent.expiry.to_le_bytes()],
        bump,
        close = sender
    )]
    pub intent: Account<'info, Intent>,

    /// CHECK: The sender must sign and its address is verified against intent.sender
    #[account(mut, address = intent.sender)]
    pub sender: Signer<'info>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Already finalized")]
    AlreadyFinalized,
    #[msg("Not yet expired")]
    NotExpired,
}
