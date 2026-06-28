import { UsefulWaitingClient } from "@useful-waiting/sdk-core";
export { UsefulWaitingApiError, PendingAdjudicationError, GenLayerNotConfiguredError, GenLayerRequestFailedError } from "@useful-waiting/sdk-core";

export class AgentClient extends UsefulWaitingClient {
  constructor({ agentId, ...options }) { super(options); if (!agentId) throw new Error("agentId is required."); this.agentId = agentId; }
  getAgent() { return this.request(`/agents/${encodeURIComponent(this.agentId)}`).then(({ body }) => body.agent); }
  getReputation() { return this.request(`/agents/${encodeURIComponent(this.agentId)}/reputation`).then(({ body }) => body.reputation); }
  getAdjudicationStatus(proofId) { return this.request(`/proofs/${encodeURIComponent(proofId)}/adjudication`).then(({ body }) => body.adjudication); }
  async claimJob({ jobId, leaseSeconds = 60 } = {}) { const response = await this.request(`/agents/${encodeURIComponent(this.agentId)}/claim-job`, { method: "POST", body: { ...(jobId ? { jobId } : {}), leaseSeconds }, allowedStatuses: [404] }); return response.status === 404 ? null : response.body.job; }
  async submitProof(jobId, proof) { const { body } = await this.request(`/jobs/${encodeURIComponent(jobId)}/proof`, { method: "POST", body: proof, allowedStatuses: [422] }); return body.proof; }
  async poll({ intervalMs = 5000, leaseSeconds = 60, signal, onJob } = {}) { while (!signal?.aborted) { const job = await this.claimJob({ leaseSeconds }); if (job) await onJob(job, this); else await new Promise((resolve) => setTimeout(resolve, intervalMs)); } }
}
