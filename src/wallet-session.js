/**
 * Optional wallet session restore (SIWE-style personal_sign).
 * Does not send private keys. Mints a tab-local API key after signature verify.
 */
export async function restoreSessionWithWallet({ apiUrl, role, onStatus }) {
  const eth = globalThis.ethereum;
  if (!eth?.request) {
    throw new Error("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
  }
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no accounts.");

  onStatus?.("Requesting session nonce…");
  const nonceRes = await fetch(`${apiUrl}/auth/wallet/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const nonceBody = await nonceRes.json().catch(() => ({}));
  if (!nonceRes.ok) throw new Error(nonceBody.error || "Nonce request failed");

  onStatus?.("Sign the session message in your wallet…");
  const signature = await eth.request({
    method: "personal_sign",
    params: [nonceBody.message, address],
  });

  onStatus?.("Verifying session…");
  const sessRes = await fetch(`${apiUrl}/auth/wallet/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address,
      message: nonceBody.message,
      signature,
      role,
    }),
  });
  const sessBody = await sessRes.json().catch(() => ({}));
  if (!sessRes.ok) throw new Error(sessBody.error || "Wallet session failed");
  return sessBody.session;
}
