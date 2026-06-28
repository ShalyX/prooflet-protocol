import { UsefulWaitingClient } from "@useful-waiting/sdk-core";
export { UsefulWaitingApiError, PendingAdjudicationError, GenLayerNotConfiguredError, GenLayerRequestFailedError } from "@useful-waiting/sdk-core";
export class IssuerClient extends UsefulWaitingClient {
  constructor({ issuerId, ...options }) { super(options); if (!issuerId) throw new Error("issuerId is required."); this.issuerId = issuerId; }
  createJob(job) {
    const payload = { ...job, issuerId: this.issuerId };
    return this.request("/jobs", { method: "POST", body: payload }).then(({ body }) => body.job);
  }
  validateUpload(upload) { return this.request(`/issuers/${encodeURIComponent(this.issuerId)}/uploads/validate`, { method: "POST", body: upload }).then(({ body }) => body.upload); }
  confirmUpload(uploadId, confirmation = {}) { return this.request(`/issuers/${encodeURIComponent(this.issuerId)}/uploads/${encodeURIComponent(uploadId)}/confirm`, { method: "POST", body: confirmation }).then(({ body }) => body.upload); }
  overview() { return this.#get("overview"); } listJobs() { return this.#get("jobs"); } listProofs() { return this.#get("proofs"); } listSettlements() { return this.#get("settlements"); }
  getProofAdjudication(proofId) { return this.request(`/proofs/${encodeURIComponent(proofId)}/adjudication`).then(({ body }) => body.adjudication); }
  #get(view) { return this.request(`/issuers/${encodeURIComponent(this.issuerId)}/${view}`).then(({ body }) => body); }
}
