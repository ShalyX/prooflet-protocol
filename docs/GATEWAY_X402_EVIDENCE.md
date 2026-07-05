# Gateway x402 Evidence

Date: 2026-07-04
Network: Arc Testnet
Rail: Circle Gateway x402
Fee: 0.000001 USDC, 1 raw unit

This document records the verified self-funded Circle Gateway x402 job-access flow for Prooflet.

## Verified self-funded flow

Agent:

```json
{
  "agentId": "self_agent_r6pli0z",
  "walletId": "60bb421f-7b6d-59f7-b74b-6e7cdc6043b3",
  "walletAddress": "0x68abdce904bd68c53b0daf43c9b83a5aa8c0b2f7",
  "accountType": "EOA"
}
```

Job:

```json
{
  "jobId": "self_job_r6pli0z"
}
```

### 1. Unpaid claim blocked first

Before access payment, the claim attempt was rejected:

```json
{
  "status": 402,
  "code": "claim_access_payment_required"
}
```

### 2. Treasury funded the agent wallet

Treasury transferred Arc Testnet USDC to the agent wallet address. This funded the agent wallet itself, not the Gateway balance directly.

```json
{
  "from": "0x709F18F797347FbB8D53Fb60567892751dd14B11",
  "to": "0x68abdce904bd68c53b0daf43c9b83a5aa8c0b2f7",
  "txHash": "0xfc4fa08b7175d6c2362003e594c91bf03a6b957fbf475b539630b2ce4750fd16",
  "amount": "0.01",
  "walletUsdcAfterFund": "0.01"
}
```

### 3. Agent wallet approved Gateway

The Circle developer-controlled EOA wallet executed the USDC approval via Circle W3S contract execution.

```json
{
  "circleTxId": "86e33d41-8620-5682-a629-08810a3cc333",
  "txHash": "0x90ee78619fe27e4449ef02796c0b250bb6f6f3e8d3bbe16c74b313f6a4122895",
  "sourceAddress": "0x68abdce904bd68c53b0daf43c9b83a5aa8c0b2f7",
  "contractAddress": "0x3600000000000000000000000000000000000000",
  "abiFunctionSignature": "approve(address,uint256)",
  "abiParameters": [
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    "1"
  ],
  "state": "COMPLETE"
}
```

### 4. Agent wallet deposited to Gateway

The same Circle developer-controlled EOA wallet executed `GatewayWallet.deposit(address token,uint256 value)`. This is the stronger proof path: the agent wallet deposited its own wallet-held USDC into Gateway.

```json
{
  "circleTxId": "55ddb31e-f74e-5a47-a81a-53a04b2eb421",
  "txHash": "0x3fb90bcb5974879b8fe8683bdc28fa554389dc2d86e4213877a81ac8461569b8",
  "sourceAddress": "0x68abdce904bd68c53b0daf43c9b83a5aa8c0b2f7",
  "contractAddress": "0x0077777d7eba4688bdef3e311b846f25870a19b9",
  "abiFunctionSignature": "deposit(address,uint256)",
  "abiParameters": [
    "0x3600000000000000000000000000000000000000",
    "1"
  ],
  "state": "COMPLETE"
}
```

### 5. Gateway balance appeared under agent address

After the deposit transaction completed, Gateway balance for the agent address was available:

```json
{
  "gatewayAvailableAfterDeposit": "0.000001"
}
```

### 6. Agent wallet signed x402 through Circle W3S

The agent wallet signed the x402 EIP-712 authorization through Circle W3S `signTypedData`. The private key was not exported to Prooflet.

### 7. Gateway debited agent balance

Gateway settled the x402 access fee using the agent wallet's Gateway balance. After settlement, the agent Gateway balance was depleted:

```json
{
  "rail": "circle_gateway_x402",
  "amount": "0.000001",
  "payerAddress": "0x68abdce904bd68c53b0daf43c9b83a5aa8c0b2f7",
  "gatewayTransactionId": "5c2dc962-b56c-441c-adb2-e513573bd16f",
  "status": "paid",
  "gatewayAvailableAfterPay": "0"
}
```

### 8. Paid access recorded

Prooflet recorded durable paid access:

```json
{
  "paid": true,
  "status": "paid"
}
```

### 9. Claim succeeded

After paid access was recorded, the agent claimed the gated job:

```json
{
  "status": 200,
  "claimedBy": "self_agent_r6pli0z"
}
```

## Current claim boundary

Prooflet supports Circle Gateway x402 job-access payments from Circle-created developer-controlled EOA agent wallets.

Verified with Circle developer-controlled EOA wallets. SCA compatibility is not claimed.

The server binds Gateway payment payer to the registered agent payout address before recording paid access. A different wallet paying for an agent does not create paid access for that agent.
