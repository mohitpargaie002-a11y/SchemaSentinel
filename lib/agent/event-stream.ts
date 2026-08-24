import { EventEmitter } from "events";
import { AgentActivityEvent, EvidenceItem, SessionStatus } from "../domain/contracts.js";

export interface StreamListener {
  onActivityEvent: (event: AgentActivityEvent) => void;
  onEvidenceItem?: (evidence: EvidenceItem) => void;
  onStateChange?: (status: SessionStatus) => void;
  onClose?: () => void;
}

export class SessionEventBroadcaster {
  private static instance: SessionEventBroadcaster;
  private readonly emitter = new EventEmitter();
  private readonly eventHistory = new Map<string, AgentActivityEvent[]>();
  private readonly evidenceHistory = new Map<string, EvidenceItem[]>();
  private readonly activeListeners = new Map<string, Set<StreamListener>>();

  private constructor() {
    this.emitter.setMaxListeners(200);
  }

  public static getInstance(): SessionEventBroadcaster {
    if (!SessionEventBroadcaster.instance) {
      SessionEventBroadcaster.instance = new SessionEventBroadcaster();
    }
    return SessionEventBroadcaster.instance;
  }

  /**
   * Broadcast an activity event to all active stream listeners for a session
   */
  public emitActivity(sessionId: string, event: AgentActivityEvent): void {
    if (!this.eventHistory.has(sessionId)) {
      this.eventHistory.set(sessionId, []);
    }
    this.eventHistory.get(sessionId)!.push(event);

    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener.onActivityEvent(event);
        } catch {
          // Ignore listener errors
        }
      }
    }
    this.emitter.emit(`activity:${sessionId}`, event);
  }

  /**
   * Broadcast an evidence item to stream listeners
   */
  public emitEvidence(sessionId: string, evidence: EvidenceItem): void {
    if (!this.evidenceHistory.has(sessionId)) {
      this.evidenceHistory.set(sessionId, []);
    }
    this.evidenceHistory.get(sessionId)!.push(evidence);

    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        if (listener.onEvidenceItem) {
          try {
            listener.onEvidenceItem(evidence);
          } catch {
            // Ignore listener errors
          }
        }
      }
    }
    this.emitter.emit(`evidence:${sessionId}`, evidence);
  }

  /**
   * Broadcast a session state transition
   */
  public emitStateChange(sessionId: string, status: SessionStatus): void {
    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        if (listener.onStateChange) {
          try {
            listener.onStateChange(status);
          } catch {
            // Ignore listener errors
          }
        }
      }
    }
    this.emitter.emit(`state:${sessionId}`, status);
  }

  /**
   * Close a session's event stream
   */
  public closeSessionStream(sessionId: string): void {
    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        if (listener.onClose) {
          try {
            listener.onClose();
          } catch {
            // Ignore listener errors
          }
        }
      }
      this.activeListeners.delete(sessionId);
    }
    this.emitter.emit(`close:${sessionId}`);
  }

  /**
   * Subscribe a listener to live SSE events for a session, replaying prior buffered events
   */
  public subscribe(sessionId: string, listener: StreamListener): () => void {
    if (!this.activeListeners.has(sessionId)) {
      this.activeListeners.set(sessionId, new Set());
    }
    this.activeListeners.get(sessionId)!.add(listener);

    // Replay existing buffered activity events
    const history = this.eventHistory.get(sessionId) || [];
    for (const evt of history) {
      try {
        listener.onActivityEvent(evt);
      } catch {
        // Ignore listener error
      }
    }

    // Replay existing buffered evidence items
    const evidenceList = this.evidenceHistory.get(sessionId) || [];
    for (const evi of evidenceList) {
      if (listener.onEvidenceItem) {
        try {
          listener.onEvidenceItem(evi);
        } catch {
          // Ignore listener error
        }
      }
    }

    return () => {
      const set = this.activeListeners.get(sessionId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.activeListeners.delete(sessionId);
        }
      }
    };
  }

  /**
   * Retrieve cached events for a session
   */
  public getEvents(sessionId: string): AgentActivityEvent[] {
    return this.eventHistory.get(sessionId) || [];
  }

  /**
   * Retrieve cached evidence items for a session
   */
  public getEvidence(sessionId: string): EvidenceItem[] {
    return this.evidenceHistory.get(sessionId) || [];
  }

  /**
   * Clear session history from memory
   */
  public clearSession(sessionId: string): void {
    this.eventHistory.delete(sessionId);
    this.evidenceHistory.delete(sessionId);
    this.activeListeners.delete(sessionId);
  }
}
