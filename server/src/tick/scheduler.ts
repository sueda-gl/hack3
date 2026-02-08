/**
 * CLAWQUEST Tick Scheduler
 * 
 * Runs the game tick processor at regular intervals.
 * Default: every 2 hours (configurable in game_state table)
 */

import { processTick, shouldProcessTick, getTimeUntilNextTick, getNextTickAt } from './processor.js';

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// Check interval - how often to check if a tick should run (in ms)
// Using 1 minute for responsiveness
const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Start the tick scheduler
 */
export function startScheduler(): void {
  if (isRunning) {
    console.log('[Scheduler] Already running');
    return;
  }
  
  isRunning = true;
  console.log('[Scheduler] Starting tick scheduler...');
  
  // Check immediately on start
  checkAndProcessTick();
  
  // Set up periodic check
  schedulerInterval = setInterval(() => {
    checkAndProcessTick();
  }, CHECK_INTERVAL_MS);
  
  console.log('[Scheduler] Tick scheduler started. Checking every 1 minute.');
  console.log(`[Scheduler] Next tick at: ${getNextTickAt() || 'now'}`);
}

/**
 * Stop the tick scheduler
 */
export function stopScheduler(): void {
  if (!isRunning) {
    console.log('[Scheduler] Not running');
    return;
  }
  
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  
  isRunning = false;
  console.log('[Scheduler] Tick scheduler stopped');
}

/**
 * Check if a tick should run and process it
 */
function checkAndProcessTick(): void {
  try {
    if (shouldProcessTick()) {
      console.log('[Scheduler] Time for a tick!');
      processTick();
      console.log(`[Scheduler] Next tick at: ${getNextTickAt()}`);
    }
  } catch (error) {
    console.error('[Scheduler] Error processing tick:', error);
  }
}

/**
 * Manually trigger a tick (for testing/admin)
 */
export function triggerTickManually(): void {
  console.log('[Scheduler] Manually triggering tick...');
  processTick();
  console.log(`[Scheduler] Next tick at: ${getNextTickAt()}`);
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
  running: boolean;
  next_tick_at: string | null;
  time_until_next_tick_ms: number;
} {
  return {
    running: isRunning,
    next_tick_at: getNextTickAt(),
    time_until_next_tick_ms: getTimeUntilNextTick(),
  };
}
