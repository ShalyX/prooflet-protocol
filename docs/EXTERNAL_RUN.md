# External Tester Run

Use this when someone outside the builder's machine runs Prooflet against the hosted API.

Hosted API: `https://prooflet-api.onrender.com`

## What This Proves

- A third-party agent can connect to the public Prooflet API.
- The agent can register with its own payout wallet.
- The agent can claim hosted link-verification work.
- Link Sentinel performs a real HTTP check and submits proof.
- The hosted API verifies the proof and makes it payable.
- Settlement can be previewed with dry-run/export before any Arc Testnet USDC is sent.

## Tester Setup

Clone and install:

```bash
git clone https://github.com/ShalyX/prooflet-protocol.git
cd prooflet-protocol
npm install
```

Set the hosted API:

```bash
export USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
```

PowerShell:

```powershell
$env:USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
```

## Register Your Agent

Replace `agent_friend_handle` and the payout address with your own values. Use an Arc Testnet-compatible EVM address.

```bash
curl -s -X POST "$USEFUL_WAITING_API_URL/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent_friend_handle","name":"Friend Link Sentinel","capabilities":["link_verification"],"payoutAddress":"0x0000000000000000000000000000000000000012","status":"idle"}'
```

PowerShell:

```powershell
$body = @{
  agentId = "agent_friend_handle"
  name = "Friend Link Sentinel"
  capabilities = @("link_verification")
  payoutAddress = "0x0000000000000000000000000000000000000012"
  status = "idle"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$env:USEFUL_WAITING_API_URL/agents/register" -ContentType "application/json" -Body $body
```

Save the returned `apiKey`.

## Run Link Sentinel Once

Bash:

```bash
export AGENT_ID="agent_friend_handle"
export AGENT_API_KEY="PASTE_RETURNED_AGENT_API_KEY"
npm run agent:link -- --once
```

PowerShell:

```powershell
$env:AGENT_ID="agent_friend_handle"
$env:AGENT_API_KEY="PASTE_RETURNED_AGENT_API_KEY"
npm run agent:link -- --once
```

Expected output includes:

- `api healthy`
- `agent ready`
- `claimed job`
- `task result`
- `proof created`
- `verification result`
- `fundingStatus: payable`
- `settlementStatus: Awaiting Arc Testnet settlement`

## Send Back Evidence

Send the builder:

- Agent ID
- Payout wallet address
- Job ID
- Proof ID
- Terminal screenshot or copied output
- Whether the flow was understandable

## Optional Settlement

The hosted API does not execute settlement and has no treasury private key. If the builder chooses to pay the proof, they will run the Arc Testnet settlement runner locally with explicit execute confirmation and add the tx hash to the submission docs.
