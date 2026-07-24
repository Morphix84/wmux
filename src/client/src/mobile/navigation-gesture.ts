export interface MobileNavigationGestureMove {
  handled: boolean;
  open: boolean;
}

export interface MobileNavigationGesture {
  start: (pointerId: number, x: number, y: number, viewportLeft?: number) => boolean;
  move: (pointerId: number, x: number, y: number) => MobileNavigationGestureMove;
  end: (pointerId: number) => boolean;
  cancel: (pointerId?: number) => void;
}

const defaultEdgeWidth = 32;
const defaultOpenDistance = 44;
const directionThreshold = 10;
const horizontalDominance = 1.25;

export const createMobileNavigationGesture = (
  edgeWidth = defaultEdgeWidth,
  openDistance = defaultOpenDistance,
): MobileNavigationGesture => {
  let activePointer: number | undefined;
  let startX = 0;
  let startY = 0;
  let claimed = false;

  const cancel = (pointerId?: number) => {
    if (pointerId !== undefined && pointerId !== activePointer) return;
    activePointer = undefined;
    claimed = false;
  };

  return {
    start: (pointerId, x, y, viewportLeft = 0) => {
      cancel();
      if (![pointerId, x, y, viewportLeft].every(Number.isFinite)) return false;
      if (x < viewportLeft || x - viewportLeft > edgeWidth) return false;
      activePointer = pointerId;
      startX = x;
      startY = y;
      return true;
    },
    move: (pointerId, x, y) => {
      if (pointerId !== activePointer || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { handled: false, open: false };
      }
      if (claimed) return { handled: true, open: false };
      const horizontalDistance = x - startX;
      const verticalDistance = Math.abs(y - startY);
      if (
        verticalDistance >= directionThreshold &&
        verticalDistance > Math.abs(horizontalDistance)
      ) {
        cancel(pointerId);
        return { handled: false, open: false };
      }
      if (
        horizontalDistance < openDistance ||
        horizontalDistance < verticalDistance * horizontalDominance
      ) {
        return { handled: false, open: false };
      }
      claimed = true;
      return { handled: true, open: true };
    },
    end: (pointerId) => {
      if (pointerId !== activePointer) return false;
      const handled = claimed;
      cancel(pointerId);
      return handled;
    },
    cancel,
  };
};
