const QUESTION_TEXTS = [
  "우리는 모두 소중한 존재야!",
  "높임 표현",
  "설레는 마음",
  "도움을 주는 까닭",
  "깨닫거나 다짐한 점을 쓴다.",
];

const PARROT_IMAGES = {
  idle: "source/parrot_idle.png",
  talking: "source/parrot_talking.png",
  answering: "source/parrot_answering.png",
  correct: "source/parrot_correct.png",
  wrong: "source/parrot_wrong.png",
  reveal: "source/parrot_reveal.png",
};

const {
  VISIBLE_BOX_COUNT,
  clamp,
  createQuestion,
  createEmptyBoxes,
  getInitialActiveLetterIndex,
  moveViewportState,
  ensureActiveBoxVisibleState,
  getScrollNavState,
  shouldShowInputActiveState,
  shouldResetToFirstBoxOnRetry,
} = window.HandwritingViewport;

const LIFE_ICON_SRC = "source/ico-life.svg";
const CORRECT_BADGE_SRC = "source/correct.png";
const PEN_ICON_BLACK_SRC = "source/ico-pen-black.svg";
const PEN_ICON_WHITE_SRC = "source/ico-pen-white.svg";
const ERASER_ICON_BLACK_SRC = "source/ico-eraser-black.svg";
const ERASER_ICON_WHITE_SRC = "source/ico-eraser-white.svg";
const TRASHCAN_ICON_BLACK_SRC = "source/ico-trashcan-black.svg";
const MOCK_DETECTED_CHARS = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타"];
const TTS_DURATION_MS = 3000;
const WRONG_FEEDBACK_MS = 1500;
const CORRECT_HOLD_MS = 2000;
const ERASER_HIT_RADIUS_PX = 20;
const app = document.getElementById("app");
let currentScreenEnterClass = "";
let lastRenderedScreen = null;
let viewportStateFrame = 0;
let scheduledViewport = null;
let viewportScrollAnimationFrame = 0;
let writingTransitionFrame = 0;

const state = {
  screen: "versionSelect",
  parrotMood: "idle",
  handwritingVersion: null,
  isLargeWritingEnabled: false,
  isFollowWritingEnabled: false,
  currentQuestionIndex: 0,
  attemptsLeft: 3,
  activeLetterIndex: null,
  toolMode: "pen",
  viewportStartIndex: 0,
  debugNextSubmit: null,
  isDebugOpen: false,
  showGhostOverlay: false,
  isClearConfirmOpen: false,
  questions: QUESTION_TEXTS.map(createQuestion),
  currentBoxes: [],
  pointerSession: null,
  viewportDragSession: null,
  viewportScrollLeft: 0,
  pendingViewportTarget: null,
  inputActivatedAt: 0,
  disableInputEnterAnimation: false,
  lastScrollIntent: null,
  timers: [],
};

init();

function init() {
  resetLessonState();
  syncAppHeight();
  app.addEventListener("click", handleAppClick);
  app.addEventListener("pointerdown", handleAppPointerDown);
  window.addEventListener("resize", handleResize);
  window.visualViewport?.addEventListener("resize", handleResize);
  window.visualViewport?.addEventListener("scroll", handleResize);
  window.addEventListener("keydown", handleKeyDown);
  render();
}

function resetLessonState() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "versionSelect";
  state.parrotMood = "idle";
  state.handwritingVersion = null;
  state.isLargeWritingEnabled = false;
  state.isFollowWritingEnabled = false;
  state.currentQuestionIndex = 0;
  state.attemptsLeft = 3;
  state.activeLetterIndex = null;
  state.toolMode = "pen";
  state.viewportStartIndex = 0;
  state.debugNextSubmit = null;
  state.isDebugOpen = false;
  state.showGhostOverlay = false;
  state.isClearConfirmOpen = false;
  state.questions = QUESTION_TEXTS.map(createQuestion);
  resetCurrentQuestionProgress();
}

function resetCurrentQuestionProgress() {
  const question = getCurrentQuestion();
  state.currentBoxes = createEmptyBoxes(question.chars);
  state.activeLetterIndex = getInitialActiveLetterIndex(state.handwritingVersion, question.chars.length);
  state.toolMode = "pen";
  state.viewportStartIndex = 0;
  state.viewportScrollLeft = 0;
  state.pendingViewportTarget = null;
  state.inputActivatedAt = 0;
}

function isVersion2() {
  return state.handwritingVersion === "v2";
}

function isVersion3() {
  return state.handwritingVersion === "v3";
}

function isVersion4() {
  return state.handwritingVersion === "v4";
}

function isVersion1() {
  return state.handwritingVersion === "v1";
}

function usesFocusedWriting() {
  return isVersion1() || isVersion3() || (isVersion4() && state.isLargeWritingEnabled);
}

function allowsFocusClear() {
  return isVersion1() || isVersion3();
}

function usesDirectCurrentWriting() {
  return isVersion2() || (isVersion4() && !state.isLargeWritingEnabled);
}

function getVersionDescription() {
  switch (state.handwritingVersion) {
    case "v4":
      return "버전 4 · A/B테스트 형";
    case "v2":
      return "버전 2 · 모든 칸 바로쓰기형";
    case "v3":
      return "버전 3 · 확대형 + 오른쪽 도구";
    case "v1":
    default:
      return "버전 1 · 현재 칸 확대형";
  }
}

function getCurrentQuestion() {
  return state.questions[state.currentQuestionIndex];
}

function clearTimers() {
  state.timers.forEach((timerId) => window.clearTimeout(timerId));
  state.timers = [];
}

function queueTimer(callback, delay) {
  const timerId = window.setTimeout(() => {
    state.timers = state.timers.filter((id) => id !== timerId);
    callback();
  }, delay);
  state.timers.push(timerId);
}

function handleResize() {
  syncAppHeight();
  if (["input", "wrongFeedback", "correctWaiting", "failedWaiting", "reveal", "result"].includes(state.screen)) {
    setupCanvases();
    window.requestAnimationFrame(syncWritingViewport);
  }
}

function handleKeyDown(event) {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }

  if (state.isClearConfirmOpen) {
    state.isClearConfirmOpen = false;
    render();
    return;
  }

  state.isDebugOpen = !state.isDebugOpen;
  render();
}

function handleAppClick(event) {
  if (state.isClearConfirmOpen && event.target.closest(".overlay-modal__card") && !event.target.closest("[data-action]")) {
    return;
  }

  if (
    state.screen === "input" &&
    allowsFocusClear() &&
    state.activeLetterIndex !== null &&
    !event.target.closest(".paper-box") &&
    !event.target.closest(".writing-mode-switch") &&
    !event.target.closest(".tool-dock") &&
    !event.target.closest(".preview-box") &&
    !event.target.closest("[data-action]") &&
    !event.target.closest(".writing-viewport")
  ) {
    state.activeLetterIndex = null;
    state.pendingViewportTarget = null;
    render();
    return;
  }

  const debugButton = event.target.closest("[data-debug-choice]");
  if (debugButton) {
    const choice = debugButton.dataset.debugChoice;
    state.debugNextSubmit = state.debugNextSubmit === choice ? null : choice;
    render();
    return;
  }

  const ghostToggle = event.target.closest("[data-toggle-ghost]");
  if (ghostToggle && state.screen === "reveal") {
    state.showGhostOverlay = !state.showGhostOverlay;
    render();
    return;
  }

  const previewBox = state.screen === "input" ? event.target.closest(".preview-box[data-preview-index]") : null;
  if (previewBox) {
    const previewIndex = Number(previewBox.dataset.previewIndex);
    if (Number.isFinite(previewIndex)) {
      focusInputBoxByIndex(previewIndex, { behavior: "smooth" });
      return;
    }
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const action = actionButton.dataset.action;

  switch (action) {
    case "choose-version": {
      const requestedVersion = actionButton.dataset.version;
      const version =
        requestedVersion === "v2"
          ? "v2"
          : requestedVersion === "v3"
            ? "v3"
            : requestedVersion === "v4"
              ? "v4"
              : "v1";
      state.handwritingVersion = version;
      state.isLargeWritingEnabled = false;
      state.screen = "idle";
      state.parrotMood = "idle";
      resetCurrentQuestionProgress();
      render();
      break;
    }
    case "start-tts":
      startTtsPhase();
      break;
    case "finish-lesson":
      enterResultScreen();
      break;
    case "reveal-answer":
      enterRevealPhase();
      break;
    case "next-question":
      goToNextQuestion();
      break;
    case "view-result":
      enterResultScreen();
      break;
    case "restart-lesson":
      resetLessonState();
      render();
      break;
    case "nav-prev":
      moveViewport(-3);
      break;
    case "nav-next":
      moveViewport(3);
      break;
    case "clear-all":
      if (state.screen === "input" && (isVersion2() || isVersion3() || isVersion4())) {
        state.isClearConfirmOpen = true;
        render();
      } else {
        clearAllBoxes();
      }
      break;
    case "cancel-clear-all":
      state.isClearConfirmOpen = false;
      render();
      break;
    case "confirm-clear-all":
      state.isClearConfirmOpen = false;
      clearAllBoxes();
      break;
    case "clear-current-box": {
      const boxIndex = Number(actionButton.dataset.boxIndex);
      if (Number.isFinite(boxIndex)) {
        clearSingleBox(boxIndex);
      }
      break;
    }
    case "set-drawing-mode": {
      const mode = actionButton.dataset.mode;
      if ((mode === "pen" || mode === "eraser") && state.toolMode !== mode) {
        state.toolMode = mode;
        refreshToolModeControls();
      }
      break;
    }
    case "toggle-large-writing":
      if (isVersion4()) {
        stopPointerSession();
        stopViewportDragSession();
        stopViewportScrollAnimation();
        state.isLargeWritingEnabled = !state.isLargeWritingEnabled;
        if (state.activeLetterIndex === null && getCurrentQuestion().chars.length) {
          state.activeLetterIndex = 0;
        }
        state.pendingViewportTarget = null;
        refreshV4WritingModePresentation();
      }
      break;
    case "toggle-follow-writing":
      if (isVersion4()) {
        state.isFollowWritingEnabled = !state.isFollowWritingEnabled;
        render();
      }
      break;
    case "submit-answer":
      submitCurrentAnswer();
      break;
    default:
      break;
  }
}

function handleAppPointerDown(event) {
  if (state.isClearConfirmOpen) {
    return;
  }

  if (state.screen !== "input") {
    return;
  }

  if (performance.now() - state.inputActivatedAt < 180) {
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget && !event.target.closest(".paper-box")) {
    return;
  }

  const viewport = event.target.closest(".writing-viewport");
  const boxElement = event.target.closest(".writing-item[data-box-index]");
  const surface = event.target.closest(".paper-box");

  if (!surface && viewport) {
    beginViewportDrag(event, viewport);
    return;
  }

  if (!boxElement) {
    return;
  }

  const boxIndex = Number(boxElement.dataset.boxIndex);
  if (!Number.isFinite(boxIndex)) {
    return;
  }

  if (usesFocusedWriting() && boxIndex !== state.activeLetterIndex) {
    focusInputBoxByIndex(boxIndex, { behavior: "smooth" });
    return;
  }

  if (usesDirectCurrentWriting()) {
    const previousIndex = state.activeLetterIndex;
    state.activeLetterIndex = boxIndex;
    if (previousIndex !== boxIndex) {
      refreshCurrentBoxState(previousIndex, boxIndex);
    }
  }

  if (!surface) {
    return;
  }

  const canvas = boxElement.querySelector('canvas[data-canvas-role="input"]');
  if (!canvas) {
    return;
  }

  if (state.toolMode === "eraser") {
    beginErase(event, boxIndex, canvas);
    return;
  }

  beginStroke(event, boxIndex, canvas);
}

function beginStroke(event, boxIndex, canvas) {
  event.preventDefault();
  stopViewportScrollAnimation();

  const point = getNormalizedPoint(event, canvas);
  const box = state.currentBoxes[boxIndex];
  const stroke = {
    points: [point],
  };

  box.strokes.push(stroke);
  state.pointerSession = {
    pointerId: event.pointerId,
    boxIndex,
    canvas,
    stroke,
    mode: "pen",
  };

  if (typeof canvas.setPointerCapture === "function") {
    canvas.setPointerCapture(event.pointerId);
  }

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);
  redrawCanvasesForBox(boxIndex);
}

