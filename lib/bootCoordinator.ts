export enum BootLane {
  P0_IMMEDIATE = 0,
  P1_VISIBLE = 1,
  P2_WARM = 2,
  P3_BACKGROUND = 3
}

type BootTask = () => void;

class BootCoordinator {
  private queues: Record<BootLane, BootTask[]> = {
    [BootLane.P0_IMMEDIATE]: [],
    [BootLane.P1_VISIBLE]: [],
    [BootLane.P2_WARM]: [],
    [BootLane.P3_BACKGROUND]: []
  };

  private executed: Record<BootLane, boolean> = {
    [BootLane.P0_IMMEDIATE]: false,
    [BootLane.P1_VISIBLE]: false,
    [BootLane.P2_WARM]: false,
    [BootLane.P3_BACKGROUND]: false
  };

  private listeners: Set<(lane: BootLane) => void> = new Set();

  public schedule(lane: BootLane, fn: BootTask): void {
    if (this.executed[lane]) {
      // If the lane has already executed, run it in the next microtask/idle cycle
      if (lane === BootLane.P0_IMMEDIATE) {
        fn();
      } else if (lane === BootLane.P1_VISIBLE) {
        setTimeout(fn, 0);
      } else if (lane === BootLane.P2_WARM) {
        this.runOnIdle(fn, 2000);
      } else {
        this.runOnIdle(fn, 8000);
      }
      return;
    }

    this.queues[lane].push(fn);
  }

  public executeLane(lane: BootLane): void {
    if (this.executed[lane]) return;
    
    // Execute all registered tasks for this lane
    const tasks = this.queues[lane];
    this.queues[lane] = [];
    this.executed[lane] = true;

    tasks.forEach(task => {
      try {
        task();
      } catch (err) {
        console.error(`[BootCoordinator] Error running task in lane ${BootLane[lane]}:`, err);
      }
    });

    this.listeners.forEach(l => l(lane));

    // Automatically trigger next sequential lanes if they are scheduled
    if (lane === BootLane.P0_IMMEDIATE) {
      // P1 executes typically on mount, but P0 -> P1 sequence can be triggered
    } else if (lane === BootLane.P1_VISIBLE) {
      // Trigger P2 automatically after visible lane is done
      this.runOnIdle(() => this.executeLane(BootLane.P2_WARM), 2000);
    } else if (lane === BootLane.P2_WARM) {
      // Trigger P3 automatically after warm lane is done
      this.runOnIdle(() => this.executeLane(BootLane.P3_BACKGROUND), 6000);
    }
  }

  public isComplete(lane: BootLane): boolean {
    return this.executed[lane];
  }

  public subscribe(listener: (lane: BootLane) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private runOnIdle(fn: () => void, timeout: number): void {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(fn, { timeout });
    } else {
      setTimeout(fn, timeout);
    }
  }
}

export const bootCoordinator = new BootCoordinator();
export const useBootCoordinator = () => {
  return {
    schedule: (lane: BootLane, fn: BootTask) => bootCoordinator.schedule(lane, fn),
    executeLane: (lane: BootLane) => bootCoordinator.executeLane(lane),
    isComplete: (lane: BootLane) => bootCoordinator.isComplete(lane),
    subscribe: (listener: (lane: BootLane) => void) => bootCoordinator.subscribe(listener)
  };
};
