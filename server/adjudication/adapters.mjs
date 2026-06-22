export class AdjudicationAdapter {
  constructor(name) { this.name = name; }
  submit() { throw new Error("submit() must be implemented by an adjudication adapter."); }
  getDecision() { throw new Error("getDecision() must be implemented by an adjudication adapter."); }
}

export class ManualAdapter extends AdjudicationAdapter {
  constructor() { super("manual_adapter"); }
  submit({ proofId, timestamp = new Date().toISOString() }) {
    return { requestId: `manual:${proofId}`, verifier: this.name, status: "pending", timestamp };
  }
  getDecision(decision) {
    return { verifier: this.name, decision: decision.decision, reason: decision.reason, confidence: decision.confidence, adjudicatorId: decision.adjudicatorId, timestamp: decision.timestamp };
  }
}

export class GenLayerAdapter extends AdjudicationAdapter {
  constructor() { super("genlayer"); }
  submit() { throw new Error("GenLayer adjudication is disabled until GENLAYER_ENABLED=true and an adapter is configured."); }
  getDecision() { throw new Error("GenLayer adjudication is disabled."); }
}
