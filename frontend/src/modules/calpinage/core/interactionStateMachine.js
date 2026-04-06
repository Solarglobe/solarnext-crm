export const InteractionStates = {
  IDLE: "IDLE",
  CREATING: "CREATING",
  SELECTED: "SELECTED",
  DRAGGING: "DRAGGING",
  ROTATING: "ROTATING",
  RESIZING: "RESIZING",
  EDITING_HEIGHT: "EDITING_HEIGHT",
};

const DEFAULT_STATE = InteractionStates.IDLE;
let CURRENT_STATE = DEFAULT_STATE;

export function getInteractionState() {
  return CURRENT_STATE;
}

export function setInteractionState(nextState) {
  const current = CURRENT_STATE;

  // Prevent impossible transitions
  if (current === InteractionStates.CREATING && nextState === InteractionStates.DRAGGING) {
    console.warn("[STATE] Invalid transition: CREATING → DRAGGING");
    return;
  }

  if (!Object.values(InteractionStates).includes(nextState)) {
    console.warn("[interactionStateMachine] Invalid state:", nextState);
    return;
  }
  CURRENT_STATE = nextState;
}

export function resetInteractionState() {
  CURRENT_STATE = DEFAULT_STATE;
}
