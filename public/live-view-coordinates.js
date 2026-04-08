(function attachLiveViewCoordinates(globalScope) {
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function resolveContainedImageClick({
    clientX,
    clientY,
    rectLeft,
    rectTop,
    rectWidth,
    rectHeight,
    sourceWidth,
    sourceHeight
  }) {
    const safeRectWidth = Math.max(1, Number(rectWidth) || 0);
    const safeRectHeight = Math.max(1, Number(rectHeight) || 0);
    const safeSourceWidth = Math.max(1, Number(sourceWidth) || safeRectWidth);
    const safeSourceHeight = Math.max(1, Number(sourceHeight) || safeRectHeight);
    const scale = Math.min(safeRectWidth / safeSourceWidth, safeRectHeight / safeSourceHeight);
    const renderedWidth = safeSourceWidth * scale;
    const renderedHeight = safeSourceHeight * scale;
    const offsetX = (safeRectWidth - renderedWidth) / 2;
    const offsetY = (safeRectHeight - renderedHeight) / 2;
    const localX = clamp((Number(clientX) || 0) - (Number(rectLeft) || 0) - offsetX, 0, renderedWidth);
    const localY = clamp((Number(clientY) || 0) - (Number(rectTop) || 0) - offsetY, 0, renderedHeight);

    return {
      offsetX,
      offsetY,
      renderedWidth,
      renderedHeight,
      pageX: (localX / renderedWidth) * safeSourceWidth,
      pageY: (localY / renderedHeight) * safeSourceHeight
    };
  }

  const api = {
    resolveContainedImageClick
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.LiveViewCoordinates = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
