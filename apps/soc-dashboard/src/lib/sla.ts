import type { ResponseWindow, SocNotification } from '../types/domain';

/**
 * Display helpers for the backend's 5-minute response window
 * (backend ResponseSlaService). The frontend holds NO response-window
 * constants and never computes a deadline or containment eligibility — it
 * only renders `ResponseWindow`. The one thing done here is advancing the
 * backend's own `remainingMs` by the time elapsed since it was received, so
 * a countdown can tick between fetches without consulting the browser's
 * wall clock (which may be skewed from the server's).
 */

export function remainingResponseMs(window: ResponseWindow, clientNow: number = Date.now()): number | null {
  if (window.remainingMs === null) return null;
  return window.remainingMs - (clientNow - window.receivedAt);
}

/** The countdown only renders while the backend says a response is awaited. */
export function isResponseCountdownRunning(window: ResponseWindow): boolean {
  return window.state === 'waiting-response';
}

/** Same skew-free technique for a notification's deadline. */
export function remainingNotificationMs(notification: SocNotification, clientNow: number = Date.now()): number {
  const remainingAtServer =
    new Date(notification.incident.responseDeadline).getTime() - new Date(notification.serverNow).getTime();
  return remainingAtServer - (clientNow - notification.receivedAt);
}