function beginErase(event, boxIndex, canvas) {
  event.preventDefault();
  stopViewportScrollAnimation();

  state.pointerSession = {
    pointerId: event.pointerId,
    boxIndex,
    canvas,
    mode: "eraser",
  };

  if (typeof canvas.setPointerCapture === "function") {
    canvas.setPointerCapture(event.pointerId);
  }

  eraseStrokesNearPoint(boxIndex, canvas, getNormalizedPoint(event, canvas));

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerUp);
}

function handlePointerMove(event) {
  const session = state.pointerSession;
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }

  event.preventDefault();

  if (session.mode === "eraser") {
    eraseStrokesNearPoint(session.boxIndex, session.canvas, getNormalizedPoint(event, session.canvas));
    return;
  }

  const point = getNormalizedPoint(event, session.canvas);
  const lastPoint = session.stroke.points[session.stroke.points.length - 1];
  const deltaX = point.x - lastPoint.x;
  const deltaY = point.y - lastPoint.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (distance < 0.003) {
    return;
  }

  session.stroke.points.push(point);
  redrawCanvasesForBox(session.boxIndex);
}

function handlePointerUp(event) {
  const session = state.pointerSession;
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }

  const question = getCurrentQuestion();
  const box = state.currentBoxes[session.boxIndex];
  const answerChar = question.chars[session.boxIndex];

  if (typeof session.canvas.releasePointerCapture === "function") {
    try {
      session.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture may already be released.
    }
  }

  if (session.mode === "pen") {
    box.detected = hasStroke(box) ? getMockDetectedValue(answerChar, session.boxIndex) : "";
    redrawCanvasesForBox(session.boxIndex);
    refreshDetectedPill(session.boxIndex);
    refreshInputButtons();
  }

  stopPointerSession();
}

function beginViewportDrag(event, viewport) {
  event.preventDefault();
  stopViewportScrollAnimation();

  state.viewportDragSession = {
    pointerId: event.pointerId,
    viewport,
    startClientX: event.clientX,
    startScrollLeft: viewport.scrollLeft,
    shouldClearFocus: usesFocusedWriting() && state.activeLetterIndex !== null,
    didDrag: false,
  };

  if (typeof viewport.setPointerCapture === "function") {
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore capture failures on non-canvas elements.
    }
  }

  window.addEventListener("pointermove", handleViewportDragMove);
  window.addEventListener("pointerup", handleViewportDragEnd);
  window.addEventListener("pointercancel", handleViewportDragEnd);
}

function handleViewportDragMove(event) {
  const session = state.viewportDragSession;
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }

  const deltaX = event.clientX - session.startClientX;
  if (Math.abs(deltaX) > 6) {
    session.didDrag = true;
  }
  const maxScrollLeft = Math.max(0, session.viewport.scrollWidth - session.viewport.clientWidth);
  const nextScrollLeft = clamp(session.startScrollLeft - deltaX, 0, maxScrollLeft);

  session.viewport.scrollLeft = nextScrollLeft;
  state.viewportScrollLeft = nextScrollLeft;
  scheduleViewportStateSync(session.viewport);
}

function handleViewportDragEnd(event) {
  const session = state.viewportDragSession;
  if (!session || event.pointerId !== session.pointerId) {
    return;
  }

  if (typeof session.viewport.releasePointerCapture === "function") {
    try {
      session.viewport.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture may already be released.
    }
  }

  const shouldClearFocus = session.shouldClearFocus && !session.didDrag;
  stopViewportDragSession();

  if (shouldClearFocus) {
    state.activeLetterIndex = null;
    state.pendingViewportTarget = null;
    render();
    return;
  }

  updateNavState(session.viewport);
}

function stopPointerSession() {
  state.pointerSession = null;
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", handlePointerUp);
  window.removeEventListener("pointercancel", handlePointerUp);
}

function stopViewportDragSession() {
  const session = state.viewportDragSession;
  state.viewportDragSession = null;
  window.removeEventListener("pointermove", handleViewportDragMove);
  window.removeEventListener("pointerup", handleViewportDragEnd);
  window.removeEventListener("pointercancel", handleViewportDragEnd);

  if (!session) {
    return;
  }

  if (typeof session.viewport.releasePointerCapture === "function") {
    try {
      session.viewport.releasePointerCapture(session.pointerId);
    } catch (error) {
      // Pointer capture may already be released.
    }
  }
}

function getNormalizedPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  return { x, y };
}

function startTtsPhase() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "tts";
  state.parrotMood = "talking";
  render();
  queueTimer(() => {
    enterInputPhase(false);
  }, TTS_DURATION_MS);
}

function enterInputPhase(preserveWriting) {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "input";
  state.parrotMood = "answering";
  state.disableInputEnterAnimation = preserveWriting;
  state.pendingViewportTarget = null;
  state.lastScrollIntent = null;
  state.toolMode = "pen";
  if (!preserveWriting) {
    resetCurrentQuestionProgress();
  } else if (isVersion1() || isVersion3()) {
    state.activeLetterIndex = getInitialActiveLetterIndex(state.handwritingVersion, getCurrentQuestion().chars.length);
  } else if (isVersion4() && state.activeLetterIndex === null) {
    state.activeLetterIndex = getInitialActiveLetterIndex(state.handwritingVersion, getCurrentQuestion().chars.length);
  }
  if (preserveWriting && shouldResetToFirstBoxOnRetry(state.handwritingVersion, state.isLargeWritingEnabled)) {
    state.activeLetterIndex = getCurrentQuestion().chars.length ? 0 : null;
    state.pendingViewportTarget = {
      type: "start",
      behavior: "smooth",
      defer: true,
    };
  }
  if (usesFocusedWriting()) {
    ensureActiveBoxVisible({ behavior: preserveWriting ? "smooth" : "auto", defer: preserveWriting });
  }
  state.inputActivatedAt = performance.now();
  render();
}

function enterWrongFeedbackPhase() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "wrongFeedback";
  state.parrotMood = "wrong";
  render();
  queueTimer(() => {
    if (state.attemptsLeft > 0) {
      enterInputPhase(true);
    } else {
      enterFailedWaitingPhase();
    }
  }, WRONG_FEEDBACK_MS);
}

function enterCorrectWaitingPhase() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "correctWaiting";
  state.parrotMood = "correct";
  render();
  queueTimer(() => {
    state.parrotMood = "idle";
    render();
  }, CORRECT_HOLD_MS);
}

function enterFailedWaitingPhase() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "failedWaiting";
  state.parrotMood = "idle";
  render();
}

function enterRevealPhase() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "reveal";
  state.parrotMood = "reveal";
  state.showGhostOverlay = false;
  render();
}

