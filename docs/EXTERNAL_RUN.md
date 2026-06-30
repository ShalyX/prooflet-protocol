# External Tester Run

Use this when someone outside the builder's machine runs Prooflet against the hosted API.

Hosted API: `https://prooflet-api.onrender.com`

## What This Proves

- A third-party agent can connect to the public Prooflet API.
- The agent can register with its own payout wallet.
- The agent can claim hosted link-verification work when a funded/open job is available.
- Link Sentinel performs a real HTTP check and submits proof.
- The hosted API verifies the proof and makes it payable.
- Optional access-fee endpoints expose the `0.000001 USDC` nanopayment-style claim-friction path.
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

Windows Command Prompt:

```bat
set USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com
npm run agent:register -- --agent-id agent_friend_handle --name "Friend Link Sentinel" --payout-address 0x0000000000000000000000000000000000000012
```

PowerShell:

```powershell
$env:USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com"
npm run agent:register -- --agent-id agent_friend_handle --name "Friend Link Sentinel" --payout-address 0x0000000000000000000000000000000000000012
```

Save the returned `apiKey`. On Windows Command Prompt, either use the one-line `windowsCmd` printed by `agent:register`, or run each `set` command on its own line.

## Run Link Sentinel Once

Recommended one-line run:

```bat
npm run agent:link -- --once --api-url https://prooflet-api.onrender.com --agent-id agent_friend_handle --agent-api-key PASTE_RETURNED_AGENT_API_KEY
```

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

Windows Command Prompt:

```bat
set AGENT_ID=agent_friend_handle
set AGENT_API_KEY=PASTE_RETURNED_AGENT_API_KEY
npm run agent:link -- --once
```

Do not combine the two `set` commands into one line. `set AGENT_ID=agent_friend_handle set AGENT_API_KEY=...` creates a malformed `AGENT_ID` value and leaves `AGENT_API_KEY` unset.

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

## Optional Access-Fee Check

The current access-fee implementation is nanopayment-style Arc Testnet USDC verification. It is not required for every hosted tester run, but the live API exposes the flow:

```bash
curl -s "https://prooflet-api.onrender.com/nanopayment/config"
curl -s "https://prooflet-api.onrender.com/jobs/JOB_ID/access-fee?agentAddress=0xYOUR_AGENT_ADDRESS"
```

If the agent sends `0.000001 USDC` to the Prooflet service/operator address, the backend can verify with:

```bash
curl -s -X POST "https://prooflet-api.onrender.com/jobs/JOB_ID/access-fee/verify" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent_friend_handle","agentAddress":"0xYOUR_AGENT_ADDRESS"}'
```

## Optional Settlement

The hosted API does not execute settlement and has no treasury/operator private key. If the builder chooses to pay the proof, they will run the remote settlement runner locally with explicit execute confirmation:

1. Hosted API exports accepted, payable, unpaid proof IDs.
2. Local operator runner signs and sends Arc Testnet USDC.
3. Local runner posts the transaction receipt back to the hosted API.
4. Hosted API marks the proof `paid` / `Settled on Arc Testnet`.

Dry-run command shape:

```bash
USEFUL_WAITING_API_URL="https://prooflet-api.onrender.com" \
ISSUER_ID="useful_waiting_protocol" \
ISSUER_API_KEY="ISSUER_API_KEY_HERE" \
REMOTE_SETTLEMENT_PROOF_IDS="PROOF_ID_HERE" \
npm run settlement:remote:dry-run
```

Execute sends Arc Testnet USDC only and requires `TREASURY_PRIVATE_KEY` plus `CONFIRM_ARC_TESTNET_USDC_SEND=true`.
