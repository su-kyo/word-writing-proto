(function createViewportApi(globalScope) {
  const VISIBLE_BOX_COUNT = 5;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function createQuestion(text) {
    return {
      text,
      chars: [...text],
      attempts: [],
      finalStatus: null,
    };
  }

  function createEmptyBoxes(chars) {
    return chars.map(() => ({
      strokes: [],
      detected: "",
    }));
  }

  function getInitialActiveLetterIndex(version, totalChars) {
    if (!totalChars) {
      return null;
    }

    return version === "v2" ? null : 0;
  }

  function shouldShowInputActiveState(version) {
    return version === "v1" || version === "v2" || version === "v3" || version === "v4";
  }

  function shouldResetToFirstBoxOnRetry(version, isLargeWritingEnabled = false) {
    return version === "v2" || (version === "v4" && !isLargeWritingEnabled);
  }

  function getMaxViewportStart(totalChars, visibleCount = VISIBLE_BOX_COUNT) {
    return Math.max(0, totalChars - visibleCount);
  }

  function getVisibleEndIndex(viewportStartIndex, totalChars, visibleCount = VISIBLE_BOX_COUNT) {
    return Math.min(viewportStartIndex + visibleCount - 1, totalChars - 1);
  }

  function getVisibleIndices(viewportStartIndex, totalChars, visibleCount = VISIBLE_BOX_COUNT) {
    const visibleIndices = [];
    const visibleEndIndex = getVisibleEndIndex(viewportStartIndex, totalChars, visibleCount);

    for (let index = viewportStartIndex; index <= visibleEndIndex; index += 1) {
      visibleIndices.push(index);
    }

    return visibleIndices;
  }

  function moveViewportState(viewState, totalChars, visibleCount = VISIBLE_BOX_COUNT, step = 0) {
    const nextStart = clamp(
      viewState.viewportStartIndex + step,
      0,
      getMaxViewportStart(totalChars, visibleCount)
    );

    return {
      ...viewState,
      viewportStartIndex: nextStart,
    };
  }

  function ensureActiveBoxVisibleState(viewState, totalChars, visibleCount = VISIBLE_BOX_COUNT) {
    let nextStart = viewState.viewportStartIndex;
    const visibleEndIndex = getVisibleEndIndex(nextStart, totalChars, visibleCount);

    if (viewState.activeLetterIndex < nextStart) {
      nextStart = viewState.activeLetterIndex;
    }

    if (viewState.activeLetterIndex > visibleEndIndex) {
      nextStart = viewState.activeLetterIndex - (visibleCount - 1);
    }

    return {
      ...viewState,
      viewportStartIndex: clamp(nextStart, 0, getMaxViewportStart(totalChars, visibleCount)),
    };
  }

  function getScrollNavState({ scrollLeft = 0, clientWidth = 0, scrollWidth = 0 } = {}) {
    const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
    const canScroll = maxScrollLeft > 1;

    return {
      canScroll,
      maxScrollLeft,
      prevDisabled: !canScroll || scrollLeft <= 1,
      nextDisabled: !canScroll || scrollLeft >= maxScrollLeft - 1,
    };
  }

  const api = {
    VISIBLE_BOX_COUNT,
    clamp,
    createQuestion,
    createEmptyBoxes,
    getInitialActiveLetterIndex,
    shouldShowInputActiveState,
    shouldResetToFirstBoxOnRetry,
    getMaxViewportStart,
    getVisibleEndIndex,
    getVisibleIndices,
    moveViewportState,
    ensureActiveBoxVisibleState,
    getScrollNavState,
  };

  globalScope.HandwritingViewport = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