function goToNextQuestion() {
  if (state.currentQuestionIndex >= state.questions.length - 1) {
    enterResultScreen();
    return;
  }

  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.currentQuestionIndex += 1;
  state.attemptsLeft = 3;
  state.parrotMood = "talking";
  state.debugNextSubmit = null;
  state.showGhostOverlay = false;
  resetCurrentQuestionProgress();
  startTtsPhase();
}

function enterResultScreen() {
  clearTimers();
  stopPointerSession();
  stopViewportDragSession();
  state.screen = "result";
  state.parrotMood = "idle";
  state.isDebugOpen = false;
  render();
}

function moveViewport(step) {
  if (state.screen !== "input") {
    return;
  }

  const viewport = app.querySelector(".writing-viewport");
  if (!viewport) {
    const question = getCurrentQuestion();
    const nextState = moveViewportState(
      {
        viewportStartIndex: state.viewportStartIndex,
        activeLetterIndex: state.activeLetterIndex,
      },
      question.chars.length,
      VISIBLE_BOX_COUNT,
      step
    );
    state.viewportStartIndex = nextState.viewportStartIndex;
    render();
    return;
  }

  const nextScrollLeft = getViewportScrollTarget(viewport, step);
  state.lastScrollIntent = "nav";
  animateViewportScroll(viewport, nextScrollLeft);
}

function focusInputBoxByIndex(index, options = {}) {
  if (!Number.isFinite(index)) {
    return;
  }

  const previousIndex = state.activeLetterIndex;
  state.activeLetterIndex = index;
  ensureActiveBoxVisible({ behavior: options.behavior || "smooth" });

  if (isVersion4() || usesDirectCurrentWriting()) {
    if (previousIndex !== index) {
      refreshCurrentBoxState(previousIndex, index);
      return;
    }
    syncWritingViewport();
    return;
  }

  render();
}

function ensureActiveBoxVisible(options = {}) {
  if (state.activeLetterIndex === null) {
    state.pendingViewportTarget = null;
    return;
  }

  state.lastScrollIntent = "focus";
  state.pendingViewportTarget = {
    type: "box",
    index: state.activeLetterIndex,
    align: "safe-center",
    behavior: options.behavior || "auto",
    defer: Boolean(options.defer),
  };

  const viewport = app.querySelector(".writing-viewport");
  if (!viewport) {
    const question = getCurrentQuestion();
    const nextState = ensureActiveBoxVisibleState(
      {
        viewportStartIndex: state.viewportStartIndex,
        activeLetterIndex: state.activeLetterIndex,
      },
      question.chars.length,
      VISIBLE_BOX_COUNT
    );

    state.viewportStartIndex = nextState.viewportStartIndex;
  }
}

function eraseStrokesNearPoint(boxIndex, canvas, point) {
  const box = state.currentBoxes[boxIndex];
  if (!box) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const threshold = ERASER_HIT_RADIUS_PX / Math.max(1, Math.min(rect.width, rect.height));
  const thresholdSquared = threshold * threshold;

  const nextStrokes = box.strokes.filter(
    (stroke) =>
      !stroke.points.some((strokePoint) => {
        const deltaX = strokePoint.x - point.x;
        const deltaY = strokePoint.y - point.y;
        return deltaX * deltaX + deltaY * deltaY <= thresholdSquared;
      })
  );

  if (nextStrokes.length === box.strokes.length) {
    return;
  }

  box.strokes = nextStrokes;
  if (!hasStroke(box)) {
    box.detected = "";
  }

  redrawCanvasesForBox(boxIndex);
  refreshDetectedPill(boxIndex);
  refreshInputButtons();
}

function clearAllBoxes() {
  state.currentBoxes.forEach((box) => {
    box.strokes = [];
    box.detected = "";
  });
  state.viewportScrollLeft = 0;
  state.pendingViewportTarget = null;
  if (usesFocusedWriting()) {
    state.activeLetterIndex = getInitialActiveLetterIndex(state.handwritingVersion, getCurrentQuestion().chars.length);
    state.toolMode = "pen";
    ensureActiveBoxVisible({ behavior: "auto" });
  } else {
    state.activeLetterIndex = isVersion2() ? null : getCurrentQuestion().chars.length ? 0 : null;
    state.toolMode = "pen";
  }
  render();
}

function clearSingleBox(boxIndex) {
  const box = state.currentBoxes[boxIndex];
  if (!box) {
    return;
  }

  box.strokes = [];
  box.detected = "";
  redrawCanvasesForBox(boxIndex);
  refreshDetectedPill(boxIndex);
  refreshInputButtons();
}

function submitCurrentAnswer() {
  if (!canSubmitCurrentAnswer()) {
    return;
  }

  const question = getCurrentQuestion();
  const attemptsLeftAtSubmit = state.attemptsLeft;
  const snapshot = cloneCurrentBoxes();
  const detectedText = buildDetectedText(snapshot, question.chars);

  let isCorrect = false;
  if (state.debugNextSubmit === "correct") {
    isCorrect = true;
  } else if (state.debugNextSubmit === "wrong") {
    isCorrect = false;
  } else {
    isCorrect = detectedText === question.text;
  }

  question.attempts.push({
    questionIndex: state.currentQuestionIndex,
    questionText: question.text,
    submissionOrder: question.attempts.length + 1,
    strokesByIndex: snapshot.map((box) => box.strokes),
    detectedByIndex: snapshot.map((box) => box.detected),
    detectedText,
    isCorrect,
    attemptsLeftAtSubmit,
  });

  state.debugNextSubmit = null;
  state.activeLetterIndex = null;
  state.pendingViewportTarget = null;

  if (isCorrect) {
    question.finalStatus = "correct";
    enterCorrectWaitingPhase();
    return;
  }

  state.attemptsLeft -= 1;
  if (state.attemptsLeft <= 0) {
    question.finalStatus = "wrong";
  }

  enterWrongFeedbackPhase();
}

