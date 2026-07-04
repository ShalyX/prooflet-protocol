import assert from "node:assert/strict";
import { AgentClient, UsefulWaitingApiError } from "@useful-waiting/agent-sdk";
import { IssuerClient } from "@useful-waiting/issuer-sdk";
import { startTestApi, api, grantJobAccess } from "./test-helpers.mjs";

const test=await startTestApi("sdk-check");
try {
  const registration=await api(test.baseUrl,"POST","/agents/register",{agentId:"sdk_agent",name:"SDK Agent",capabilities:["link_verification"],payoutAddress:"0x0000000000000000000000000000000000000042"});
  const agent=new AgentClient({baseUrl:test.baseUrl,agentId:"sdk_agent",apiKey:registration.body.apiKey});
  const issuer=new IssuerClient({baseUrl:test.baseUrl,issuerId:"useful_waiting_protocol",apiKey:"uwp_issuer_useful_waiting_protocol_dev"});
  assert.equal((await agent.health()).ok,true); assert.equal((await agent.getAgent()).agentId,"sdk_agent");
  const job=await issuer.createJob({jobId:"sdk_job",jobType:"link_verification",input:{url:"https://example.com"},rewardAmount:"0.003",proofRequirements:{requiredResultFields:["status","responseTimeMs","contentHash"]}});
  grantJobAccess(test.db, job.jobId, "sdk_agent");
  await agent.claimJob({jobId:job.jobId});
  const proof={proofId:"sdk_proof",agentId:"sdk_agent",jobId:job.jobId,jobType:job.jobType,input:job.input,result:{status:200,responseTimeMs:10,contentHash:"0x5d4b"},verificationRoute:"link_verification_v0",proofTimestamp:new Date().toISOString()};
  assert.equal((await agent.submitProof(job.jobId,proof)).fundingStatus,"payable");
  let duplicateTyped=false; try { await agent.submitProof(job.jobId,proof); } catch(error) { duplicateTyped=error instanceof UsefulWaitingApiError && error.status===409; }
  assert.equal(duplicateTyped,true);
  console.log(JSON.stringify({ok:true,agentSdk:true,issuerSdk:true,typedErrors:true},null,2));
} finally { await test.close(); }
