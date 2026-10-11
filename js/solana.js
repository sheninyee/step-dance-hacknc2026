// Solana (devnet): connect the Phantom wallet, then save a "practice complete" memo on-chain.
const { Connection, PublicKey, Transaction, TransactionInstruction } = solanaWeb3;
const solanaStatus = document.getElementById('solanaStatus');
document.getElementById('solanaButton').addEventListener('click', async () => {
  try {
    const { publicKey } = await window.solana.connect();
    const connection = new Connection('https://api.devnet.solana.com');
    const transaction = new Transaction().add(new TransactionInstruction({
      keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: new TextEncoder().encode('Step Dance practice complete')
    }));
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signed = await window.solana.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    solanaStatus.innerHTML = `<a href="https://explorer.solana.com/tx/${signature}?cluster=devnet">Saved on Solana</a>`;
  } catch (error) {
    solanaStatus.textContent = window.solana ? `Solana: ${error.message}` : 'Install the Phantom wallet to use Solana.';
  }
});