function cloneCurrentBoxes() {
  return state.currentBoxes.map((box) => ({
    detected: box.detected,
    strokes: box.strokes.map((stroke) => ({
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  }));
}

function buildDetectedText(boxes, chars) {
  return chars
    .map((char, index) => boxes[index].detected || (char === " " ? " " : ""))
    .join("");
}

function hasStroke(box) {
  return box.strokes.some((stroke) => stroke.points.length > 0);
}

function canSubmitCurrentAnswer() {
  const question = getCurrentQuestion();
  return question.chars.some((char, index) => char !== " " && hasStroke(state.currentBoxes[index]));
}

function hasAnyWriting() {
  return state.currentBoxes.some((box) => hasStroke(box));
}

function getLatestAttempt(question = getCurrentQuestion()) {
  return question.attempts[question.attempts.length - 1] || null;
}

function getQuestionProgressLabel() {
  return `문제 ${state.currentQuestionIndex + 1} / ${state.questions.length}`;
}

function getTeacherActions() {
  const followWritingAction =
    isVersion4() && ["input", "wrongFeedback"].includes(state.screen)
      ? [
          {
            action: "toggle-follow-writing",
            label: `따라쓰기 ${state.isFollowWritingEnabled ? "ON" : "OFF"}`,
            variant: state.isFollowWritingEnabled ? "primary" : "ghost",
          },
        ]
      : [];

  switch (state.screen) {
    case "idle":
      return [
        { action: "start-tts", label: "TTS 재생", variant: "primary" },
        { action: "finish-lesson", label: "종료", variant: "ghost" },
      ];
    case "tts":
    case "input":
    case "wrongFeedback":
      return [{ action: "finish-lesson", label: "종료", variant: "ghost" }, ...followWritingAction];
    case "correctWaiting":
    case "failedWaiting":
      return [
        { action: "reveal-answer", label: "정답 공개", variant: "primary" },
        { action: "finish-lesson", label: "종료", variant: "ghost" },
      ];
    case "reveal":
      return [
        {
          action: state.currentQuestionIndex >= state.questions.length - 1 ? "view-result" : "next-question",
          label: state.currentQuestionIndex >= state.questions.length - 1 ? "결과 보기" : "다음 문제",
          variant: "primary",
        },
        { action: "finish-lesson", label: "종료", variant: "ghost" },
      ];
    case "result":
      return [{ action: "restart-lesson", label: "다시 시작", variant: "primary" }];
    default:
      return [];
  }
}

function render() {
  const isResult = state.screen === "result";
  currentScreenEnterClass = lastRenderedScreen !== state.screen ? getScreenEnterClass(state.screen) : "";
  app.innerHTML = `
    <div class="prototype-shell${isResult ? " is-result" : ""}">
      ${renderTopPanels()}
      ${renderDebugPanel()}
      ${renderParrotStage()}
      ${renderScreen()}
      ${renderDialogs()}
      ${isResult ? '<div class="result-illustration" aria-hidden="true"></div>' : ""}
    </div>
  `;
  lastRenderedScreen = state.screen;
  setupCanvases();
  window.requestAnimationFrame(syncWritingViewport);
}

function getScreenEnterClass(screen) {
  switch (screen) {
    case "input":
      return state.disableInputEnterAnimation ? "" : "screen--enter-input";
    case "correctWaiting":
    case "failedWaiting":
      return "screen--enter-waiting";
    default:
      return "";
  }
}

function renderTopPanels() {
  if (state.screen === "versionSelect") {
    return "";
  }

  return `
    <aside class="top-panels">
      <section class="control-panel">
        <p class="control-panel__title">Teacher Control</p>
        <p class="control-panel__meta">${escapeHtml(getQuestionProgressLabel())}</p>
        <div class="control-panel__actions">
          ${getTeacherActions()
            .map(
              ({ action, label, variant }) => `
                <button class="panel-button panel-button--${variant}" data-action="${action}">
                  ${escapeHtml(label)}
                </button>
              `
            )
            .join("")}
        </div>
      </section>
    </aside>
  `;
}

function renderDebugPanel() {
  if (!state.isDebugOpen || state.screen === "result" || state.screen === "versionSelect") {
    return "";
  }

  const isInteractive = ["idle", "tts", "input", "wrongFeedback"].includes(state.screen);
  return `
    <section class="debug-panel" role="dialog" aria-label="Prototype Debug">
      <p class="debug-panel__title">Prototype Debug</p>
      <p class="debug-panel__meta">ESC 로 닫기 · 다음 제출 판정만 강제합니다.</p>
      <div class="debug-panel__actions">
        <button
          class="debug-button${state.debugNextSubmit === "correct" ? " is-active" : ""}"
          data-debug-choice="correct"
          ${isInteractive ? "" : "disabled"}
        >
          다음 제출 정답 처리
        </button>
        <button
          class="debug-button${state.debugNextSubmit === "wrong" ? " is-active" : ""}"
          data-debug-choice="wrong"
          ${isInteractive ? "" : "disabled"}
        >
          다음 제출 오답 처리
        </button>
      </div>
    </section>
  `;
}

function renderDialogs() {
  if (!state.isClearConfirmOpen) {
    return "";
  }

  return `
    <div class="overlay-modal" data-action="cancel-clear-all">
      <section class="overlay-modal__card" role="dialog" aria-modal="true" aria-label="모두 지우기 확인">
        <p class="overlay-modal__title">글자를 모두 지울까요?</p>
        <p class="overlay-modal__body">지우면 지금까지 쓴 글자가 모두 사라져요.</p>
        <div class="overlay-modal__actions">
          <button class="overlay-modal__button overlay-modal__button--primary" data-action="confirm-clear-all">모두 지우기</button>
          <button class="overlay-modal__button overlay-modal__button--ghost" data-action="cancel-clear-all">취소</button>
        </div>
      </section>
    </div>
  `;
}

function renderParrotStage() {
  if (state.screen === "result") {
    return '<section class="parrot-stage is-hidden" aria-hidden="true"></section>';
  }

  return `
    <section class="parrot-stage" aria-hidden="true">
      <div class="parrot-stage__set">
        <img class="speaker speaker--left" src="source/speaker.png" alt="" />
        <div class="parrot-wrap">
          <img class="parrot-visual" src="${PARROT_IMAGES[state.parrotMood]}" alt="" />
        </div>
        <img class="speaker speaker--right" src="source/speaker.png" alt="" />
      </div>
    </section>
  `;
}

function renderScreen() {
  switch (state.screen) {
    case "versionSelect":
      return renderVersionSelectScreen();
    case "idle":
      return renderIdleScreen();
    case "tts":
      return renderTtsScreen();
    case "input":
    case "wrongFeedback":
      return renderInputScreen();
    case "correctWaiting":
      return renderWaitingScreen(true);
    case "failedWaiting":
      return renderWaitingScreen(false);
    case "reveal":
      return renderRevealScreen();
    case "result":
      return renderResultScreen();
    default:
      return "";
  }
}

function renderVersionSelectScreen() {
  return `
    <main class="screen version-screen">
      <div class="screen__dim screen__dim--soft"></div>
      <section class="version-picker screen__content">
        <p class="version-picker__eyebrow">손글씨 받아쓰기</p>
        <h1 class="version-picker__title">입력 방식을 선택해주세요</h1>
        <div class="version-picker__cards">
          <button class="version-card" data-action="choose-version" data-version="v1">
            <span class="version-card__kicker">버전 1</span>
            <strong class="version-card__title">현재 칸 확대형</strong>
            <span class="version-card__body">한 칸을 선택하면 크게 확대해서 쓰는 방식</span>
          </button>
          <button class="version-card" data-action="choose-version" data-version="v2">
            <span class="version-card__kicker">버전 2</span>
            <strong class="version-card__title">모든 칸 바로쓰기형</strong>
            <span class="version-card__body">모든 칸에 바로 쓰고, 도구를 선택해서 쓰기/지우기하는 방식</span>
          </button>
          <button class="version-card" data-action="choose-version" data-version="v3">
            <span class="version-card__kicker">버전 3</span>
            <strong class="version-card__title">확대형 + 오른쪽 도구</strong>
            <span class="version-card__body">현재 칸은 크게 쓰고, 도구는 오른쪽 dock에서 바꾸는 방식</span>
          </button>
          <button class="version-card" data-action="choose-version" data-version="v4">
            <span class="version-card__kicker">버전 4</span>
            <strong class="version-card__title">A/B테스트 형</strong>
            <span class="version-card__body">전체쓰기와 크게쓰기를 학생이 직접 전환하는 통합 모드</span>
          </button>
        </div>
      </section>
    </main>
  `;
}

function renderIdleScreen() {
  return `
    <main class="screen idle-screen">
      <section class="idle-card screen__content">
        <h1 class="idle-card__title">손글씨 받아쓰기 준비 완료</h1>
        <p class="idle-card__body">
          선택한 방식: <strong>${getVersionDescription()}</strong><br />
          오른쪽 상단의 <strong>TTS 재생</strong> 버튼으로 활동을 시작하세요.
        </p>
      </section>
    </main>
  `;
}

function renderTtsScreen() {
  return `
    <main class="screen tts-screen">
      <div class="screen__dim screen__dim--soft"></div>
      <section class="tts-card screen__content">
        <h1 class="tts-card__title">선생님 화면에서 재생되는 문장을 잘 들어주세요!</h1>
        <p class="tts-card__body">3초 뒤에 손글씨 입력 화면으로 자동 전환됩니다.</p>
      </section>
    </main>
  `;
}

function renderInputScreen() {
  if (isVersion2()) {
    return renderInputScreenV2();
  }

  if (isVersion3()) {
    return renderInputScreenV3();
  }

  if (isVersion4()) {
    return renderInputScreenV4();
  }

  return renderInputScreenV1();
}

function renderInputScreenV1() {
  const question = getCurrentQuestion();
  const isWrongFeedback = state.screen === "wrongFeedback";

  return `
    <main class="screen input-screen${currentScreenEnterClass ? ` ${currentScreenEnterClass}` : ""}">
      <div class="screen__dim screen__dim--flat"></div>
      <section class="input-shell screen__content">
        <div class="activity-stack">
          <div class="input-head">
            ${renderLifeRow()}
          </div>
          <div class="preview-cluster preview-cluster--input">
            <div class="preview-row preview-row--input" aria-label="preview letter boxes">
              ${question.chars.map((char, index) => renderPreviewBox(char, index, "input")).join("")}
            </div>
          </div>
          <section class="writing-panel">
            <button class="nav-rail nav-rail--prev" data-action="nav-prev" aria-label="이전 글자 칸">
              <span aria-hidden="true">‹</span>
            </button>
            <div class="writing-viewport">
              <div class="writing-row${isWrongFeedback ? " is-wrong" : ""}" data-writing-row>
                ${question.chars.map((_, index) => renderWritingBoxV1(index, isWrongFeedback)).join("")}
              </div>
            </div>
            <button class="nav-rail nav-rail--next" data-action="nav-next" aria-label="다음 글자 칸">
              <span aria-hidden="true">›</span>
            </button>
          </section>
          <div class="button-area button-area--input">
            <button class="cta-button" data-action="submit-answer" ${canSubmitCurrentAnswer() && !isWrongFeedback ? "" : "disabled"}>
              답안 제출
            </button>
            <button class="clear-all-button" data-action="clear-all" ${hasAnyWriting() && !isWrongFeedback ? "" : "disabled"}>
              <img class="toolbar-icon" src="${ERASER_ICON_WHITE_SRC}" alt="" />
              <span>전체 지우기</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderInputScreenV3() {
  const question = getCurrentQuestion();
  const isWrongFeedback = state.screen === "wrongFeedback";

  return `
    <main class="screen input-screen input-screen--v2${currentScreenEnterClass ? ` ${currentScreenEnterClass}` : ""}">
      <div class="screen__dim screen__dim--flat"></div>
      <section class="input-shell input-shell--v2 screen__content">
        <div class="activity-stack activity-stack--v2">
          <div class="input-head">
            ${renderLifeRow()}
          </div>
          <div class="preview-cluster preview-cluster--input">
            <div class="preview-row preview-row--input" aria-label="preview letter boxes">
              ${question.chars.map((char, index) => renderPreviewBox(char, index, "input")).join("")}
            </div>
          </div>
          <div class="writing-zone writing-zone--v2">
            <section class="writing-panel writing-panel--v3">
              <button class="nav-rail nav-rail--prev" data-action="nav-prev" aria-label="이전 글자 칸">
                <span aria-hidden="true">‹</span>
              </button>
              <div class="writing-viewport writing-viewport--v3">
                <div class="writing-row${isWrongFeedback ? " is-wrong" : ""}" data-writing-row>
                  ${question.chars.map((_, index) => renderWritingBoxV1(index, isWrongFeedback)).join("")}
                </div>
              </div>
              <button class="nav-rail nav-rail--next" data-action="nav-next" aria-label="다음 글자 칸">
                <span aria-hidden="true">›</span>
              </button>
            </section>
            ${renderToolDock({ isInteractive: !isWrongFeedback, includeClearAll: true })}
          </div>
          <div class="button-area button-area--input button-area--input-v2">
            <button class="cta-button" data-action="submit-answer" ${canSubmitCurrentAnswer() && !isWrongFeedback ? "" : "disabled"}>
              답안 제출
            </button>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderInputScreenV2() {
  const question = getCurrentQuestion();
  const isWrongFeedback = state.screen === "wrongFeedback";

  return `
    <main class="screen input-screen input-screen--v2${currentScreenEnterClass ? ` ${currentScreenEnterClass}` : ""}">
      <div class="screen__dim screen__dim--flat"></div>
      <section class="input-shell input-shell--v2 screen__content">
        <div class="activity-stack activity-stack--v2">
          <div class="input-head">
            ${renderLifeRow()}
          </div>
          <div class="preview-cluster preview-cluster--input">
            <div class="preview-row preview-row--input" aria-label="preview letter boxes">
              ${question.chars.map((char, index) => renderPreviewBox(char, index, "input")).join("")}
            </div>
          </div>
          <div class="writing-zone writing-zone--v2">
            <section class="writing-panel writing-panel--v2">
              <button class="nav-rail nav-rail--prev" data-action="nav-prev" aria-label="이전 글자 칸">
                <span aria-hidden="true">‹</span>
              </button>
              <div class="writing-viewport writing-viewport--v2">
                <div class="writing-row writing-row--v2${isWrongFeedback ? " is-wrong" : ""}" data-writing-row>
                  ${question.chars.map((_, index) => renderWritingBoxV2(index, isWrongFeedback)).join("")}
                </div>
              </div>
              <button class="nav-rail nav-rail--next" data-action="nav-next" aria-label="다음 글자 칸">
                <span aria-hidden="true">›</span>
              </button>
            </section>
          ${renderToolDock({ isInteractive: !isWrongFeedback, includeClearAll: true })}
          </div>
          <div class="button-area button-area--input button-area--input-v2">
            <button class="cta-button" data-action="submit-answer" ${canSubmitCurrentAnswer() && !isWrongFeedback ? "" : "disabled"}>
              답안 제출
            </button>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderInputScreenV4() {
  const question = getCurrentQuestion();
  const isWrongFeedback = state.screen === "wrongFeedback";

  return `
    <main class="screen input-screen input-screen--v2${currentScreenEnterClass ? ` ${currentScreenEnterClass}` : ""}">
      <div class="screen__dim screen__dim--flat"></div>
      <section class="input-shell input-shell--v2 screen__content">
        <div class="activity-stack activity-stack--v2">
          <div class="input-head">
            ${renderLifeRow()}
          </div>
          <div class="preview-cluster preview-cluster--input">
            <div class="preview-row preview-row--input" aria-label="preview letter boxes">
              ${question.chars.map((char, index) => renderPreviewBox(char, index, "input")).join("")}
            </div>
          </div>
          <div class="writing-zone writing-zone--v2">
            <section class="writing-panel writing-panel--v4${state.isLargeWritingEnabled ? " is-large-mode" : ""}">
              <button class="nav-rail nav-rail--prev" data-action="nav-prev" aria-label="이전 글자 칸">
                <span aria-hidden="true">‹</span>
              </button>
              <div class="writing-viewport writing-viewport--v4">
                <div class="writing-row writing-row--v4${isWrongFeedback ? " is-wrong" : ""}" data-writing-row>
                  ${question.chars.map((_, index) => renderWritingBoxV4(index, isWrongFeedback)).join("")}
                </div>
              </div>
              <button class="nav-rail nav-rail--next" data-action="nav-next" aria-label="다음 글자 칸">
                <span aria-hidden="true">›</span>
              </button>
              ${renderLargeWritingToggle()}
            </section>
            ${renderToolDock({ isInteractive: !isWrongFeedback, includeClearAll: true })}
          </div>
          <div class="button-area button-area--input button-area--input-v2">
            <button class="cta-button" data-action="submit-answer" ${canSubmitCurrentAnswer() && !isWrongFeedback ? "" : "disabled"}>
              답안 제출
            </button>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderWritingBoxV1(index, isWrongFeedback) {
  const box = state.currentBoxes[index];
  const isActive = index === state.activeLetterIndex;
  const isWarning = isWrongFeedback;
  const detectedText = box.detected;
  const showCurrentClear = (isVersion3() || isVersion4()) && isActive && !isWrongFeedback;

  return `
    <article class="writing-item${isActive ? " is-active" : ""}" data-box-index="${index}" aria-label="letter box ${index + 1}">
      <div class="writing-item__surface-shell">
        <div class="writing-item__surface">
          <div class="paper-box${isWarning ? " is-warning" : ""}">
            <div class="guide-grid" aria-hidden="true"></div>
            <canvas class="letter-canvas" data-canvas-role="input" data-box-index="${index}" data-theme="input"></canvas>
          </div>
          ${
            isActive
              ? `
                ${isVersion1() ? renderDrawingModeSwitch() : ""}
                ${showCurrentClear ? renderCurrentClearButton(index) : ""}
              `
              : ""
          }
        </div>
      </div>
      <div class="detected-pill${detectedText ? "" : " is-empty"}">${escapeHtml(detectedText)}</div>
    </article>
  `;
}

function renderWritingBoxV2(index, isWrongFeedback) {
  const box = state.currentBoxes[index];
  const isWarning = isWrongFeedback;
  const isCurrent = index === state.activeLetterIndex;
  const detectedText = box.detected;

  return `
    <article class="writing-item writing-item--v2${isCurrent ? " is-current" : ""}" data-box-index="${index}" aria-label="letter box ${index + 1}">
      <div class="writing-item__surface-shell writing-item__surface-shell--v2">
        <div class="writing-item__surface writing-item__surface--v2">
          <div class="paper-box paper-box--v2${isCurrent ? " is-current" : ""}${isWarning ? " is-warning" : ""}">
            <div class="guide-grid" aria-hidden="true"></div>
            <canvas class="letter-canvas" data-canvas-role="input" data-box-index="${index}" data-theme="input"></canvas>
          </div>
          ${isCurrent && !isWrongFeedback ? renderCurrentClearButton(index) : ""}
        </div>
      </div>
      <div class="detected-pill detected-pill--v2${detectedText ? "" : " is-empty"}">${escapeHtml(detectedText)}</div>
    </article>
  `;
}

function renderWritingBoxV4(index, isWrongFeedback) {
  const box = state.currentBoxes[index];
  const isWarning = isWrongFeedback;
  const isCurrent = index === state.activeLetterIndex;
  const detectedText = box.detected;
  const isLargeMode = state.isLargeWritingEnabled;
  const promptChar = getCurrentQuestion().chars[index];
  const showPrompt = state.isFollowWritingEnabled && promptChar && promptChar !== " ";

  return `
    <article class="writing-item writing-item--v4${isLargeMode ? " is-large-mode" : ""}${isCurrent ? " is-current" : ""}" data-box-index="${index}" aria-label="letter box ${index + 1}">
      <div class="writing-item__surface-shell writing-item__surface-shell--v2">
        <div class="writing-item__surface writing-item__surface--v2">
          <div class="paper-box paper-box--v4${isCurrent ? " is-current" : ""}${isWarning ? " is-warning" : ""}">
            <div class="guide-grid" aria-hidden="true"></div>
            ${showPrompt ? `<span class="paper-box__prompt paper-box__prompt--v4">${escapeHtml(promptChar)}</span>` : ""}
            <canvas class="letter-canvas" data-canvas-role="input" data-box-index="${index}" data-theme="input"></canvas>
          </div>
          ${isCurrent && !isWrongFeedback ? renderCurrentClearButton(index) : ""}
        </div>
      </div>
      <div class="detected-pill detected-pill--v2${detectedText ? "" : " is-empty"}">${escapeHtml(detectedText)}</div>
    </article>
  `;
}

function renderCurrentClearButton(index) {
  return `
    <button
      class="writing-item__clear-current"
      data-action="clear-current-box"
      data-box-index="${index}"
      aria-label="현재 칸 모두 지우기"
      type="button"
    >
      <img src="${TRASHCAN_ICON_BLACK_SRC}" alt="" />
    </button>
  `;
}

function renderDrawingModeSwitch() {
  return `
    <div class="writing-mode-switch" role="group" aria-label="펜과 지우개 전환">
      <button class="writing-mode-switch__button${state.toolMode === "pen" ? " is-active" : ""}" data-action="set-drawing-mode" data-mode="pen" aria-label="펜 모드">
        <img src="${state.toolMode === "pen" ? PEN_ICON_BLACK_SRC : PEN_ICON_WHITE_SRC}" alt="" />
      </button>
      <button class="writing-mode-switch__button${state.toolMode === "eraser" ? " is-active" : ""}" data-action="set-drawing-mode" data-mode="eraser" aria-label="지우개 모드">
        <img src="${state.toolMode === "eraser" ? ERASER_ICON_BLACK_SRC : ERASER_ICON_WHITE_SRC}" alt="" />
      </button>
    </div>
  `;
}

function renderLargeWritingToggle() {
  return `
    <div class="writing-size-toggle">
      <span class="writing-size-toggle__label">크게 쓰기</span>
      <button
        class="writing-size-toggle__switch${state.isLargeWritingEnabled ? " is-on" : ""}"
        data-action="toggle-large-writing"
        type="button"
        role="switch"
        aria-checked="${state.isLargeWritingEnabled ? "true" : "false"}"
        aria-label="크게 쓰기"
      >
        <span class="writing-size-toggle__thumb" aria-hidden="true"></span>
      </button>
    </div>
  `;
}

function renderToolDock({ isInteractive, includeClearAll }) {
  return `
    <div class="tool-dock" aria-label="필기 도구">
      <button class="tool-dock__button${state.toolMode === "pen" ? " is-active" : ""}" data-action="set-drawing-mode" data-mode="pen" aria-label="펜" ${isInteractive ? "" : "disabled"}>
        <img src="${state.toolMode === "pen" ? PEN_ICON_BLACK_SRC : PEN_ICON_BLACK_SRC}" alt="" />
      </button>
      <button class="tool-dock__button${state.toolMode === "eraser" ? " is-active" : ""}" data-action="set-drawing-mode" data-mode="eraser" aria-label="지우개" ${isInteractive ? "" : "disabled"}>
        <img src="${ERASER_ICON_BLACK_SRC}" alt="" />
      </button>
      ${
        includeClearAll
          ? `
            <button class="tool-dock__button tool-dock__button--action" data-action="clear-all" aria-label="모두 지우기" ${hasAnyWriting() && isInteractive ? "" : "disabled"}>
              <img src="${TRASHCAN_ICON_BLACK_SRC}" alt="" />
            </button>
          `
          : ""
      }
    </div>
  `;
}

function refreshToolModeControls() {
  const drawingButtons = app.querySelectorAll('[data-action="set-drawing-mode"][data-mode]');
  drawingButtons.forEach((button) => {
    const mode = button.dataset.mode;
    const isActive = mode === state.toolMode;
    button.classList.toggle("is-active", isActive);
    const icon = button.querySelector("img");
    if (!icon) {
      return;
    }

    if (button.classList.contains("writing-mode-switch__button")) {
      if (mode === "pen") {
        icon.src = isActive ? PEN_ICON_BLACK_SRC : PEN_ICON_WHITE_SRC;
      } else if (mode === "eraser") {
        icon.src = isActive ? ERASER_ICON_BLACK_SRC : ERASER_ICON_WHITE_SRC;
      }
      return;
    }

    if (mode === "pen") {
      icon.src = PEN_ICON_BLACK_SRC;
    } else if (mode === "eraser") {
      icon.src = ERASER_ICON_BLACK_SRC;
    }
  });
}

function refreshWritingSizeToggle() {
  const toggle = app.querySelector('.writing-size-toggle__switch');
  if (!toggle) {
    return;
  }

  toggle.classList.toggle("is-on", state.isLargeWritingEnabled);
  toggle.setAttribute("aria-checked", state.isLargeWritingEnabled ? "true" : "false");
}

function startWritingTransitionRefresh(duration = 260, onFrame = null) {
  stopWritingTransitionRefresh();
  const startedAt = performance.now();

  const tick = (now) => {
    setupCanvases();
    if (onFrame) {
      onFrame(now - startedAt >= duration);
    }
    if (now - startedAt < duration) {
      writingTransitionFrame = window.requestAnimationFrame(tick);
      return;
    }

    writingTransitionFrame = 0;
  };

  writingTransitionFrame = window.requestAnimationFrame(tick);
}

function refreshV4WritingModePresentation() {
  const panel = app.querySelector(".writing-panel--v4");
  const viewport = app.querySelector(".writing-viewport--v4");
  const row = app.querySelector(".writing-row--v4");

  if (!panel || !viewport || !row) {
    render();
    return;
  }

  const activeIndex = state.activeLetterIndex;
  const currentPaper =
    activeIndex === null
      ? null
      : row.querySelector(`.writing-item--v4[data-box-index="${activeIndex}"] .paper-box--v4`);
  const viewportRect = viewport.getBoundingClientRect();
  const anchorCenter =
    currentPaper
      ? currentPaper.getBoundingClientRect().left + currentPaper.getBoundingClientRect().width * 0.5 - viewportRect.left
      : null;
  const startScrollLeft = viewport.scrollLeft;

  panel.classList.toggle("is-large-mode", state.isLargeWritingEnabled);
  row.querySelectorAll(".writing-item--v4").forEach((item) => {
    item.classList.toggle("is-large-mode", state.isLargeWritingEnabled);
  });

  refreshWritingSizeToggle();
  refreshToolModeControls();
  setupCanvases();
  const keepActivePaperAnchored = () => {
    if (activeIndex === null || anchorCenter === null) {
      syncViewportStateFromDom(viewport);
      updateNavState(viewport);
      return;
    }

    const nextPaper = row.querySelector(`.writing-item--v4[data-box-index="${activeIndex}"] .paper-box--v4`);
    if (!nextPaper) {
      syncViewportStateFromDom(viewport);
      updateNavState(viewport);
      return;
    }

    const nextViewportRect = viewport.getBoundingClientRect();
    const nextRect = nextPaper.getBoundingClientRect();
    const nextCenter = nextRect.left + nextRect.width * 0.5 - nextViewportRect.left;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = clamp(viewport.scrollLeft + (nextCenter - anchorCenter), 0, maxScrollLeft);
    state.viewportScrollLeft = viewport.scrollLeft;
    syncViewportStateFromDom(viewport);
    updateNavState(viewport);
  };

  keepActivePaperAnchored();
  startWritingTransitionRefresh(280, keepActivePaperAnchored);
}

function renderPreviewBox(char, index, context) {
  const isActive =
    context === "input" &&
    shouldShowInputActiveState(state.handwritingVersion) &&
    index === state.activeLetterIndex;
  const isBlank = char === " ";
  const theme = context === "waiting" ? "waiting-preview" : "preview";
  const role = context === "waiting" ? "waiting-preview" : "preview";

  return `
    <div class="preview-box preview-box--${context}${isActive ? " is-active" : ""}${isBlank ? " is-blank" : ""}" data-preview-index="${index}">
      <div class="guide-grid guide-grid--preview" aria-hidden="true"></div>
      <canvas class="letter-canvas letter-canvas--preview" data-canvas-role="${role}" data-box-index="${index}" data-theme="${theme}"></canvas>
    </div>
  `;
}

function renderLifeRow() {
  return `
    <div class="life-row" aria-label="남은 기회">
      ${[0, 1, 2]
        .map(
          (index) => `
            <span class="life-icon${index < state.attemptsLeft ? "" : " is-off"}">
              <img src="${LIFE_ICON_SRC}" alt="" />
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderWaitingScreen(isCorrect) {
  const question = getCurrentQuestion();
  const ctaText = isCorrect ? "정답!" : "답안 제출";
  const latestAttempt = getLatestAttempt(question);

  return `
    <main class="screen waiting-screen${currentScreenEnterClass ? ` ${currentScreenEnterClass}` : ""}">
      <div class="screen__dim screen__dim--flat"></div>
      <section class="waiting-shell screen__content">
        <div class="waiting-stack">
          ${renderLifeRow()}
          <div class="preview-done" aria-label="preview done">
            <div class="preview-row preview-row--waiting">
            ${question.chars
              .map((char, index) => renderPreviewBox(char, index, "waiting"))
              .join("")}
            </div>
          </div>
          <div class="button-area button-area--waiting">
            <button class="cta-button${isCorrect ? " cta-button--success" : ""}" disabled data-attempt-order="${latestAttempt?.submissionOrder || 0}">
              ${escapeHtml(ctaText)}
            </button>
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderRevealScreen() {
  const question = getCurrentQuestion();
  return `
    <main class="screen reveal-screen">
      <div class="screen__dim screen__dim--soft"></div>
      <section class="reveal-shell screen__content">
        <div class="revealed-answer">
          <div class="answer-bubble">
            <div class="answer-bubble__body">${escapeHtml(question.text)}</div>
            <div class="answer-bubble__tail"></div>
          </div>
        </div>
        <section class="reveal-panel">
          <div class="reveal-panel__header">
            <div class="reveal-panel__header-main">
              <h2 class="reveal-panel__title">내가 제출한 답안</h2>
              <button class="toggle-wrap${state.showGhostOverlay ? " is-active" : ""}" data-toggle-ghost>
                <span>겹쳐 보기</span>
                <span class="toggle-switch" aria-hidden="true"></span>
              </button>
            </div>
            <span class="reveal-panel__chevron" aria-hidden="true">⌃</span>
          </div>
          <div class="answer-table">
            ${question.attempts.map((attempt, attemptIndex) => renderRevealRow(question, attempt, attemptIndex)).join("")}
            ${renderCorrectAnswerRow(question)}
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderRevealRow(question, attempt, attemptIndex) {
  return `
    <div class="answer-row${attempt.isCorrect ? " is-correct" : ""}">
      <div class="answer-row__label${attempt.isCorrect ? " has-badge" : ""}">
        <span class="answer-row__label-text">${attempt.submissionOrder}차</span>
        ${attempt.isCorrect ? `<img class="answer-row__badge" src="${CORRECT_BADGE_SRC}" alt="정답" />` : ""}
      </div>
      <div class="answer-row__boxes">
        ${question.chars
          .map((char, boxIndex) => {
            const isCorrectCell = isAttemptCellCorrect(attempt, question.chars, boxIndex);
            return `
              <div class="attempt-box${char === " " ? " attempt-box--empty" : ""}">
                <div class="attempt-box__paper"></div>
                ${state.showGhostOverlay && char !== " " ? `<span class="attempt-box__ghost">${escapeHtml(char)}</span>` : ""}
                <canvas
                  class="attempt-box__canvas"
                  data-canvas-role="attempt"
                  data-question-index="${state.currentQuestionIndex}"
                  data-attempt-index="${attemptIndex}"
                  data-box-index="${boxIndex}"
                  data-theme="reveal"
                  data-line-color="${isCorrectCell ? "#ffffff" : "#ff5b5b"}"
                ></canvas>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderCorrectAnswerRow(question) {
  return `
    <div class="answer-row answer-row--answer">
      <div class="answer-row__label">정답</div>
      <div class="answer-row__boxes">
        ${question.chars
          .map(
            (char) => `
              <div class="attempt-box attempt-box--correct-answer">
                <div class="attempt-box__paper"></div>
                ${char === " " ? "" : `<span class="attempt-box__answer">${escapeHtml(char)}</span>`}
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function isAttemptCellCorrect(attempt, answerChars, boxIndex) {
  return getAttemptDetectedChar(attempt, answerChars[boxIndex], boxIndex) === answerChars[boxIndex];
}

function getAttemptDetectedChar(attempt, answerChar, boxIndex) {
  const detectedChar = attempt.detectedByIndex?.[boxIndex] ?? "";
  if (!detectedChar && answerChar === " ") {
    return " ";
  }
  return detectedChar;
}

function renderResultScreen() {
  return `
    <main class="screen screen--result">
      <section class="result-screen screen__content">
        <header class="result-header">
          <p class="result-header__eyebrow">받아쓰기</p>
          <div class="result-ribbon">타이틀을 입력해주세요.</div>
        </header>
        <section class="result-questions">
          ${state.questions.map((question, questionIndex) => renderResultCard(question, questionIndex)).join("")}
        </section>
      </section>
    </main>
  `;
}

function renderResultCard(question, questionIndex) {
  const rows = question.attempts.length
    ? question.attempts.map((attempt, attemptIndex) => renderResultAttemptRow(question, attempt, questionIndex, attemptIndex)).join("")
    : '<p class="result-card__note">아직 제출한 시도가 없습니다.</p>';

  return `
    <article class="result-card${question.finalStatus === "wrong" ? " is-final-wrong" : ""}">
      ${question.finalStatus === "correct" ? '<img class="result-correct-badge" src="source/ico-correct.svg" alt="정답" />' : ""}
      <h2 class="result-card__title">${escapeHtml(question.text)}</h2>
      <div class="result-attempts">
        ${rows}
      </div>
    </article>
  `;
}

function renderResultAttemptRow(question, attempt, questionIndex, attemptIndex) {
  return `
    <div class="result-letter-row${attempt.isCorrect ? " is-correct" : " is-wrong"}">
        ${question.chars
          .map((char, boxIndex) => `
              <div class="result-letter-box${char === " " ? " is-blank" : ""}">
                <div class="guide-grid guide-grid--result" aria-hidden="true"></div>
                <canvas
                  class="result-letter-box__canvas"
                  data-canvas-role="result-attempt"
                  data-question-index="${questionIndex}"
                  data-attempt-index="${attemptIndex}"
                  data-box-index="${boxIndex}"
                  data-theme="${attempt.isCorrect ? "result-correct" : "result-wrong"}"
                ></canvas>
              </div>
            `)
          .join("")}
    </div>
  `;
}

function setupCanvases() {
  const canvases = app.querySelectorAll("canvas[data-canvas-role]");
  canvases.forEach((canvas) => drawCanvas(canvas));
}

function redrawCanvasesForBox(boxIndex) {
  const canvases = app.querySelectorAll(`canvas[data-box-index="${boxIndex}"][data-canvas-role]`);
  canvases.forEach((canvas) => drawCanvas(canvas));
}

function refreshDetectedPill(boxIndex) {
  const pill = app.querySelector(`.writing-item[data-box-index="${boxIndex}"] .detected-pill`);
  const detectedText = state.currentBoxes[boxIndex]?.detected || "";
  if (!pill) {
    return;
  }

  pill.textContent = detectedText || (pill.classList.contains("detected-pill--v2") ? " " : "");
  pill.classList.toggle("is-empty", !detectedText);
}

function refreshInputButtons() {
  const submitButton = app.querySelector('[data-action="submit-answer"]');
  const clearButtons = app.querySelectorAll('[data-action="clear-all"]');
  const isInteractive = state.screen === "input";

  if (submitButton) {
    submitButton.disabled = !isInteractive || !canSubmitCurrentAnswer();
  }

  clearButtons.forEach((button) => {
    button.disabled = !isInteractive || !hasAnyWriting();
  });
}

function refreshCurrentBoxState(previousIndex, nextIndex) {
  if (!usesDirectCurrentWriting() && !isVersion4()) {
    return;
  }

  const previousItem =
    previousIndex === null
      ? null
      : app.querySelector(`.writing-item:is(.writing-item--v2, .writing-item--v4)[data-box-index="${previousIndex}"]`);
  const nextItem =
    nextIndex === null
      ? null
      : app.querySelector(`.writing-item:is(.writing-item--v2, .writing-item--v4)[data-box-index="${nextIndex}"]`);

  if (previousItem) {
    previousItem.classList.remove("is-current");
    previousItem.querySelector(".paper-box--v2, .paper-box--v4")?.classList.remove("is-current");
    previousItem.querySelector(".writing-item__clear-current")?.remove();
  }

  if (nextItem) {
    nextItem.classList.add("is-current");
    nextItem.querySelector(".paper-box--v2, .paper-box--v4")?.classList.add("is-current");
    if (state.screen === "input" && !nextItem.querySelector(".writing-item__clear-current")) {
      nextItem
        .querySelector(".writing-item__surface")
        ?.insertAdjacentHTML("beforeend", renderCurrentClearButton(nextIndex));
    }
  }

  const previousPreview =
    previousIndex === null ? null : app.querySelector(`.preview-box[data-preview-index="${previousIndex}"]`);
  const nextPreview =
    nextIndex === null ? null : app.querySelector(`.preview-box[data-preview-index="${nextIndex}"]`);

  previousPreview?.classList.remove("is-active");
  nextPreview?.classList.add("is-active");

  window.requestAnimationFrame(() => {
    if (previousIndex !== null) {
      redrawCanvasesForBox(previousIndex);
    }
    if (nextIndex !== null) {
      redrawCanvasesForBox(nextIndex);
    }
    if (isVersion4()) {
      startWritingTransitionRefresh();
    }
    syncWritingViewport();
  });
}

function drawCanvas(canvas) {
  const size = resizeCanvasIfNeeded(canvas);
  if (!size) {
    return;
  }

  const context = canvas.getContext("2d");
  context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  context.clearRect(0, 0, size.width, size.height);

  const strokes = resolveCanvasStrokes(canvas);
  const lineTheme = {
    name: canvas.dataset.theme,
    overrideColor: canvas.dataset.lineColor || "",
  };
  const lineColor = resolveLineColor(lineTheme);
  const lineWidth = resolveLineWidth(lineTheme, size.width);
  drawStrokes(context, size.width, size.height, strokes, lineColor, lineWidth);
}

function resizeCanvasIfNeeded(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.round(rect.width * dpr);
  const nextHeight = Math.round(rect.height * dpr);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  return {
    dpr,
    width: rect.width,
    height: rect.height,
  };
}

function resolveCanvasStrokes(canvas) {
  const role = canvas.dataset.canvasRole;
  const boxIndex = Number(canvas.dataset.boxIndex);

  if (role === "input") {
    return state.currentBoxes[boxIndex]?.strokes || [];
  }

  if (role === "preview") {
    return state.currentBoxes[boxIndex]?.strokes || [];
  }

  if (role === "waiting-preview") {
    return getLatestAttempt()?.strokesByIndex?.[boxIndex] || [];
  }

  if (role === "attempt" || role === "result-attempt") {
    const questionIndex = Number(canvas.dataset.questionIndex);
    const attemptIndex = Number(canvas.dataset.attemptIndex);
    return state.questions[questionIndex]?.attempts[attemptIndex]?.strokesByIndex?.[boxIndex] || [];
  }

  return [];
}

function resolveLineColor(theme) {
  const themeName = typeof theme === "object" ? theme.name : theme;
  const overrideColor = typeof theme === "object" ? theme.overrideColor : "";
  if (overrideColor) {
    return overrideColor;
  }

  switch (themeName) {
    case "preview":
    case "waiting-preview":
      return "#1b2036";
    case "reveal":
      return "#f8fbff";
    case "result-correct":
      return "#111111";
    case "result-wrong":
      return "#111111";
    case "input":
    default:
      return "#181c2f";
  }
}

function resolveLineWidth(theme, rectWidth) {
  const themeName = typeof theme === "object" ? theme.name : theme;
  if (
    themeName === "preview" ||
    themeName === "waiting-preview" ||
    themeName === "reveal" ||
    themeName === "result-correct" ||
    themeName === "result-wrong"
  ) {
    return Math.max(1.4, rectWidth * 0.09);
  }

  return Math.max(4, rectWidth * 0.04);
}

function syncWritingViewport() {
  const viewport = app.querySelector(".writing-viewport");
  if (!viewport) {
    return;
  }

  const pendingTarget = state.pendingViewportTarget;
  if (pendingTarget && pendingTarget.type === "box") {
    const targetBox = app.querySelector(`.writing-item[data-box-index="${pendingTarget.index}"]`);
    if (targetBox) {
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      if (pendingTarget.onlyIfNeeded && !isBoxOutsideSafeViewport(viewport, targetBox)) {
        state.pendingViewportTarget = null;
        bindViewportEvents(viewport);
        syncViewportStateFromDom(viewport);
        updateNavState(viewport);
        return;
      }
      const nextLeft =
        pendingTarget.align === "safe-center"
          ? getSafeViewportTarget(viewport, targetBox, maxScrollLeft)
          : clamp(targetBox.offsetLeft - 8, 0, maxScrollLeft);

      const applyScroll = () => {
        const clampedLeft = clamp(nextLeft, 0, maxScrollLeft);
        animateViewportScroll(viewport, clampedLeft, {
          immediate: (pendingTarget.behavior || "auto") === "auto",
        });
      };

      if (pendingTarget.defer) {
        window.requestAnimationFrame(applyScroll);
      } else {
        applyScroll();
      }
    }
    state.pendingViewportTarget = null;
  } else if (pendingTarget && pendingTarget.type === "start") {
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = clamp(state.viewportScrollLeft, 0, maxScrollLeft);
    const applyScroll = () => {
      animateViewportScroll(viewport, 0, {
        immediate: (pendingTarget.behavior || "auto") === "auto",
      });
    };

    if (pendingTarget.defer) {
      window.requestAnimationFrame(applyScroll);
    } else {
      applyScroll();
    }
    state.pendingViewportTarget = null;
  } else if (state.viewportScrollLeft > 0) {
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = clamp(state.viewportScrollLeft, 0, maxScrollLeft);
  }

  bindViewportEvents(viewport);
  syncViewportStateFromDom(viewport);
  updateNavState(viewport);
}

function syncAppHeight() {
  const visualHeight = window.visualViewport?.height || 0;
  const viewportHeight = Math.max(visualHeight, window.innerHeight, document.documentElement.clientHeight || 0);
  document.documentElement.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
}

function bindViewportEvents(viewport) {
  if (!viewport || viewport.dataset.boundScroll === "true") {
    return;
  }

  viewport.dataset.boundScroll = "true";
  viewport.addEventListener(
    "scroll",
    () => {
      scheduleViewportStateSync(viewport);
    },
    { passive: true }
  );
}

function scheduleViewportStateSync(viewport) {
  scheduledViewport = viewport;
  if (viewportStateFrame) {
    return;
  }

  viewportStateFrame = window.requestAnimationFrame(() => {
    viewportStateFrame = 0;
    const activeViewport = scheduledViewport;
    scheduledViewport = null;
    if (!activeViewport) {
      return;
    }
    state.viewportScrollLeft = activeViewport.scrollLeft;
    syncViewportStateFromDom(activeViewport);
    updateNavState(activeViewport);
  });
}

function stopViewportScrollAnimation() {
  if (!viewportScrollAnimationFrame) {
    return;
  }

  window.cancelAnimationFrame(viewportScrollAnimationFrame);
  viewportScrollAnimationFrame = 0;
}

function stopWritingTransitionRefresh() {
  if (!writingTransitionFrame) {
    return;
  }

  window.cancelAnimationFrame(writingTransitionFrame);
  writingTransitionFrame = 0;
}

function animateViewportScroll(viewport, targetLeft, options = {}) {
  if (!viewport) {
    return;
  }

  stopViewportScrollAnimation();

  const startLeft = viewport.scrollLeft;
  const clampedLeft = clamp(targetLeft, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth));
  const delta = clampedLeft - startLeft;

  if (options.immediate || Math.abs(delta) < 1) {
    viewport.scrollLeft = clampedLeft;
    state.viewportScrollLeft = clampedLeft;
    syncViewportStateFromDom(viewport);
    updateNavState(viewport);
    return;
  }

  const duration = Math.min(340, Math.max(180, Math.abs(delta) * 0.35));
  const startedAt = performance.now();

  const tick = (now) => {
    const progress = clamp((now - startedAt) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const nextLeft = startLeft + delta * eased;
    viewport.scrollLeft = nextLeft;
    state.viewportScrollLeft = nextLeft;
    syncViewportStateFromDom(viewport);
    updateNavState(viewport);

    if (progress < 1) {
      viewportScrollAnimationFrame = window.requestAnimationFrame(tick);
      return;
    }

    viewport.scrollLeft = clampedLeft;
    state.viewportScrollLeft = clampedLeft;
    syncViewportStateFromDom(viewport);
    updateNavState(viewport);
    viewportScrollAnimationFrame = 0;
  };

  viewportScrollAnimationFrame = window.requestAnimationFrame(tick);
}

function syncViewportStateFromDom(viewport = app.querySelector(".writing-viewport")) {
  if (!viewport) {
    return;
  }

  state.viewportScrollLeft = viewport.scrollLeft;
  const items = [...viewport.querySelectorAll(".writing-item[data-box-index]")];
  const leadingEdge = viewport.scrollLeft + 1;
  const firstVisibleIndex = items.findIndex((item) => item.offsetLeft + item.offsetWidth > leadingEdge);

  if (firstVisibleIndex >= 0) {
    state.viewportStartIndex = firstVisibleIndex;
  }
}

function updateNavState(viewport = app.querySelector(".writing-viewport")) {
  const prevButton = app.querySelector('[data-action="nav-prev"]');
  const nextButton = app.querySelector('[data-action="nav-next"]');

  if (!viewport || !prevButton || !nextButton) {
    return;
  }

  const navState = getScrollNavState({
    scrollLeft: viewport.scrollLeft,
    clientWidth: viewport.clientWidth,
    scrollWidth: viewport.scrollWidth,
  });
  const isInteractive = state.screen === "input";
  viewport.classList.toggle("is-centered", !navState.canScroll);
  viewport.classList.toggle("is-scrollable", navState.canScroll);

  prevButton.disabled = !isInteractive || navState.prevDisabled;
  nextButton.disabled = !isInteractive || navState.nextDisabled;
}

function getViewportScrollTarget(viewport, step) {
  const items = [...viewport.querySelectorAll(".writing-item[data-box-index]")];
  if (!items.length) {
    return viewport.scrollLeft;
  }

  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const leadingEdge = viewport.scrollLeft + 1;
  const firstVisibleIndex = items.findIndex((item) => item.offsetLeft + item.offsetWidth > leadingEdge);
  const safeStartIndex = firstVisibleIndex >= 0 ? firstVisibleIndex : 0;
  const targetIndex = clamp(safeStartIndex + step, 0, items.length - 1);

  return getSafeViewportTarget(viewport, items[targetIndex], maxScrollLeft);
}

function isBoxOutsideSafeViewport(viewport, targetBox) {
  const safeLeft = readCssPixelValue("--writing-safe-left", 48);
  const safeRight = readCssPixelValue("--writing-safe-right", 128);
  const { boxLeft, boxRight } = getTargetBoxBounds(targetBox);
  const viewLeft = viewport.scrollLeft;
  const viewRight = viewport.scrollLeft + viewport.clientWidth;

  return boxLeft < viewLeft + safeLeft || boxRight > viewRight - safeRight;
}

function getSafeViewportTarget(viewport, targetBox, maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)) {
  const safeLeft = readCssPixelValue("--writing-safe-left", 48);
  const safeRight = readCssPixelValue("--writing-safe-right", 128);
  const { paperLeft, paperRight, boxLeft, boxRight } = getTargetBoxBounds(targetBox);
  const usePaperCentering = isVersion4() && state.isLargeWritingEnabled && targetBox.classList.contains("is-current");
  const targetLeft = usePaperCentering ? paperLeft : boxLeft;
  const targetRight = usePaperCentering ? paperRight : boxRight;
  const targetWidth = targetRight - targetLeft;
  const safeWidth = Math.max(1, viewport.clientWidth - safeLeft - safeRight);

  let nextLeft = usePaperCentering
    ? targetLeft - Math.max(0, (viewport.clientWidth - targetWidth) * 0.5)
    : targetLeft - safeLeft - Math.max(0, (safeWidth - targetWidth) * 0.5);

  const visibleLeft = targetLeft - nextLeft;
  const visibleRight = targetRight - nextLeft;

  if (visibleLeft < safeLeft) {
    nextLeft = targetLeft - safeLeft;
  }

  if (visibleRight > viewport.clientWidth - safeRight) {
    nextLeft = targetRight - (viewport.clientWidth - safeRight);
  }

  return clamp(nextLeft, 0, maxScrollLeft);
}

function getTargetBoxBounds(targetBox) {
  const surfaceShell = targetBox.querySelector(".writing-item__surface-shell");
  const paperBox = targetBox.querySelector(".paper-box");
  const detectedPill = targetBox.querySelector(".detected-pill");
  const shellLeft = surfaceShell ? targetBox.offsetLeft + surfaceShell.offsetLeft : targetBox.offsetLeft;
  const shellRight = surfaceShell
    ? shellLeft + surfaceShell.offsetWidth
    : targetBox.offsetLeft + targetBox.offsetWidth;
  const paperLeft = paperBox ? shellLeft + paperBox.offsetLeft : shellLeft;
  const paperRight = paperBox ? paperLeft + paperBox.offsetWidth : shellRight;
  const pillRight = detectedPill
    ? targetBox.offsetLeft + detectedPill.offsetLeft + detectedPill.offsetWidth
    : shellRight;
  const boxLeft = Math.min(targetBox.offsetLeft, shellLeft);
  const boxRight = Math.max(shellRight, pillRight);
  return {
    paperLeft,
    paperRight,
    boxLeft,
    boxRight,
  };
}

function readCssPixelValue(propertyName, fallback) {
  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMockDetectedValue(answerChar, boxIndex) {
  if (answerChar && answerChar !== " ") {
    return answerChar;
  }

  return MOCK_DETECTED_CHARS[boxIndex % MOCK_DETECTED_CHARS.length];
}

function drawStrokes(context, width, height, strokes, lineColor, lineWidth) {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = lineColor;
  context.fillStyle = lineColor;
  context.lineWidth = lineWidth;

  strokes.forEach((stroke) => {
    if (!stroke.points.length) {
      return;
    }

    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(point.x * width, point.y * height, lineWidth * 0.5, 0, Math.PI * 2);
      context.fill();
      return;
    }

    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
