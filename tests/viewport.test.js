const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createQuestion,
  getVisibleIndices,
  getVisibleEndIndex,
  moveViewportState,
  ensureActiveBoxVisibleState,
  getScrollNavState,
  createEmptyBoxes,
  VISIBLE_BOX_COUNT,
} = require("../js/viewport.js");

test("createQuestion keeps one box per character including spaces and punctuation", () => {
  const question = createQuestion("우리는 모두 소중한 존재야!");

  assert.equal(question.chars.length, 15);
  assert.deepEqual(createEmptyBoxes(question.chars).length, question.chars.length);
});

test("6-char question can reach the 6th box through viewport movement", () => {
  const question = createQuestion("설레는 마음");
  const initialState = { viewportStartIndex: 0, activeLetterIndex: 0 };

  const moved = moveViewportState(initialState, question.chars.length, VISIBLE_BOX_COUNT, 3);

  assert.equal(moved.viewportStartIndex, 1);
  assert.equal(getVisibleEndIndex(moved.viewportStartIndex, question.chars.length, VISIBLE_BOX_COUNT), 5);
  assert.deepEqual(getVisibleIndices(moved.viewportStartIndex, question.chars.length, VISIBLE_BOX_COUNT), [1, 2, 3, 4, 5]);
});

test("9-char question can keep moving until the final box is visible", () => {
  const question = createQuestion("도움을 주는 까닭");
  let viewState = { viewportStartIndex: 0, activeLetterIndex: 0 };

  viewState = moveViewportState(viewState, question.chars.length, VISIBLE_BOX_COUNT, 3);
  viewState = moveViewportState(viewState, question.chars.length, VISIBLE_BOX_COUNT, 3);

  assert.equal(viewState.viewportStartIndex, 4);
  assert.deepEqual(getVisibleIndices(viewState.viewportStartIndex, question.chars.length, VISIBLE_BOX_COUNT), [4, 5, 6, 7, 8]);
});

test("15-char question reaches the last box after repeated next moves", () => {
  const question = createQuestion("우리는 모두 소중한 존재야!");
  let viewState = { viewportStartIndex: 0, activeLetterIndex: 0 };

  for (let index = 0; index < 4; index += 1) {
    viewState = moveViewportState(viewState, question.chars.length, VISIBLE_BOX_COUNT, 3);
  }

  assert.equal(viewState.viewportStartIndex, 10);
  assert.deepEqual(getVisibleIndices(viewState.viewportStartIndex, question.chars.length, VISIBLE_BOX_COUNT), [10, 11, 12, 13, 14]);
});

test("ensureActiveBoxVisibleState shifts the viewport to reveal a later active box", () => {
  const question = createQuestion("도움을 주는 까닭");

  const nextState = ensureActiveBoxVisibleState(
    { viewportStartIndex: 0, activeLetterIndex: 7 },
    question.chars.length,
    VISIBLE_BOX_COUNT
  );

  assert.equal(nextState.viewportStartIndex, 3);
  assert.equal(nextState.activeLetterIndex, 7);
  assert.deepEqual(getVisibleIndices(nextState.viewportStartIndex, question.chars.length, VISIBLE_BOX_COUNT), [3, 4, 5, 6, 7]);
});

test("moveViewportState keeps the active index unchanged when only the viewport moves", () => {
  const question = createQuestion("우리는 모두 소중한 존재야!");

  const moved = moveViewportState(
    { viewportStartIndex: 0, activeLetterIndex: 1 },
    question.chars.length,
    VISIBLE_BOX_COUNT,
    3
  );

  assert.equal(moved.viewportStartIndex, 3);
  assert.equal(moved.activeLetterIndex, 1);
});

test("getScrollNavState enables next when the DOM viewport still overflows", () => {
  const navState = getScrollNavState({
    scrollLeft: 0,
    clientWidth: 760,
    scrollWidth: 980,
  });

  assert.equal(navState.canScroll, true);
  assert.equal(navState.prevDisabled, true);
  assert.equal(navState.nextDisabled, false);
  assert.equal(navState.maxScrollLeft, 220);
});

test("getScrollNavState disables next only at the real scroll end", () => {
  const navState = getScrollNavState({
    scrollLeft: 219.5,
    clientWidth: 760,
    scrollWidth: 980,
  });

  assert.equal(navState.prevDisabled, false);
  assert.equal(navState.nextDisabled, true);
});
