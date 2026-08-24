import { EventEmitter } from "events";
import { AgentActivityEvent, EvidenceItem, SessionStatus } from "../domain/contracts.js";

export interface StreamListener {
  onActivityEvent: (event: AgentActivityEvent) => void;
  onEvidenceItem?: (evidence: EvidenceItem) => void;
  onStateChange?: (status: SessionStatus) => void;
  onClose?: () => void;
}

const MAX_CACHED_EVENTS_PER_SESSION = 500;
const MAX_CACHED_EVIDENCE_PER_SESSION = 100;
const TERMINAL_SESSION_CLEANUP_MS = 60000; // 60s grace period for reconnect before clearing in-memory buffer

export class SessionEventBroadcaster {
  private static instance: SessionEventBroadcaster;
  private readonly emitter = new EventEmitter();
  private readonly eventHistory = new Map<string, AgentActivityEvent[]>();
  private readonly evidenceHistory = new Map<string, EvidenceItem[]>();
  private readonly activeListeners = new Map<string, Set<StreamListener>>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();

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
    const history = this.eventHistory.get(sessionId)!;
    if (history.length >= MAX_CACHED_EVENTS_PER_SESSION) {
      history.shift();
    }
    history.push(event);

    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener.onActivityEvent(event);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[EventBroadcaster Error]: Exception in activity listener for session '${sessionId}': ${msg}`);
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
    const history = this.evidenceHistory.get(sessionId)!;
    if (history.length >= MAX_CACHED_EVIDENCE_PER_SESSION) {
      history.shift();
    }
    history.push(evidence);

    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        if (listener.onEvidenceItem) {
          try {
            listener.onEvidenceItem(evidence);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[EventBroadcaster Error]: Exception in evidence listener for session '${sessionId}': ${msg}`);
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
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[EventBroadcaster Error]: Exception in state listener for session '${sessionId}': ${msg}`);
          }
        }
      }
    }
    this.emitter.emit(`state:${sessionId}`, status);
  }

  /**
   * Close a session's event stream and schedule cleanup of in-memory replay buffers
   */
  public closeSessionStream(sessionId: string): void {
    const listeners = this.activeListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        if (listener.onClose) {
          try {
            listener.onClose();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[EventBroadcaster Error]: Exception in close listener for session '${sessionId}': ${msg}`);
          }
        }
      }
      this.activeListeners.delete(sessionId);
    }
    this.emitter.emit(`close:${sessionId}`);

    // Schedule cleanup of memory caches after grace period for reconnecting clients
    if (!this.cleanupTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        this.clearSession(sessionId);
        this.cleanupTimers.delete(sessionId);
      }, TERMINAL_SESSION_CLEANUP_MS);
      if (timer.unref) {
        timer.unref();
      }
      this.cleanupTimers.set(sessionId, timer);
    }
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EventBroadcaster Error]: Exception replaying activity event for session '${sessionId}': ${msg}`);
      }
    }

    // Replay existing buffered evidence items
    const evidenceList = this.evidenceHistory.get(sessionId) || [];
    for (const evi of evidenceList) {
      if (listener.onEvidenceItem) {
        try {
          listener.onEvidenceItem(evi);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[EventBroadcaster Error]: Exception replaying evidence item for session '${sessionId}': ${msg}`);
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
    const timer = this.cleanupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(sessionId);
    }
    this.eventHistory.delete(sessionId);
    this.evidenceHistory.delete(sessionId);
    this.activeListeners.delete(sessionId);
  }
}
