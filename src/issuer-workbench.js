import { IssuerClient } from "@useful-waiting/issuer-sdk";

export function initIssuerWorkbench({ apiUrl, onNavigate }) {
  const panel=document.querySelector("#issuerWorkbench"), toggle=document.querySelector("#toggleWorkbench");
  const issuerInput=document.querySelector("#issuerIdInput"), keyInput=document.querySelector("#issuerKeyInput"), message=document.querySelector("#workbenchMessage");
  let client=null, preview=null, mode="demo";
  
  issuerInput.value=sessionStorage.getItem("uwp.issuerId")||issuerInput.value; keyInput.value=sessionStorage.getItem("uwp.issuerApiKey")||"";
  
  if(import.meta.env.DEV){const helper=document.createElement("button");helper.className="ghost dev-issuer-helper";helper.type="button";helper.textContent="Use local dev issuer";helper.addEventListener("click",()=>{issuerInput.value="useful_waiting_protocol";keyInput.value="uwp_issuer_useful_waiting_protocol_dev";message.textContent="Local development credentials loaded. Select Connect to start the issuer session.";message.dataset.state="ok";document.querySelector("#workbenchConnection").textContent="Credentials loaded";});document.querySelector("#issuerCol").append(helper);}
  
  document.querySelectorAll(".mode-tab").forEach(btn => btn.addEventListener("click", (e) => {
    document.querySelectorAll(".mode-tab").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    mode = e.target.dataset.mode;
    document.querySelector("#fundingModeLabel").textContent = mode === "external" ? "External Issuer" : "Prooflet Demo Issuer";
    
    // Reset panels
    document.querySelector("#demoIssuerPanel").hidden = true;
    document.querySelector("#returningIssuerPanel").hidden = true;
    document.querySelector("#registerIssuerPanel").hidden = true;
    document.querySelector("#registerSuccessPanel").hidden = true;

    if (mode === "external") {
      document.querySelector("#returningIssuerPanel").hidden = false;
      document.querySelector("#issuerFundingPanel").hidden = false;
      document.querySelector("#issuerIdInput").value = sessionStorage.getItem("uwp.extIssuerId")||"";
      document.querySelector("#issuerKeyInput").value = sessionStorage.getItem("uwp.extIssuerApiKey")||"";
      document.querySelector("#demoEvidencePanel").hidden = true;
    } else {
      document.querySelector("#demoIssuerPanel").hidden = false;
      document.querySelector("#issuerFundingPanel").hidden = true;
      document.querySelector("#issuerIdInput").value = sessionStorage.getItem("uwp.issuerId")||"useful_waiting_protocol";
      document.querySelector("#issuerKeyInput").value = sessionStorage.getItem("uwp.issuerApiKey")||"";
      document.querySelector("#demoEvidencePanel").hidden = false;
    }
    client = null;
    renderUnauthenticated();
  }));

  document.querySelector("#showRegisterBtn").addEventListener("click", () => {
    document.querySelector("#returningIssuerPanel").hidden = true;
    document.querySelector("#registerIssuerPanel").hidden = false;
  });
  
  document.querySelector("#showLoginBtn").addEventListener("click", () => {
    document.querySelector("#returningIssuerPanel").hidden = false;
    document.querySelector("#registerIssuerPanel").hidden = true;
  });

  document.querySelector("#registerIssuerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      setStatus("Registering new issuer...", true);
      const data = {
        name: document.querySelector("#regIssuerName").value.trim(),
        email: document.querySelector("#regIssuerEmail").value.trim() || undefined,
        description: document.querySelector("#regIssuerDesc").value.trim() || undefined
      };
      
      const res = await fetch(`${apiUrl}/issuers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Registration failed");

      const apiKey = result.apiKey;
      document.querySelector("#successIssuerId").textContent = result.issuer.issuerId;
      document.querySelector("#successApiKey").textContent = apiKey;
      
      if (result.wallet) {
        document.querySelector("#successWalletContainer").hidden = false;
        document.querySelector("#successWalletFailedContainer").hidden = true;
        document.querySelector("#successWalletId").textContent = result.wallet.walletId;
        document.querySelector("#successWalletAddress").textContent = result.wallet.address;
      } else {
        document.querySelector("#successWalletContainer").hidden = true;
        document.querySelector("#successWalletFailedContainer").hidden = false;
        const provError = result.walletProvisioning?.message || result.walletError || "Circle wallet provisioning unavailable";
        document.querySelector("#successWalletErrorReason").textContent = provError;
      }

      // Store credentials immediately
      sessionStorage.setItem("uwp.extIssuerId", result.issuer.issuerId);
      sessionStorage.setItem("uwp.extIssuerApiKey", apiKey);
      issuerInput.value = result.issuer.issuerId;
      keyInput.value = apiKey;

      document.querySelector("#registerIssuerPanel").hidden = true;
      document.querySelector("#registerSuccessPanel").hidden = false;
      
      // Do not say "Session active" yet to avoid UI inconsistency. Say "Registration successful." without changing auth status to true if not fully hydrated.
      // Actually, let's call connect() in the background so it hydrates while they read the success panel.
      client = new IssuerClient({baseUrl:apiUrl,issuerId:result.issuer.issuerId,apiKey:apiKey});
      
      // Pre-hydrate wallet to prevent NOT CREATED flash
      if (result.wallet) {
        renderWallet(result.wallet, null);
      } else {
        renderWallet(null, result.walletProvisioning?.message || result.walletError || "Circle wallet provisioning unavailable");
      }

      await refresh();
      await fetchWallet();
      setStatus("Registration successful. Please save your API key.", true);
      message.dataset.state = "ok";
      document.querySelector("#workbenchConnection").textContent = "Session active";
      
    } catch (error) {
      setStatus(error.message, false);
    }
  });

  document.querySelector("#continueWorkbenchBtn").addEventListener("click", () => {
    document.querySelector("#registerSuccessPanel").hidden = true;
    document.querySelector("#returningIssuerPanel").hidden = false;
    // It's already hydrated from the background connect!
    setStatus("Issuer session connected.", true);
  });

  document.querySelector("#copyCredsBtn").addEventListener("click", () => {
    const text = `Issuer ID: ${document.querySelector("#successIssuerId").textContent}\nIssuer API Key: ${document.querySelector("#successApiKey").textContent}`;
    navigator.clipboard.writeText(text);
    setStatus("Credentials copied to clipboard.", true);
  });

  document.querySelector("#downloadEnvBtn").addEventListener("click", () => {
    const text = `ISSUER_ID="${document.querySelector("#successIssuerId").textContent}"\nISSUER_API_KEY="${document.querySelector("#successApiKey").textContent}"\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ".env.issuer";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector("#copyWalletAddrBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(document.querySelector("#fundingWalletAddress").textContent);
    setStatus("Wallet address copied.", true);
  });

  toggle.addEventListener("click",()=>onNavigate(location.pathname==="/issuer"?"/dashboard":"/issuer"));
  document.querySelector("#connectIssuer").addEventListener("click",connect);
  document.querySelector("#clearIssuer").addEventListener("click",()=>{
    if (mode === "demo") { sessionStorage.removeItem("uwp.issuerId"); sessionStorage.removeItem("uwp.issuerApiKey"); }
    else { sessionStorage.removeItem("uwp.extIssuerId"); sessionStorage.removeItem("uwp.extIssuerApiKey"); }
    keyInput.value="";client=null;renderUnauthenticated();setStatus("Session cleared. Connect to manage funded jobs and payouts.",false);
  });
  document.querySelector("#singleJobForm").addEventListener("submit",createJob);
  document.querySelector("#uploadForm").addEventListener("submit",validateFile);
  document.querySelector("#retryIssuerWalletBtn").addEventListener("click", retryWallet);
  document.querySelector("#refreshWalletBtn").addEventListener("click", fetchWallet);
  
  document.querySelector("#connectDemoIssuer").addEventListener("click", () => {
    issuerInput.value = "useful_waiting_protocol";
    keyInput.value = "uwp_issuer_useful_waiting_protocol_dev";
    connect();
  });
  
  if(!keyInput.value)renderUnauthenticated();

  async function connect(){
    try {
      if (mode === "demo") { sessionStorage.setItem("uwp.issuerId",issuerInput.value.trim()); sessionStorage.setItem("uwp.issuerApiKey",keyInput.value); }
      else { sessionStorage.setItem("uwp.extIssuerId",issuerInput.value.trim()); sessionStorage.setItem("uwp.extIssuerApiKey",keyInput.value); }
      client=new IssuerClient({baseUrl:apiUrl,issuerId:issuerInput.value.trim(),apiKey:keyInput.value});
      await refresh();
      setStatus("Issuer session connected.",true);
      if (mode === "external") await fetchWallet();
    } catch(error) { client=null;renderUnauthenticated();setStatus(error.message,false); }
  }

  document.querySelector("#successRetryWalletBtn").addEventListener("click", async () => {
    try {
      const btn = document.querySelector("#successRetryWalletBtn");
      btn.disabled = true;
      btn.textContent = "Retrying...";
      const res = await fetch(`${apiUrl}/issuers/${encodeURIComponent(document.querySelector("#successIssuerId").textContent)}/wallet`, { method: "POST", headers: { "X-API-Key": document.querySelector("#successApiKey").textContent } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to provision wallet");
      if (data.wallet) {
        document.querySelector("#successWalletContainer").hidden = false;
        document.querySelector("#successWalletFailedContainer").hidden = true;
        document.querySelector("#successWalletId").textContent = data.wallet.walletId;
        document.querySelector("#successWalletAddress").textContent = data.wallet.address;
      } else {
        throw new Error(data.walletProvisioning?.message || "Circle wallet provisioning unavailable");
      }
    } catch (error) {
      document.querySelector("#successWalletErrorReason").textContent = error.message;
      document.querySelector("#successRetryWalletBtn").disabled = false;
      document.querySelector("#successRetryWalletBtn").textContent = "Retry wallet provisioning";
    }
  });

  async function fetchWallet() {
    try {
      document.querySelector("#fundingBalanceStatus").textContent = "Loading...";
      const res = await fetch(`${apiUrl}/issuers/${encodeURIComponent(client.issuerId)}/wallet`, { headers: { "X-API-Key": client.apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const errorMsg = data.walletProvisioning?.message || data.error;
      renderWallet(data.wallet, errorMsg);
    } catch (error) { setStatus(error.message, false); document.querySelector("#fundingBalanceStatus").textContent = "Config unavailable"; document.querySelector("#fundingBalanceStatus").className = "state-badge rejected"; }
  }

  async function retryWallet() {
    try {
      setStatus("Retrying wallet provisioning...", true);
      const res = await fetch(`${apiUrl}/issuers/${encodeURIComponent(client.issuerId)}/wallet`, { method: "POST", headers: { "X-API-Key": client.apiKey } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to provision wallet");
      if (!data.wallet) throw new Error(data.walletProvisioning?.message || "Failed to provision wallet");
      renderWallet(data.wallet, null);
      setStatus("Wallet provisioning successful.", true);
    } catch (error) { setStatus(error.message, false); }
  }

  function renderWallet(wallet, errorMsg) {
    if (!wallet) {
      document.querySelector("#fundingWalletStatus").textContent = errorMsg ? "Failed" : "Config unavailable";
      document.querySelector("#fundingWalletStatus").className = "state-badge rejected";
      document.querySelector("#fundingWalletDetails").hidden = true;
      document.querySelector("#retryIssuerWalletBtn").hidden = false;
      document.querySelector("#refreshWalletBtn").hidden = true;
      
      if (errorMsg) {
        document.querySelector("#fundingWalletStatus").textContent = "Failed";
        document.querySelector("#fundingWalletStatus").title = errorMsg;
      }
      
      const uploadBtn = document.querySelector("#uploadForm button[type=submit]");
      const jobBtn = document.querySelector("#singleJobForm button[type=submit]");
      if (mode === "external") {
        uploadBtn.disabled = true;
        jobBtn.disabled = true;
        uploadBtn.textContent = "Funding requires Circle issuer wallet configuration";
        jobBtn.textContent = "Funding requires Circle issuer wallet configuration";
      }
    } else {
      document.querySelector("#fundingWalletStatus").textContent = "Active";
      document.querySelector("#fundingWalletStatus").className = "state-badge escrow_funded";
      document.querySelector("#fundingWalletDetails").hidden = false;
      document.querySelector("#fundingWalletAddress").textContent = wallet.address || wallet.walletId;
      document.querySelector("#fundingWalletBalance").textContent = money(wallet.balance);
      
      const balSpan = document.querySelector("#fundingBalanceStatus");
      if (wallet.balance > 0) {
        balSpan.textContent = "Available";
        balSpan.className = "state-badge completed";
      } else {
        balSpan.textContent = "Insufficient balance";
        balSpan.className = "state-badge draft";
      }
      
      document.querySelector("#retryIssuerWalletBtn").hidden = true;
      document.querySelector("#refreshWalletBtn").hidden = false;
    }
  }

  async function fundJob(jobId) {
    try {
      setStatus(`Funding escrow for ${jobId}...`, true);
      const res = await fetch(`${apiUrl}/jobs/${encodeURIComponent(jobId)}/fund-escrow`, {
        method: "POST",
        headers: { "X-API-Key": client.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ issuerId: client.issuerId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus(`Escrow funding broadcast for ${jobId}.`, true);
      await refresh();
      await fetchWallet();
    } catch (error) { setStatus(error.message, false); }
  }

  window.fundJobAction = fundJob;



  async function refresh(){
    const [overview,jobs,proofs,settlements]=await Promise.all([client.overview(),client.listJobs(),client.listProofs(),client.listSettlements()]);
    renderOverview(overview);renderJobs(jobs.jobs);renderProofs(proofs.proofs);renderSettlements(settlements);
    
    const jobBtn = document.querySelector("#singleJobForm button[type=submit]");
    jobBtn.disabled = false;
    jobBtn.textContent = mode === "demo" ? "Create demo-funded job" : "Create draft job";
    const uploadBtn = document.querySelector("#uploadForm button[type=submit]");
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Validate Batch CSV / JSON";
    
    if (mode === "demo") {
      document.querySelector("#demoIssuerPanel").hidden = true;
    }
  }
  
  async function createJob(event){
    event.preventDefault();if(!client)return setStatus("Connect an issuer session first.",false);
    try{
      const data=new FormData(event.currentTarget);
      let input, proofReq;
      try{input=JSON.parse(data.get("input"));proofReq=JSON.parse(data.get("proofRequirements"))}catch{return setStatus("Invalid JSON in input or proofRequirements field.",false)}
      
      const payload = {
        jobId:data.get("jobId"),jobType:data.get("jobType"),rewardAmount:data.get("rewardAmount"),verificationMode:data.get("verificationMode"),
        input,proofRequirements:proofReq
      };
      
      if (mode === "external") {
        payload.fundingStatus = "awaiting_wallet_funding";
        payload.fundingRail = "arc_usdc_escrow";
      }
      
      const job=await client.createJob(payload);
      setStatus(`Created ${job.jobId} at ${job.rewardAmount} testnet USDC.`,true);
      await refresh();
    }catch(error){setStatus(error.message,false);}
  }
  
  async function validateFile(event){event.preventDefault();if(!client)return setStatus("Connect an issuer session first.",false);const file=document.querySelector("#uploadFile").files[0];if(!file)return;try{preview=await client.validateUpload({filename:file.name,format:file.name.toLowerCase().endsWith(".csv")?"csv":"json",content:await file.text()});renderPreview(preview);setStatus("Validation finished. No jobs have been created yet.",true);}catch(error){setStatus(error.message,false);}}
  function renderPreview(upload){const root=document.querySelector("#uploadPreview");root.innerHTML=`<div class="preview-total"><strong>${upload.totalRewardRequired} USDC</strong><span>${upload.validRows} valid / ${upload.invalidRows} invalid</span></div>${upload.rows.map((row)=>`<p class="${row.valid?"valid":"invalid"}">Row ${row.rowNumber}: ${escape(row.job?.jobId||"invalid row")} ${row.errors.length?`· ${escape(row.errors.join(" "))}`:"· ready"}</p>`).join("")}${upload.status === "confirmed" ? '<div class="preview-actions"><strong>✅ Upload Confirmed & Jobs Created</strong></div>' : `<div class="preview-actions"><button class="primary" data-confirm="strict">Create jobs (Requires 0 invalid)</button>${upload.invalidRows?'<button class="secondary" data-confirm="validOnly">Skip invalid & create good jobs</button>':""}</div>`}`;root.querySelectorAll("[data-confirm]").forEach((button)=>button.addEventListener("click",async()=>{try{const confirmMode=button.dataset.confirm;const result=await client.confirmUpload(upload.uploadId,{mode:confirmMode,acknowledgeInvalidRows:confirmMode==="validOnly"});setStatus(`Created ${result.createdJobIds.length} jobs.`,true);renderPreview(result);await refresh();}catch(error){setStatus(error.message,false);}}));}
  function renderOverview(value){
    if (value.jobs === 0 && value.proofs === 0) {
      document.querySelector("#issuerOverview").innerHTML=empty(mode === "external" ? "External issuer connected" : "Demo issuer connected", "Create your first job or bulk upload to see metrics.");
      return;
    }
    document.querySelector("#issuerOverview").innerHTML=[["Jobs",value.jobs],["Proofs",value.proofs],["Reserved",`${money(value.reservedRewards)} USDC`],["Payable",`${money(value.payableRewards)} USDC`],["Paid proofs",value.paidProofs],["Pending review",value.pendingAdjudication]].map(([label,val])=>`<div><span>${label}</span><strong>${val}</strong></div>`).join("");
  }
  
  function renderJobs(rows){
    document.querySelector("#issuerJobs").innerHTML=rows.length?table(["Job","Type","Reward","Status","Funding","Claimed by","Access"],rows.map((row)=>{
      let fundingCol = pill(fundingState(row.fundingStatus));
      if (row.fundingStatus === "awaiting_wallet_funding" || (mode === "external" && row.fundingStatus === "awaiting_escrow_funding")) {
        fundingCol = `${pill("Awaiting wallet funding")} <br><button class="secondary" disabled style="margin-top:6px; font-size:0.7rem; padding:4px 8px;">Requires ProofletEscrowV2</button> <br><span class="issuer-helper" style="display:inline-block; margin-top:4px; max-width: 140px; color: var(--amber);">Open marketplace escrow funding requires ProofletEscrowV2.</span>`;
      }
      return [
        row.jobId,
        row.jobType,
        `${row.rewardAmount} USDC`,
        jobState(row),
        fundingCol,
        row.claimedBy||"—",
        row.requiredAccessLevel
      ];
    }),true):empty("No funded jobs yet","Create a single job or validate a bulk upload to begin.");
  }
  
  function renderProofs(rows){document.querySelector("#issuerProofs").innerHTML=rows.length?table(["Proof","Agent","Route","Verification","Adjudication","Funding","Settlement","Transaction"],rows.map((row)=>[truncateId(row.proofId),truncateId(row.agentId),row.verificationRoute,pill(row.verificationStatus),adjudicationState(row),pill(fundingState(row.fundingStatus)),settlementState(row),row.txHash?`<a href="${escape(row.explorer)}" target="_blank" rel="noreferrer">Arcscan</a>`:"—"]),true):empty("No proofs submitted","Verified agent work will appear here with its payout state.");}
  function renderSettlements(value){document.querySelector("#issuerSettlements").innerHTML=table(["Batch","Status","Payout","Created","Settled"],value.batches.map((row)=>[row.batch_id,row.status,`${row.total_payout} USDC`,date(row.created_at),row.settled_at?date(row.settled_at):"—"]));}
  function setStatus(text,ok){message.textContent=text;message.dataset.state=ok?"ok":"error";document.querySelector("#workbenchConnection").textContent=ok?"Session active":"Not authenticated";}
  function renderUnauthenticated() {
    document.querySelector("#issuerOverview").innerHTML=empty("Connect an issuer session","Create funded jobs, validate uploads, review proofs, and follow Arc Testnet payouts.");
    document.querySelector("#issuerJobs").innerHTML=empty("Issuer access required","Connect to inspect and manage funded jobs.");
    document.querySelector("#issuerProofs").innerHTML=empty("Issuer access required","Connect to review proof and payout states.");
    document.querySelector("#issuerSettlements").innerHTML=empty("Issuer access required","Connect to follow settlement batches and Arcscan receipts.");
    
    const jobBtn = document.querySelector("#singleJobForm button[type=submit]");
    jobBtn.disabled = true;
    jobBtn.textContent = "Connect issuer to create jobs";
    const uploadBtn = document.querySelector("#uploadForm button[type=submit]");
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Connect issuer to validate batch";
  }
  return {show(){panel.hidden=false;if(keyInput.value)connect();},hide(){panel.hidden=true;}};
}
function table(headers,rows,allowHtml=false){return `<table><thead><tr>${headers.map((value)=>`<th>${escape(value)}</th>`).join("")}</tr></thead><tbody>${rows.map((row)=>`<tr>${row.map((value)=>`<td>${allowHtml?value:escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;}
function escape(value){return String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);}
function truncateId(id){if(!id)return "—";return `<span title="${escape(id)}" class="truncated-id">${escape(id).substring(0,8)}...</span>`;}
function pill(status){const cssClass = String(status).toLowerCase().split(" ")[0]; return `<span class="state-badge ${escape(cssClass)}">${escape(status)}</span>`;}
function money(value){return Number(value||0).toFixed(3);} function date(value){return new Date(value).toLocaleString();}
function empty(title,copy){return `<div class="workbench-empty"><strong>${escape(title)}</strong><p>${escape(copy)}</p></div>`;}
function fundingState(value){return ({reserved:"Reserved",payable:"Payable",paid:"Paid",rejected:"Rejected",pending_adjudication:"Pending review",settlement_failed:"Settlement review",escrow_funded:"Escrow funded",escrow_deposited:"Escrow deposited",awaiting_wallet_funding:"Awaiting wallet funding",awaiting_escrow_funding:"Awaiting verification"})[value]||value;}
function jobState(row){return ({open:"Open",claimed:"Claimed",completed:"Completed",rejected:"Rejected",pending_adjudication:"Pending review"})[row.status]||row.status;}
function settlementState(row){if(row.fundingStatus==="paid")return "Paid · Settled on Arc";if(row.fundingStatus==="payable")return "Payable · Approved";if(row.fundingStatus==="rejected")return "Rejected · No payout";return escape(row.settlementStatus);}
function adjudicationState(row){if(row.adjudicationRoute==="deterministic")return "Deterministic";if(row.adjudicationRoute==="manual_adapter")return "Manual Adapter";const decision=row.genlayer?.decision;const status=row.genlayer?.status||"pending";return `${pill(status)}${decision?`<div class="reason-cell">${escape(decision.decision)}: ${escape(decision.reason)}</div>`:""}`;}
